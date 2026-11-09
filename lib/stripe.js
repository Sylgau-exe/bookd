// lib/stripe.js — Stripe Checkout without the SDK (fetch + form encoding). Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, DEPOSIT_PERCENT (default 50)
import crypto from 'node:crypto';
export const hasStripe = () => !!process.env.STRIPE_SECRET_KEY;
export const stripeMode = () => /^(sk|rk)_live_/.test((process.env.STRIPE_SECRET_KEY || '').trim()) ? 'live' : 'test'; // v1.27: restricted live keys (rk_live_) count as live
export const depositPct = () => Math.min(100, Math.max(10, parseInt(process.env.DEPOSIT_PERCENT || '50', 10) || 50));
const base = () => process.env.STRIPE_API_BASE || 'https://api.stripe.com';
function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
}
async function call(method, path, body) {
  if (!hasStripe()) throw Object.assign(new Error('Stripe is not configured (STRIPE_SECRET_KEY)'), { code: 'NO_STRIPE' });
  const r = await fetch(base() + path, { method, headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? form(body).join('&') : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Stripe ${r.status}: ${j.error?.message || 'error'}`), { code: 'STRIPE' });
  return j;
}
const LOCALES = { fr: 'fr-CA', en: 'en', es: 'es', pt: 'pt-BR', it: 'it' };
// one-line Checkout Session in USD
export function createSession({ amountUsd, name, description, email, lang, successUrl, cancelUrl, metadata, collectPhone }) {
  return call('POST', '/v1/checkout/sessions', {
    mode: 'payment', success_url: successUrl, cancel_url: cancelUrl, locale: LOCALES[lang] || 'auto', customer_email: email || undefined,
    customer_creation: 'always', billing_address_collection: 'auto', phone_number_collection: collectPhone ? { enabled: 'true' } : undefined,
    line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(amountUsd * 100), product_data: { name, description: description || undefined } } } },
    metadata, payment_intent_data: { metadata, description: name },
  });
}
export const getSession = (id) => call('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
// webhook signature (Stripe-Signature: t=...,v1=...)
export function verifyWebhook(raw, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET; if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!parts.t || !sigs.length || Math.abs(Date.now() / 1000 - +parts.t) > 600) return false;
  const exp = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some(s => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
}
