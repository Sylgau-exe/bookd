// api/admin/[action].js — BOOKD back office API (English only). All actions except setup/login need an admin token.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q, one, ensureSchema, logEvent, hasDb } from '../../lib/db.js';
import { readJson, fail, clip, isEmail, siteUrl, handle } from '../../lib/http.js';
import { sign, requireAdmin } from '../../lib/auth.js';
import { sendMail } from '../../lib/mail.js';
import { PACKAGES, priceFor, STATUSES, isLowRes, isTooSmall } from '../../lib/pricing.js';
import { buildLayout } from '../../lib/layout.js';
import { buildPdfs } from '../../lib/pdf.js';
import { savePublic, removePublic, hasBlob } from '../../lib/storage.js';
import * as lulu from '../../lib/lulu.js';
import { TEMPLATES, templateKey } from '../../lib/templates.js';
import { ORNAMENTS, ORNAMENT_COLORS, ornamentKey, ornamentColor } from '../../lib/ornaments.js';
import { createOrder, balanceDue } from '../../lib/orders.js';
import { buildProof, refreshPrintFiles } from '../../lib/proofs.js';
import { hasStripe, stripeMode } from '../../lib/stripe.js';

const token = () => crypto.randomBytes(24).toString('hex');
const STATUS_KEYS = STATUSES.map(s => s[0]);
const EDITABLE = ['status', 'customer_name', 'customer_email', 'phone', 'lang', 'package', 'copies', 'price_usd', 'shipping_usd', 'deposit_paid', 'balance_paid',
  'ship_name', 'ship_address', 'ship_city', 'ship_region', 'ship_postal', 'ship_country', 'printer', 'printer_order_id', 'tracking', 'notes', 'ship_level', 'template', 'ornament', 'ornament_color', 'photo_style'];

async function loadOrder(id) {
  const order = await one('SELECT * FROM orders WHERE id=$1', [id]);
  if (!order) return null;
  const shoots = await q('SELECT * FROM shoots WHERE order_id=$1 ORDER BY position, id', [id]);
  const photos = (await q('SELECT * FROM photos WHERE order_id=$1 ORDER BY shoot_id, position, id', [id]))
    .map(p => ({ ...p, low_res: isLowRes(p.width, p.height), too_small: isTooSmall(p.width, p.height) }));
  const proofs = await q('SELECT id, version, status, interior_url, cover_url, preview_url, page_count, layout, sent_at, decided_at, created_at FROM proofs WHERE order_id=$1 ORDER BY version DESC', [id]);
  const comments = proofs.length ? await q('SELECT * FROM proof_comments WHERE proof_id = ANY($1::int[]) ORDER BY created_at', [proofs.map(p => p.id)]) : [];
  const events = await q('SELECT * FROM events WHERE order_id=$1 ORDER BY created_at DESC LIMIT 100', [id]);
  return { order, shoots, photos, proofs, comments, events };
}
export default async function handler(req, res) {
  const action = req.query.action;
  return handle(req, res, async () => {
    if (!hasDb()) return fail(res, 503, 'Database not configured: connect a Neon database in Vercel → Storage.');
    await ensureSchema();
    const body = req.method === 'POST' ? await readJson(req) : {};

    // ---------- setup & login ----------
    if (action === 'setup') { // status only (used for diagnostics)
      const n = (await one('SELECT count(*)::int AS n FROM admins')).n;
      return res.json({ ok: true, needsSetup: n === 0, blob: hasBlob() });
    }
    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '').trim();
      const count = (await one('SELECT count(*)::int AS n FROM admins')).n;
      if (count === 0) {
        // very first sign-in: the password is the ADMIN_SETUP_KEY set in Vercel; this creates the first admin account
        const key = String(process.env.ADMIN_SETUP_KEY || '').trim();
        if (!key) return fail(res, 403, 'Set ADMIN_SETUP_KEY in Vercel, redeploy, then sign in with it as your password.');
        if (!isEmail(email) || password !== key) return fail(res, 401, 'First sign-in: use your email and the ADMIN_SETUP_KEY password from Vercel.');
        const a = await one('INSERT INTO admins (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id, email, name', [email, email.split('@')[0], await bcrypt.hash(password, 10)]);
        return res.json({ ok: true, token: sign(a), admin: a, created: true });
      }
      const a = await one('SELECT * FROM admins WHERE email=$1', [email]);
      if (!a || !(await bcrypt.compare(password, a.password_hash))) return fail(res, 401, 'Wrong email or password');
      return res.json({ ok: true, token: sign(a), admin: { id: a.id, email: a.email, name: a.name } });
    }

    const admin = await requireAdmin(req, res); if (!admin) return;
    const who = admin.name || admin.email;

    switch (action) {
      case 'me': return res.json({ ok: true, admin, statuses: STATUSES, packages: PACKAGES, blob: hasBlob(), lulu: { configured: lulu.hasLulu(), env: lulu.luluEnv(), levels: lulu.SHIPPING_LEVELS }, stripe: { configured: hasStripe(), mode: stripeMode() }, templates: TEMPLATES, ornaments: ORNAMENTS, ornamentColors: ORNAMENT_COLORS });
      case 'dashboard': {
        const counts = await q('SELECT status, count(*)::int AS n FROM orders GROUP BY status');
        const unread = (await one(`SELECT count(*)::int AS n FROM messages WHERE status='new'`)).n;
        const revenue = await one(`SELECT coalesce(sum(price_usd),0)::float AS booked FROM orders WHERE status <> 'cancelled'`);
        return res.json({ ok: true, counts, unread, booked: revenue.booked });
      }
      case 'orders': {
        const st = req.query.status;
        const rows = await q(`SELECT o.id, o.ref, o.status, o.customer_name, o.customer_email, o.package, o.copies, o.price_usd, o.deposit_paid, o.balance_paid, o.ship_country, o.updated_at, o.created_at,
          (SELECT count(*)::int FROM photos p WHERE p.order_id=o.id) AS photo_count
          FROM orders o ${st && STATUS_KEYS.includes(st) ? 'WHERE o.status=$1' : ''} ORDER BY o.updated_at DESC LIMIT 500`, st && STATUS_KEYS.includes(st) ? [st] : []);
        return res.json({ ok: true, orders: rows });
      }
      case 'order': {
        const d = await loadOrder(parseInt(req.query.id || body.id, 10));
        if (!d) return fail(res, 404, 'Order not found');
        return res.json({ ok: true, ...d, balanceDue: balanceDue(d.order), portalUrl: `${siteUrl(req)}/my/?t=${d.order.token}` });
      }
      case 'order-create': {
        if (!body.customer_name || !isEmail(body.customer_email)) return fail(res, 400, 'Customer name and a valid email are required');
        const o = await createOrder(body, who);
        return res.json({ ok: true, id: o.id });
      }
      case 'order-update': {
        const id = parseInt(body.id, 10); const cur = await one('SELECT * FROM orders WHERE id=$1', [id]);
        if (!cur) return fail(res, 404, 'Order not found');
        const sets = [], vals = [];
        for (const k of EDITABLE) if (k in body) {
          let v = body[k];
          if (k === 'status' && !STATUS_KEYS.includes(v)) return fail(res, 400, 'Unknown status');
          if (k === 'package' && !PACKAGES[v]) return fail(res, 400, 'Unknown package');
          if (k === 'copies') v = Math.max(1, Math.min(50, parseInt(v, 10) || 1));
          if (k === 'price_usd' || k === 'shipping_usd') v = v === '' || v == null ? null : Number(v);
          if (k === 'deposit_paid' || k === 'balance_paid') v = !!v;
          if (k === 'ship_level' && !lulu.SHIPPING_LEVELS.includes(v)) v = 'MAIL';
          if (k === 'template') v = templateKey(v);
          if (k === 'ornament') v = ornamentKey(v);
          if (k === 'ornament_color') v = ornamentColor(v);
          if (k === 'photo_style') v = ['full', 'mix', 'gallery'].includes(v) ? v : 'full';
          if (typeof v === 'string') v = clip(v, 4000);
          vals.push(v); sets.push(`${k}=$${vals.length}`);
        }
        if (body.recalcPrice) { vals.push(priceFor(body.package || cur.package, body.copies || cur.copies)); sets.push(`price_usd=$${vals.length}`); }
        if (!sets.length) return res.json({ ok: true });
        vals.push(id);
        await q(`UPDATE orders SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
        if (body.balance_paid === true && !cur.balance_paid && cur.status === 'approved' && !body.status) {
          await q(`UPDATE orders SET status='paid' WHERE id=$1`, [id]); await logEvent(id, who, 'Balance marked as paid — status: Approved & paid');
        }
        if (body.status && body.status !== cur.status) await logEvent(id, who, `Status: ${cur.status} → ${body.status}`);
        else if (body.template && Object.keys(body).length <= 2) await logEvent(id, who, `Book design: ${TEMPLATES[templateKey(body.template)].label}`);
        else await logEvent(id, who, 'Order details updated');
        if (body.status === 'shipped' && cur.status !== 'shipped' && cur.customer_email) {
          const tr = body.tracking || cur.tracking;
          await sendMail({ to: cur.customer_email, subject: `Your BOOKD book is on its way (${cur.ref})`,
            text: `Hello ${cur.customer_name || ''},\n\nYour BOOKD book has shipped.${tr ? `\nTracking: ${tr}` : ''}\n\nThank you!\nBOOKD` });
          await logEvent(id, 'system', 'Shipping email sent to customer');
        }
        return res.json({ ok: true });
      }
      case 'order-delete': {
        const oid = parseInt(body.id, 10);
        const files = [...(await q('SELECT url FROM photos WHERE order_id=$1', [oid])).map(r => r.url),
          ...(await q('SELECT credit_image FROM shoots WHERE order_id=$1', [oid])).map(r => r.credit_image),
          ...(await q('SELECT interior_url, cover_url, preview_url FROM proofs WHERE order_id=$1', [oid])).flatMap(r => [r.interior_url, r.cover_url, r.preview_url])].filter(Boolean);
        await q('DELETE FROM orders WHERE id=$1', [oid]);
        for (const f of files) await removePublic(f);
        await q('UPDATE messages SET order_id=NULL WHERE order_id=$1', [oid]);
        return res.json({ ok: true });
      }
      case 'note': {
        const id = parseInt(body.id, 10); if (!clip(body.text)) return fail(res, 400, 'Empty note');
        await logEvent(id, who, 'Note: ' + clip(body.text, 2000)); return res.json({ ok: true });
      }
      case 'messages': {
        const rows = await q(`SELECT * FROM messages ${req.query.all ? '' : `WHERE status <> 'archived'`} ORDER BY created_at DESC LIMIT 500`);
        return res.json({ ok: true, messages: rows });
      }
      case 'message-update': {
        if (!['new', 'read', 'archived'].includes(body.status)) return fail(res, 400, 'Unknown status');
        await q('UPDATE messages SET status=$1 WHERE id=$2', [body.status, parseInt(body.id, 10)]); return res.json({ ok: true });
      }
      case 'message-convert': {
        const m = await one('SELECT * FROM messages WHERE id=$1', [parseInt(body.id, 10)]);
        if (!m) return fail(res, 404, 'Message not found');
        if (m.order_id) return res.json({ ok: true, id: m.order_id });
        const key = Object.keys(PACKAGES).find(k => (m.package || '').toLowerCase().includes(PACKAGES[k].label.toLowerCase().slice(0, 5))) || 'signature';
        const o = await createOrder({ customer_name: m.name, customer_email: m.email, lang: m.lang, package: key, copies: 1, notes: `From website message #${m.id}:\n${m.message || ''}` }, who);
        await q(`UPDATE messages SET order_id=$1, status='read' WHERE id=$2`, [o.id, m.id]);
        return res.json({ ok: true, id: o.id });
      }
      case 'admins': return res.json({ ok: true, admins: await q('SELECT id, email, name, created_at FROM admins ORDER BY id') });
      case 'admin-add': {
        if (!isEmail(body.email) || (body.password || '').length < 8) return fail(res, 400, 'Email and a temporary password of 8+ characters are required');
        try { await q('INSERT INTO admins (email, name, password_hash) VALUES ($1,$2,$3)', [body.email.toLowerCase(), clip(body.name, 80), await bcrypt.hash(body.password, 10)]); }
        catch { return fail(res, 400, 'This email already has an account'); }
        return res.json({ ok: true });
      }
      case 'admin-remove': {
        if (parseInt(body.id, 10) === admin.id) return fail(res, 400, "You can't remove yourself");
        await q('DELETE FROM admins WHERE id=$1', [parseInt(body.id, 10)]); return res.json({ ok: true });
      }
      case 'password': {
        if ((body.password || '').length < 8) return fail(res, 400, 'Use 8+ characters');
        await q('UPDATE admins SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(body.password, 10), admin.id]); return res.json({ ok: true });
      }
      case 'send-portal': {
        const o = await one('SELECT * FROM orders WHERE id=$1', [parseInt(body.id, 10)]);
        if (!o || !isEmail(o.customer_email)) return fail(res, 400, 'Order needs a customer email');
        const url = `${siteUrl(req)}/my/?t=${o.token}`;
        const r = await sendMail({ to: o.customer_email, subject: `Your BOOKD book — upload your photos (${o.ref})`,
          text: `Hello ${o.customer_name || ''},\n\nThank you for choosing BOOKD! Use this private link to add your details, your shoots and your photos:\n\n${url}\n\nYou can come back to it any time. When everything is in, press "Send for layout".\n\nBOOKD` });
        if (o.status === 'new') await q(`UPDATE orders SET status='collecting', updated_at=now() WHERE id=$1`, [o.id]);
        await logEvent(o.id, who, r.skipped ? 'Portal link ready (email not configured — copy the link)' : 'Portal link emailed to customer');
        return res.json({ ok: true, url, emailed: !r.skipped });
      }
      case 'photo-update': {
        const id = parseInt(body.id, 10); const sets = [], vals = [];
        if ('keep' in body) { vals.push(!!body.keep); sets.push(`keep=$${vals.length}`); }
        if ('role' in body) { vals.push(body.role === 'cover' ? 'cover' : null); sets.push(`role=$${vals.length}`); }
        if ('position' in body) { vals.push(parseInt(body.position, 10) || 0); sets.push(`position=$${vals.length}`); }
        if (!sets.length) return res.json({ ok: true });
        if (body.role === 'cover') { const p = await one('SELECT order_id FROM photos WHERE id=$1', [id]); await q(`UPDATE photos SET role=NULL WHERE order_id=$1 AND role='cover'`, [p.order_id]); }
        vals.push(id); await q(`UPDATE photos SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
        return res.json({ ok: true });
      }
      case 'photo-move': { // body: {order:[photo ids]} in their new order (one shoot)
        const ids = (body.order || []).map(n => parseInt(n, 10));
        for (let i = 0; i < ids.length; i++) await q('UPDATE photos SET position=$1 WHERE id=$2', [i + 1, ids[i]]);
        return res.json({ ok: true });
      }
      case 'shoot-move': { // body: {order:[shoot ids]}
        const ids = (body.order || []).map(n => parseInt(n, 10));
        for (let i = 0; i < ids.length; i++) await q('UPDATE shoots SET position=$1 WHERE id=$2', [i + 1, ids[i]]);
        return res.json({ ok: true });
      }
      case 'layout-preview': {
        const d = await loadOrder(parseInt(req.query.id || body.id, 10)); if (!d) return fail(res, 404, 'Order not found');
        return res.json({ ok: true, layout: buildLayout(d.order, d.shoots, d.photos) });
      }
      case 'build-proof': {
        let r; try { r = await buildProof(parseInt(body.id, 10), siteUrl(req), who); } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
        await q(`UPDATE orders SET status = CASE WHEN status IN ('new','collecting','changes') THEN 'layout' ELSE status END, updated_at=now() WHERE id=$1`, [r.order.id]);
        return res.json({ ok: true, proofId: r.proofId, version: r.version, warnings: r.warnings, interior_url: r.interior_url, cover_url: r.cover_url });
      }
      case 'send-proof': {
        const p = await one('SELECT * FROM proofs WHERE id=$1', [parseInt(body.proofId, 10)]); if (!p) return fail(res, 404, 'Proof not found');
        const o = await one('SELECT * FROM orders WHERE id=$1', [p.order_id]);
        await q(`UPDATE proofs SET status='sent', sent_at=now() WHERE id=$1`, [p.id]);
        await q(`UPDATE proofs SET status='superseded' WHERE order_id=$1 AND id<>$2 AND status IN ('draft','sent')`, [o.id, p.id]);
        await q(`UPDATE orders SET status='proof_sent', updated_at=now() WHERE id=$1`, [o.id]);
        const url = `${siteUrl(req)}/my/?t=${o.token}#proof`;
        const r = isEmail(o.customer_email) ? await sendMail({ to: o.customer_email, subject: `Your BOOKD proof is ready (${o.ref}, version ${p.version})`,
          text: `Hello ${o.customer_name || ''},\n\nYour book proof is ready. Flip through it, leave a comment on any page, then approve it or ask for changes:\n\n${url}\n\nNothing is printed until you approve.\n\nBOOKD` }) : { skipped: true };
        await logEvent(o.id, who, `Proof v${p.version} sent${r.skipped ? ' (email not configured — share the link)' : ' to customer'}`);
        return res.json({ ok: true, url });
      }
      case 'comment-resolve': {
        await q('UPDATE proof_comments SET resolved=$1 WHERE id=$2', [!!body.resolved, parseInt(body.id, 10)]); return res.json({ ok: true });
      }
      // ---------- Lulu print jobs ----------
      case 'printer-quote':
      case 'printer-send': {
        const o = await one('SELECT * FROM orders WHERE id=$1', [parseInt(body.id, 10)]); if (!o) return fail(res, 404, 'Order not found');
        if (!lulu.hasLulu()) return fail(res, 400, 'Lulu is not connected yet: add LULU_CLIENT_KEY, LULU_CLIENT_SECRET and LULU_ENV in Vercel, then redeploy.');
        const p = await one(`SELECT * FROM proofs WHERE order_id=$1 AND status='approved' ORDER BY version DESC LIMIT 1`, [o.id]);
        if (!p) return fail(res, 400, 'The customer has not approved a proof yet. Only an approved proof can be printed.');
        const { address, problems } = lulu.addressFor(o);
        if (problems.length) return fail(res, 400, 'Shipping address incomplete: ' + problems.join(', '));
        const pkg = PACKAGES[o.package] || PACKAGES.signature, cover = p.layout?.binding || pkg.cover;
        const level = lulu.SHIPPING_LEVELS.includes(body.level) ? body.level : (o.ship_level || 'MAIL');
        let qt;
        try { qt = await lulu.quote({ cover, pages: p.page_count, quantity: o.copies || 1, address, level }); }
        catch (e) { return fail(res, 400, e.message); }
        const costTxt = `${qt.total.toFixed(2)} ${qt.currency} incl. tax (books ${qt.books.toFixed(2)} + shipping ${qt.shipping.toFixed(2)} + fee ${qt.fulfillment.toFixed(2)} + tax ${qt.tax.toFixed(2)}, ${level})`;
        if (action === 'printer-quote') return res.json({ ok: true, quote: qt, level, text: costTxt, env: lulu.luluEnv() });
        if (!o.balance_paid && !body.force) return fail(res, 400, `The balance isn't paid yet ($${balanceDue(o).toFixed(2)} USD). The customer pays it from their page after approving; for another payment method, tick "Balance paid" in the order details.`);
        if (o.printer_order_id && /^Lulu/.test(o.printer || '') && !['CANCELED', 'REJECTED', 'ERROR'].includes(o.printer_status) && !body.force)
          return fail(res, 400, `Already sent to Lulu (print job ${o.printer_order_id}, ${o.printer_status || 'status unknown'}).`);
        const toAbs = (u) => /^https?:/.test(u) ? u : siteUrl(req) + u;
        let pp;
        try { pp = await refreshPrintFiles(p, o, siteUrl(req), who); } catch (e) { return fail(res, 500, 'Could not regenerate the print files: ' + e.message); }
        let job;
        try { job = await lulu.createJob({ ref: o.ref, title: `BOOKD — ${o.profile?.name || o.customer_name || o.ref}`, cover, quantity: o.copies || 1,
          interiorUrl: toAbs(pp.interior_url), coverUrl: toAbs(pp.cover_url), address, level }); }
        catch (e) { await logEvent(o.id, who, 'Lulu refused the print job: ' + e.message); return fail(res, 400, e.message); }
        const env = lulu.luluEnv();
        await q(`UPDATE orders SET printer=$1, printer_order_id=$2, printer_status=$3, printer_env=$4, printer_cost=$5, ship_level=$6, printer_sent_at=now(),
          status = CASE WHEN status IN ('approved','paid','proof_sent','layout','changes') THEN 'printing' ELSE status END, updated_at=now() WHERE id=$7`,
          [env === 'production' ? 'Lulu' : 'Lulu (sandbox)', String(job.id), job.status?.name || 'CREATED', env, costTxt, level, o.id]);
        await logEvent(o.id, who, `Sent to Lulu${env === 'production' ? '' : ' SANDBOX (test, not printed)'}: print job ${job.id}, proof v${p.version}, ${o.copies || 1} cop${(o.copies || 1) > 1 ? 'ies' : 'y'}, ${level}. Quote ${costTxt}`);
        return res.json({ ok: true, jobId: job.id, status: job.status?.name, env, text: costTxt });
      }
      case 'printer-refresh': {
        const o = await one('SELECT * FROM orders WHERE id=$1', [parseInt(body.id, 10)]); if (!o) return fail(res, 404, 'Order not found');
        if (!o.printer_order_id || !/^Lulu/.test(o.printer || '')) return fail(res, 400, 'No Lulu print job on this order');
        if ((o.printer_env || 'sandbox') !== lulu.luluEnv()) return fail(res, 400, `This job was created in Lulu ${o.printer_env}; the site is now set to ${lulu.luluEnv()}.`);
        let job; try { job = await lulu.getJob(o.printer_order_id); } catch (e) { return fail(res, 400, e.message); }
        const st = job.status?.name || 'UNKNOWN', tr = lulu.trackingOf(job), trackTxt = tr.map(t => [t.carrier, t.id, t.url].filter(Boolean).join(' ')).join(' | ');
        const sets = ['printer_status=$1'], vals = [st];
        if (trackTxt) { vals.push(trackTxt); sets.push(`tracking=$${vals.length}`); }
        vals.push(o.id); await q(`UPDATE orders SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
        const why = lulu.problemsOf(job);
        if (st !== o.printer_status || (why && st === 'REJECTED')) await logEvent(o.id, 'Lulu', `Print job ${o.printer_order_id}: ${o.printer_status || '—'} → ${st}${job.status?.message ? ' (' + clip(job.status.message, 300) + ')' : ''}${why ? ' — Lulu says: ' + clip(why, 900) : ''}`);
        if (st === 'SHIPPED' && !['shipped', 'delivered'].includes(o.status)) {
          await q(`UPDATE orders SET status='shipped', updated_at=now() WHERE id=$1`, [o.id]);
          await logEvent(o.id, 'system', 'Status: printing → shipped (Lulu)');
          if (isEmail(o.customer_email)) {
            await sendMail({ to: o.customer_email, subject: `Your BOOKD book is on its way (${o.ref})`,
              text: `Hello ${o.customer_name || ''},\n\nYour BOOKD book has shipped.${trackTxt ? `\nTracking: ${trackTxt}` : ''}\n\nThank you!\nBOOKD` });
            await logEvent(o.id, 'system', 'Shipping email sent to customer');
          }
        }
        return res.json({ ok: true, status: st, message: [job.status?.message, why].filter(Boolean).join(' — '), tracking: trackTxt });
      }
      case 'printer-cancel': {
        const o = await one('SELECT * FROM orders WHERE id=$1', [parseInt(body.id, 10)]); if (!o) return fail(res, 404, 'Order not found');
        if (!o.printer_order_id) return fail(res, 400, 'No Lulu print job on this order');
        try { await lulu.cancelJob(o.printer_order_id); } catch (e) { return fail(res, 400, 'Lulu can only cancel a job before it is paid. ' + e.message); }
        await q(`UPDATE orders SET printer_status='CANCELED', status=CASE WHEN status='printing' THEN 'approved' ELSE status END, updated_at=now() WHERE id=$1`, [o.id]);
        await logEvent(o.id, who, `Lulu print job ${o.printer_order_id} cancelled`);
        return res.json({ ok: true });
      }
      default: return fail(res, 404, 'Unknown action');
    }
  });
}
