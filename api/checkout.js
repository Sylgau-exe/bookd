// api/checkout.js — Stripe Checkout: deposit from the public site (creates the order), balance from the performer portal.
//   GET  /api/checkout?action=config                → { enabled, mode, depositPct }
//   POST /api/checkout?action=deposit {package, cover, copies, lang} → { url }
//   POST /api/checkout?action=balance&t=TOKEN       → { url }
//   POST /api/checkout?action=reorder&t=TOKEN {copies, cover} → { url }  (v1.28: more copies of a printed book)
//   GET  /api/checkout?action=return&session_id=…   → records the payment, redirects to the performer portal
import { one, ensureSchema, hasDb } from '../lib/db.js';
import { readJson, fail, siteUrl, handle } from '../lib/http.js';
import { PACKAGES, priceFor, discountFor, normCover, coverOf, coverLabel, extraPrice, shippingFor } from '../lib/pricing.js';
import * as stripe from '../lib/stripe.js';
import { recordPaidSession, balanceDue, portalLink } from '../lib/orders.js';
import { countryCode } from '../lib/lulu.js';
export default async function handler(req, res) {
  const action = req.query.action;
  return handle(req, res, async () => {
    if (action === 'config') { const d = discountFor(req.query.code); return res.json({ ok: true, enabled: stripe.hasStripe() && hasDb(), mode: stripe.stripeMode(), depositPct: stripe.depositPct(), discount: d ? d.pct : 0 }); }
    if (!stripe.hasStripe()) return fail(res, 503, 'Online payment is not available yet');
    if (!hasDb()) return fail(res, 503, 'Not available yet');
    await ensureSchema();
    const site = siteUrl(req);
    if (action === 'deposit' && req.method === 'POST') {
      const b = await readJson(req);
      const pkg = PACKAGES[b.package] ? b.package : null; if (!pkg) return fail(res, 400, 'Unknown package');
      const copies = Math.max(1, Math.min(50, parseInt(b.copies, 10) || 1)), lang = ['fr', 'en', 'es', 'pt', 'it'].includes(b.lang) ? b.lang : 'en';
      const cover = normCover(b.cover) || 'soft';
      const disc = discountFor(b.code); // secret code: silently ignored when unknown
      const total = priceFor(pkg, copies, cover), net = disc ? total * (100 - disc.pct) / 100 : total;
      const deposit = Math.max(0.5, Math.round(net * stripe.depositPct()) / 100);
      const s = await stripe.createSession({ amountUsd: deposit, lang, collectPhone: true,
        name: `BOOKD ${PACKAGES[pkg].label} ${coverLabel(cover)} — deposit (${stripe.depositPct()}%)`,
        description: `${PACKAGES[pkg].pages} pages, ${coverLabel(cover).toLowerCase()}, ${copies} cop${copies > 1 ? 'ies' : 'y'} · book total $${total} USD${disc ? ` − ${disc.pct}% private discount` : ''} + shipping. Balance due after you approve your proof.`,
        successUrl: `${site}/api/checkout?action=return&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${site}/?lang=${lang}#packages`,
        metadata: { kind: 'deposit', package: pkg, cover, copies: String(copies), lang, ...(disc ? { discount_code: disc.code, discount_pct: String(disc.pct) } : {}) } });
      return res.json({ ok: true, url: s.url });
    }
    if (action === 'balance' && req.method === 'POST') {
      const t = String(req.query.t || ''); const o = t.length >= 32 ? await one('SELECT * FROM orders WHERE token=$1', [t]) : null;
      if (!o) return fail(res, 404, 'Order not found');
      if (o.balance_paid) return fail(res, 400, 'The balance is already paid. Thank you!');
      if (o.shipping_usd == null) return fail(res, 400, 'We are confirming your shipping cost; you will receive the final amount shortly.');
      const due = balanceDue(o); if (due <= 0) return fail(res, 400, 'Nothing left to pay. Thank you!');
      const s = await stripe.createSession({ amountUsd: due, lang: o.lang, email: o.customer_email,
        name: `BOOKD ${PACKAGES[o.package]?.label || ''} ${coverLabel(coverOf(o))} — balance (${o.ref})`, description: `Book $${Number(o.price_usd).toFixed(2)} + shipping $${Number(o.shipping_usd).toFixed(2)}${o.discount_pct ? ` − ${o.discount_pct}% private discount` : ''} − paid $${Number(o.paid_usd || o.deposit_usd || 0).toFixed(2)}`,
        successUrl: `${site}/api/checkout?action=return&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${portalLink(site, o)}#proof`,
        metadata: { kind: 'balance', order_id: String(o.id), ref: o.ref } });
      return res.json({ ok: true, url: s.url });
    }
    if (action === 'reorder' && req.method === 'POST') { // v1.28 — more copies of a book already approved and printed
      const t = String(req.query.t || ''); const o = t.length >= 32 ? await one('SELECT * FROM orders WHERE token=$1', [t]) : null;
      if (!o) return fail(res, 404, 'Order not found');
      if (!['paid', 'printing', 'shipped', 'delivered'].includes(o.status)) return fail(res, 400, 'You can order more copies once your book is approved and printed.');
      const b = await readJson(req);
      const copies = Math.max(1, Math.min(50, parseInt(b.copies, 10) || 1)), cover = normCover(b.cover) || coverOf(o);
      const cc = countryCode(o.ship_country); if (!cc) return fail(res, 400, 'We need your shipping country: write to us and we will set it up.');
      const book = extraPrice(o.package, cover) * copies, shipping = shippingFor(cc, copies);
      const s = await stripe.createSession({ amountUsd: book + shipping, lang: o.lang, email: o.customer_email,
        name: `BOOKD ${PACKAGES[o.package]?.label || ''} ${coverLabel(cover)} — ${copies} more cop${copies > 1 ? 'ies' : 'y'} (${o.ref})`,
        description: `${copies} × $${extraPrice(o.package, cover)} + shipping $${shipping} to ${[o.ship_city, o.ship_country].filter(Boolean).join(', ')}. Same book as ${o.ref}${cover !== coverOf(o) ? ' in the other cover (you approve a proof first)' : ''}.`,
        successUrl: `${site}/api/checkout?action=return&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${portalLink(site, o)}#proof`,
        metadata: { kind: 'reorder', order_id: String(o.id), ref: o.ref, copies: String(copies), cover, shipping: String(shipping) } });
      return res.json({ ok: true, url: s.url, book, shipping, total: book + shipping });
    }
    if (action === 'return') {
      const id = String(req.query.session_id || ''); if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return fail(res, 400, 'Invalid session');
      const s = await stripe.getSession(id);
      const o = await recordPaidSession(site, s);
      res.statusCode = 303;
      res.setHeader('Location', o ? `${portalLink(site, o)}&paid=${s.metadata?.kind === 'balance' ? 'balance' : s.metadata?.kind === 'reorder' ? 'reorder' : 'deposit'}` : `${site}/?payment=pending#contact`);
      return res.end();
    }
    return fail(res, 404, 'Unknown action');
  });
}
