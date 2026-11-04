// api/stripe-webhook.js — Stripe → BOOKD (checkout.session.completed). Backup for customers who close the tab before returning.
import { ensureSchema, hasDb } from '../lib/db.js';
import { readRaw, siteUrl } from '../lib/http.js';
import { verifyWebhook } from '../lib/stripe.js';
import { recordPaidSession } from '../lib/orders.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const raw = (await readRaw(req, 1024 * 1024)).toString('utf8');
    if (!verifyWebhook(raw, req.headers['stripe-signature'])) return res.status(400).json({ ok: false, error: 'bad signature' });
    const ev = JSON.parse(raw);
    if (hasDb() && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type)) {
      await ensureSchema(); await recordPaidSession(siteUrl(req), ev.data.object);
    }
    return res.json({ received: true });
  } catch (e) { console.error('stripe webhook', e); return res.status(500).json({ ok: false }); }
}
