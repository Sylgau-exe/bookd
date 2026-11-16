// lib/shipping.js — v1.33: keeps BOOKD in step with Lulu WITHOUT anyone clicking "Refresh status".
// One function (syncOrder) is used by the hourly cron, the Lulu webhook and the admin "Refresh status" button:
// it reads the print job from Lulu, saves status + tracking + estimated dates, moves the order to Shipped / Delivered
// and emails the customer once when the book ships.
import crypto from 'node:crypto';
import { q, one, logEvent, getSetting, setSetting } from './db.js';
import { sendMail, adminInbox } from './mail.js';
import { clip, isEmail } from './http.js';
import * as lulu from './lulu.js';

const isoDay = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null;
// Lulu's estimate: earliest/latest day the book leaves the printer and earliest/latest day it arrives.
export function etaOf(job) {
  const e = job?.estimated_shipping_dates || {};
  const out = { dispatch_min: isoDay(e.dispatch_min), dispatch_max: isoDay(e.dispatch_max), arrival_min: isoDay(e.arrival_min), arrival_max: isoDay(e.arrival_max) };
  return Object.values(out).some(Boolean) ? out : null;
}
const day = (iso, lang) => new Date(iso + 'T12:00:00Z').toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export function rangeText(a, b, lang = 'en') {
  if (!a && !b) return '';
  if (!a || !b || a === b) return day(a || b, lang);
  return `${day(a, lang)} – ${day(b, lang)}`;
}
export const arrivalText = (eta, lang) => eta ? rangeText(eta.arrival_min, eta.arrival_max, lang) : '';
export const trackingUrl = (txt) => (String(txt || '').match(/https?:\/\/\S+/) || [''])[0];
const parseEta = v => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

function shippedMail(o, trackTxt, eta, site) {
  const fr = o.lang === 'fr', arrive = arrivalText(eta, fr ? 'fr' : 'en'), link = site && o.token ? `${site}/my/?t=${o.token}` : '';
  if (fr) return { subject: `Votre livre BOOKD est en route (${o.ref})`,
    text: `Bonjour ${o.customer_name || ''},\n\nVotre livre BOOKD a été expédié.${trackTxt ? `\nSuivi : ${trackTxt}` : ''}${arrive ? `\nLivraison estimée : ${arrive}` : ''}${link ? `\n\nVous pouvez suivre votre commande ici : ${link}` : ''}\n\nMerci!\nBOOKD` };
  return { subject: `Your BOOKD book is on its way (${o.ref})`,
    text: `Hello ${o.customer_name || ''},\n\nYour BOOKD book has shipped.${trackTxt ? `\nTracking: ${trackTxt}` : ''}${arrive ? `\nEstimated delivery: ${arrive}` : ''}${link ? `\n\nYou can follow your order here: ${link}` : ''}\n\nThank you!\nBOOKD` };
}

// Reads one order's print job from Lulu and brings BOOKD up to date. Safe to call as often as needed (idempotent).
export async function syncOrder(o, { site = '' } = {}) {
  if (!o.printer_order_id || !/^Lulu/.test(o.printer || '')) throw Object.assign(new Error('No Lulu print job on this order'), { code: 'NO_JOB' });
  if ((o.printer_env || 'sandbox') !== lulu.luluEnv()) throw Object.assign(new Error(`This job was created in Lulu ${o.printer_env}; the site is now set to ${lulu.luluEnv()}.`), { code: 'ENV' });
  const job = await lulu.getJob(o.printer_order_id);
  const st = job.status?.name || 'UNKNOWN', tr = lulu.trackingOf(job), trackTxt = tr.map(t => [t.carrier, t.id, t.url].filter(Boolean).join(' ')).join(' | ');
  const eta = etaOf(job) || parseEta(o.ship_eta), why = lulu.problemsOf(job), changed = st !== o.printer_status;
  const sets = ['printer_status=$1', 'printer_checked_at=now()'], vals = [st];
  if (trackTxt) { vals.push(trackTxt); sets.push(`tracking=$${vals.length}`); }
  if (etaOf(job)) { vals.push(JSON.stringify(etaOf(job))); sets.push(`ship_eta=$${vals.length}::jsonb`); }
  // only touch updated_at when something really changed, so the hourly check does not reshuffle the orders list
  if (changed || (trackTxt && trackTxt !== (o.tracking || ''))) sets.push('updated_at=now()');
  vals.push(o.id); await q(`UPDATE orders SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  if (changed || (why && st === 'REJECTED')) await logEvent(o.id, 'Lulu', `Print job ${o.printer_order_id}: ${o.printer_status || '—'} → ${st}${job.status?.message ? ' (' + clip(job.status.message, 300) + ')' : ''}${why ? ' — Lulu says: ' + clip(why, 900) : ''}`);

  let orderStatus = o.status, mailed = false;
  if (st === 'SHIPPED') {
    const moved = await one(`UPDATE orders SET status='shipped', shipped_at=COALESCE(shipped_at, now()), updated_at=now() WHERE id=$1 AND status NOT IN ('shipped','delivered','cancelled') RETURNING id`, [o.id]);
    if (moved) {
      orderStatus = 'shipped'; await logEvent(o.id, 'system', `Status: ${o.status} → shipped (Lulu)${arrivalText(eta) ? ' — estimated delivery ' + arrivalText(eta) : ''}`);
      // one shipping email per order, even if the cron and the webhook arrive together
      if (isEmail(o.customer_email) && await one('UPDATE orders SET ship_mail_at=now() WHERE id=$1 AND ship_mail_at IS NULL RETURNING id', [o.id])) {
        await sendMail({ to: o.customer_email, ...shippedMail(o, trackTxt || o.tracking, eta, site) }); mailed = true;
        await logEvent(o.id, 'system', 'Shipping email sent to customer');
      }
    }
  }
  if (st === 'DELIVERED') {
    const moved = await one(`UPDATE orders SET status='delivered', shipped_at=COALESCE(shipped_at, now()), delivered_at=COALESCE(delivered_at, now()), updated_at=now() WHERE id=$1 AND status NOT IN ('delivered','cancelled') RETURNING id`, [o.id]);
    if (moved) { orderStatus = 'delivered'; await logEvent(o.id, 'system', `Status: ${o.status} → delivered (Lulu)`); }
  }
  // a rejected job needs a person: tell the admin once, when it happens
  if (changed && ['REJECTED', 'ERROR'].includes(st))
    await sendMail({ to: adminInbox(), subject: `[BOOKD] ${o.ref} — Lulu ${st}: action needed`, text: `Lulu reports ${st} on print job ${o.printer_order_id} (${o.ref}).\n${why || job.status?.message || ''}\n\n${site ? `${site}/admin/#order/${o.id}` : ''}` });
  return { status: st, orderStatus, changed, mailed, tracking: trackTxt, eta, message: [job.status?.message, why].filter(Boolean).join(' — ') };
}

// Every order with a live Lulu job that is not finished yet. Called by the hourly cron.
export async function syncOpenJobs({ site = '', max = 40 } = {}) {
  if (!lulu.hasLulu()) return { checked: 0, skipped: 'Lulu not connected' };
  const rows = await q(`SELECT * FROM orders WHERE printer_order_id IS NOT NULL AND printer ~ '^Lulu' AND COALESCE(printer_env,'sandbox')=$1
    AND status NOT IN ('delivered','cancelled') AND COALESCE(printer_status,'') NOT IN ('CANCELED','REJECTED','ERROR')
    ORDER BY printer_checked_at ASC NULLS FIRST LIMIT $2`, [lulu.luluEnv(), max]);
  const out = [];
  for (const o of rows) {
    try { const r = await syncOrder(o, { site }); out.push({ ref: o.ref, lulu: r.status, order: r.orderStatus, changed: r.changed, mailed: r.mailed }); }
    catch (e) { console.error('lulu-sync', o.ref, e.message); out.push({ ref: o.ref, error: clip(e.message, 200) }); }
  }
  return { checked: rows.length, changed: out.filter(x => x.changed).length, orders: out };
}

// Ask Lulu (once) to call /api/lulu-webhook whenever a print job changes status, so updates arrive in minutes.
// Best effort: the hourly cron stays the safety net if this fails.
export async function ensureWebhook(site) {
  if (!lulu.hasLulu() || !/^https:\/\//.test(site || '') || process.env.VERCEL_ENV !== 'production') return { skipped: true };
  const url = `${site}/api/lulu-webhook`, key = `lulu_webhook_${lulu.luluEnv()}`;
  if ((await getSetting(key)) === url) return { ok: true, url };
  try {
    const list = await lulu.listWebhooks(); const hooks = Array.isArray(list) ? list : (list?.results || []);
    if (!hooks.some(w => w.url === url)) await lulu.createWebhook(url);
    await setSetting(key, url); return { ok: true, url, created: true };
  } catch (e) { console.error('lulu webhook setup', e.message); return { ok: false, error: clip(e.message, 300) }; }
}
// Lulu signs each webhook with HMAC-SHA256 of the raw body, keyed with the API secret (header Lulu-HMAC-SHA256).
export function webhookSigned(raw, header) {
  const secret = (process.env.LULU_CLIENT_SECRET || '').trim(), h = String(header || '').trim(); if (!secret || !h) return false;
  const mac = crypto.createHmac('sha256', secret).update(raw, 'utf8');
  const hex = mac.digest('hex'), b64 = Buffer.from(hex, 'hex').toString('base64');
  const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return eq(h.toLowerCase(), hex) || eq(h, b64);
}
