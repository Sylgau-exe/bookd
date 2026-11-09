// lib/orders.js — creating orders and recording Stripe payments (shared by admin, checkout and webhook)
import crypto from 'node:crypto';
import { q, one, ensureSchema, logEvent } from './db.js';
import { PACKAGES, priceFor, normCover, coverOf, coverLabel } from './pricing.js';
import { clip, isEmail } from './http.js';
import { sendMail, adminInbox } from './mail.js';
const token = () => crypto.randomBytes(24).toString('hex');
export async function createOrder(fields, actor) {
  await ensureSchema();
  const pkg = PACKAGES[fields.package] ? fields.package : 'signature';
  const copies = Math.max(1, Math.min(50, parseInt(fields.copies, 10) || 1));
  const cover = normCover(fields.cover) || 'soft';
  const row = await one(`INSERT INTO orders (token, status, customer_name, customer_email, phone, lang, package, copies, price_usd, notes, cover)
    VALUES ($1,'new',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [token(), clip(fields.customer_name, 120), clip(fields.customer_email, 200), clip(fields.phone, 60), clip(fields.lang || 'en', 5), pkg, copies, priceFor(pkg, copies, cover), clip(fields.notes, 4000), cover]);
  const ref = 'BK-' + String(1000 + row.id);
  await q('UPDATE orders SET ref=$1 WHERE id=$2', [ref, row.id]);
  await logEvent(row.id, actor, 'Order created');
  return { ...row, ref };
}
export const portalLink = (site, o) => `${site}/my/?t=${o.token}`;
export async function emailPortal(site, o, intro) {
  if (!isEmail(o.customer_email)) return { skipped: true };
  return sendMail({ to: o.customer_email, subject: `Your BOOKD book — upload your photos (${o.ref})`,
    text: `Hello ${o.customer_name || ''},\n\n${intro || 'Thank you for choosing BOOKD!'} Use this private link to add your details, your shoots and your photos:\n\n${portalLink(site, o)}\n\nYou can come back to it any time. When everything is in, press "Send for layout".\n\nBOOKD` });
}
// Record a paid Checkout Session once (webhook and return page may both call this). Returns the order.
export async function recordPaidSession(site, s) {
  if (s.payment_status !== 'paid') return null;
  const m = s.metadata || {}, amount = (s.amount_total || 0) / 100;
  if (m.kind === 'upgrade') {
    const o = await one('SELECT * FROM orders WHERE id=$1', [parseInt(m.order_id, 10)]); if (!o) return null;
    if (o.stripe_upgrade_session === s.id) return o; // already recorded
    const to = PACKAGES[m.to]; if (!to) return o;
    const fromCover = coverOf(o), toCover = normCover(m.cover) || fromCover;
    const diff = priceFor(m.to, o.copies || 1, toCover) - priceFor(o.package, o.copies || 1, fromCover);
    await q(`UPDATE orders SET package=$1, cover=$6, price_usd=coalesce(price_usd,0)+$2, paid_usd=coalesce(paid_usd,0)+$3, stripe_upgrade_session=$4, updated_at=now() WHERE id=$5`,
      [m.to, Math.max(0, diff), amount, s.id, o.id, toCover]);
    await logEvent(o.id, 'Stripe', `Upgraded ${PACKAGES[o.package]?.label} → ${to.label}: paid $${amount.toFixed(2)} USD (${s.livemode ? 'live' : 'TEST'} payment)`);
    await sendMail({ to: adminInbox(), subject: `[BOOKD] ${o.ref} — upgraded to ${to.label} (+$${amount.toFixed(2)})`, text: `${o.customer_name} moved up to ${to.label}.\n\n${site}/admin/#order/${o.id}` });
    return one('SELECT * FROM orders WHERE id=$1', [o.id]);
  }
  if (m.kind === 'balance') {
    const o = await one('SELECT * FROM orders WHERE id=$1', [parseInt(m.order_id, 10)]); if (!o) return null;
    if (o.stripe_balance_session === s.id && o.balance_paid) return o;
    await q(`UPDATE orders SET balance_paid=true, stripe_balance_session=$1, paid_usd=coalesce(paid_usd,0)+$2, status = CASE WHEN status='approved' THEN 'paid' ELSE status END, updated_at=now() WHERE id=$3`, [s.id, amount, o.id]);
    await logEvent(o.id, 'Stripe', `Balance paid: $${amount.toFixed(2)} USD (${s.livemode ? 'live' : 'TEST'} payment) — status: Approved & paid`);
    await sendMail({ to: adminInbox(), subject: `[BOOKD] ${o.ref} — approved & paid: ready to print`, text: `${o.customer_name} paid the balance ($${amount.toFixed(2)}). The book is approved and paid: open the order and press "Send to Lulu".\n\n${site}/admin/#order/${o.id}` });
    return one('SELECT * FROM orders WHERE id=$1', [o.id]);
  }
  // deposit → new order (idempotent on the session id)
  const existing = await one('SELECT * FROM orders WHERE stripe_deposit_session=$1', [s.id]);
  if (existing) return existing;
  const cd = s.customer_details || {};
  const o = await createOrder({ customer_name: cd.name || (cd.email || '').split('@')[0], customer_email: cd.email || s.customer_email, phone: cd.phone || '',
    lang: m.lang, package: m.package, copies: m.copies, cover: m.cover, notes: `Reserved online with Stripe (${s.livemode ? 'live' : 'TEST'} payment).` }, 'customer');
  const dPct = Math.min(99, Math.max(0, parseInt(m.discount_pct, 10) || 0));
  try { await q(`UPDATE orders SET stripe_deposit_session=$1, deposit_paid=true, deposit_usd=$2, paid_usd=$2, status='collecting', discount_pct=$4, discount_code=$5, updated_at=now() WHERE id=$3`, [s.id, amount, o.id, dPct, dPct ? (m.discount_code || '').slice(0, 40) : null]); }
  catch (e) { // the other caller won the race: drop our duplicate
    if (e.code !== '23505') throw e; await q('DELETE FROM orders WHERE id=$1', [o.id]); return one('SELECT * FROM orders WHERE stripe_deposit_session=$1', [s.id]); }
  await logEvent(o.id, 'Stripe', `Deposit paid: $${amount.toFixed(2)} USD (${s.livemode ? 'live' : 'TEST'} payment) — ${PACKAGES[o.package]?.label} ${coverLabel(coverOf(o)).toLowerCase()}, ${o.copies} cop${o.copies > 1 ? 'ies' : 'y'}${dPct ? ` — private code ${m.discount_code}: ${dPct}% off the book and shipping` : ''}`);
  const full = await one('SELECT * FROM orders WHERE id=$1', [o.id]);
  const r = await emailPortal(site, full, 'Thank you, your deposit is received and your book is reserved!');
  await logEvent(o.id, 'system', r.skipped ? 'Portal link ready (email not configured)' : 'Portal link emailed to customer');
  await sendMail({ to: adminInbox(), subject: `[BOOKD] New order ${full.ref} — ${PACKAGES[full.package]?.label} ${coverLabel(coverOf(full))} — deposit $${amount.toFixed(2)}`,
    text: `${full.customer_name} <${full.customer_email}> reserved a ${PACKAGES[full.package]?.label} book online — ${coverLabel(coverOf(full)).toUpperCase()}.\n\n${site}/admin/#order/${full.id}` });
  return full;
}
export function balanceDue(o) {
  const off = Math.min(99, Math.max(0, Number(o.discount_pct || 0)));
  const total = (Number(o.price_usd || 0) + Number(o.shipping_usd || 0)) * (100 - off) / 100;
  return Math.max(0, Math.round((total - Number(o.paid_usd || o.deposit_usd || 0)) * 100) / 100);
}
