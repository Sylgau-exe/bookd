// lib/orders.js — creating orders and recording Stripe payments (shared by admin, checkout and webhook)
import crypto from 'node:crypto';
import { q, one, ensureSchema, logEvent } from './db.js';
import { PACKAGES, priceFor, extraPrice, normCover, coverOf, coverLabel } from './pricing.js';
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
  if (m.kind === 'reorder') { // v1.28 — more copies of an existing book, paid in full (book + shipping)
    const existing = await one('SELECT * FROM orders WHERE stripe_deposit_session=$1', [s.id]); if (existing) return existing;
    const parent = await one('SELECT * FROM orders WHERE id=$1', [parseInt(m.order_id, 10)]); if (!parent) return null;
    const cv = normCover(m.cover) || coverOf(parent), copies = parseInt(m.copies, 10) || 1;
    let o;
    try { o = await duplicateOrder(parent.id, { cover: cv, copies, origin: 'reorder', actor: 'customer', paid: { amount, shipping: Number(m.shipping || 0), session: s.id } }); }
    catch (e) { if (e.code === '23505') return one('SELECT * FROM orders WHERE stripe_deposit_session=$1', [s.id]); throw e; }
    if (o.proofReused) await q(`UPDATE orders SET status='paid' WHERE id=$1`, [o.id]);
    await logEvent(o.id, 'Stripe', `Paid in full: $${amount.toFixed(2)} USD (${s.livemode ? 'live' : 'TEST'} payment) — ${copies} more cop${copies > 1 ? 'ies' : 'y'}, ${coverLabel(cv).toLowerCase()}, shipping included`);
    await sendMail({ to: adminInbox(), subject: `[BOOKD] More copies: ${o.ref} (from ${parent.ref}) — ${copies} × ${coverLabel(cv)} — paid $${amount.toFixed(2)}`,
      text: `${parent.customer_name} ordered ${copies} more cop${copies > 1 ? 'ies' : 'y'} of ${parent.ref} (${coverLabel(cv).toUpperCase()}).\n${o.proofReused ? 'Same cover as the approved proof: open the order and press "Send to Lulu".' : 'OTHER COVER than the original: build a new proof and send it for approval.'}\n\n${site}/admin/#order/${o.id}` });
    if (!o.proofReused) { const r = await emailPortal(site, o, 'Thank you for your new order! Your book is in the other cover, so we will send you a proof to approve first.'); await logEvent(o.id, 'system', r.skipped ? 'Portal link ready (email not configured)' : 'Portal link emailed to customer'); }
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

// v1.28 — copy a book into a new order: same shoots, photos (same files), credits, profile, design and shipping address.
//   origin 'duplicate' (admin: e.g. the same book in the other cover) or 'reorder' (customer: more copies later).
//   Price = extra-copy price × copies (the design is already done — same rule as the volume discount).
//   Same cover as the approved proof → the approved proof is copied too, so the new order can go straight to Lulu.
//   Other cover → no proof: build one (cover size and Lulu product change) and send it for approval.
export async function duplicateOrder(srcId, { cover, copies = 1, origin = 'duplicate', actor = 'admin', status, paid } = {}) {
  await ensureSchema();
  const src = await one('SELECT * FROM orders WHERE id=$1', [srcId]); if (!src) throw Object.assign(new Error('Order not found'), { status: 404 });
  const cv = normCover(cover) || coverOf(src), n = Math.max(1, Math.min(50, parseInt(copies, 10) || 1));
  const proof = await one(`SELECT * FROM proofs WHERE order_id=$1 AND status='approved' ORDER BY version DESC LIMIT 1`, [src.id]);
  const proofCover = proof ? ((typeof proof.layout === 'string' ? JSON.parse(proof.layout) : proof.layout)?.binding || coverOf(src)) : null;
  const reuse = !!proof && proofCover === cv;
  const price = extraPrice(src.package, cv) * n;
  const o = await createOrder({ customer_name: src.customer_name, customer_email: src.customer_email, phone: src.phone, lang: src.lang, package: src.package, cover: cv, copies: n,
    notes: `${origin === 'reorder' ? 'More copies ordered by the customer' : 'Duplicate'} of ${src.ref} (${coverLabel(cv).toLowerCase()}, ${n} cop${n > 1 ? 'ies' : 'y'}).` }, actor);
  const st = status || (reuse ? 'approved' : 'layout');
  await q(`UPDATE orders SET parent_id=$1, origin=$2, price_usd=$3, status=$4, profile=$5, template=$6, ornament=$7, ornament_color=$8, photo_style=$9,
      ship_name=$10, ship_address=$11, ship_city=$12, ship_region=$13, ship_postal=$14, ship_country=$15, ship_level=$16, submitted_at=now(), updated_at=now() WHERE id=$17`,
    [src.id, origin, price, st, JSON.stringify(src.profile || {}), src.template, src.ornament, src.ornament_color, src.photo_style,
     src.ship_name, src.ship_address, src.ship_city, src.ship_region, src.ship_postal, src.ship_country, src.ship_level, o.id]);
  // shoots + photos (the files are shared, not copied)
  const shootMap = new Map(), photoMap = new Map();
  for (const s of await q('SELECT * FROM shoots WHERE order_id=$1 ORDER BY position, id', [src.id])) {
    const ns = await one(`INSERT INTO shoots (order_id, position, kind, title, credits, story, credit_image, credit_image_kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [o.id, s.position, s.kind, s.title, JSON.stringify(s.credits || []), s.story, s.credit_image, s.credit_image_kind]);
    shootMap.set(s.id, ns.id);
  }
  for (const p of await q('SELECT * FROM photos WHERE order_id=$1 ORDER BY id', [src.id])) {
    const np = await one(`INSERT INTO photos (order_id, shoot_id, position, url, filename, width, height, bytes, low_res, keep, role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [o.id, shootMap.get(p.shoot_id) || null, p.position, p.url, p.filename, p.width, p.height, p.bytes, p.low_res, p.keep, p.role]);
    photoMap.set(p.id, np.id);
  }
  if (reuse) {
    const L = typeof proof.layout === 'string' ? JSON.parse(proof.layout) : (proof.layout || {});
    const remapPage = (pg) => ({ ...pg, ...(pg.photoId ? { photoId: photoMap.get(pg.photoId) || pg.photoId } : {}), ...(pg.shootId ? { shootId: shootMap.get(pg.shootId) || pg.shootId } : {}),
      ...(pg.items ? { items: pg.items.map(it => ({ ...it, photoId: photoMap.get(it.photoId) || it.photoId })) } : {}) });
    const layout = { ...L, pages: (L.pages || []).map(remapPage), cover: L.cover ? { ...L.cover, photoId: photoMap.get(L.cover.photoId) || L.cover.photoId } : L.cover };
    await q(`INSERT INTO proofs (order_id, version, status, layout, interior_url, cover_url, preview_url, page_count, sent_at, decided_at) VALUES ($1,1,'approved',$2,$3,$4,$5,$6,now(),now())`,
      [o.id, JSON.stringify(layout), proof.interior_url, proof.cover_url, proof.preview_url, proof.page_count]);
  }
  if (paid) await q(`UPDATE orders SET deposit_paid=true, balance_paid=true, deposit_usd=$1, paid_usd=$1, shipping_usd=$2, stripe_deposit_session=$3, updated_at=now() WHERE id=$4`,
    [paid.amount, paid.shipping, paid.session, o.id]);
  await logEvent(o.id, actor, `${origin === 'reorder' ? 'Re-order' : 'Duplicate'} of ${src.ref}: ${PACKAGES[src.package]?.label} ${coverLabel(cv).toLowerCase()}, ${n} cop${n > 1 ? 'ies' : 'y'} at $${extraPrice(src.package, cv)} each. ${reuse ? `Approved proof v${proof.version} reused: ready to print.` : 'Other cover: build a proof and send it for approval.'}`);
  await logEvent(src.id, actor, `${origin === 'reorder' ? 'Customer ordered more copies' : 'Duplicated'} → ${o.ref} (${coverLabel(cv).toLowerCase()}, ${n} cop${n > 1 ? 'ies' : 'y'})`);
  return { ...(await one('SELECT * FROM orders WHERE id=$1', [o.id])), proofReused: reuse };
}
