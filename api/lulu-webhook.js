// api/lulu-webhook.js — v1.33: Lulu → BOOKD when a print job changes status (topic PRINT_JOB_STATUS_CHANGED).
// The message is only used as a "something changed" signal: BOOKD then reads the job from Lulu itself,
// so nothing in the incoming message is trusted.
import { one, ensureSchema, hasDb } from '../lib/db.js';
import { readRaw, siteUrl } from '../lib/http.js';
import { syncOrder, webhookSigned } from '../lib/shipping.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const raw = (await readRaw(req, 1024 * 1024)).toString('utf8');
    let ev = {}; try { ev = JSON.parse(raw); } catch { return res.json({ received: true }); }
    const jobId = String(ev?.data?.id ?? '').trim();
    if (!hasDb() || !/^\d{1,12}$/.test(jobId)) return res.json({ received: true });
    await ensureSchema();
    const o = await one(`SELECT * FROM orders WHERE printer_order_id=$1 AND printer ~ '^Lulu'`, [jobId]);
    if (!o) return res.json({ received: true });
    // at most one check per order every 20 seconds
    if (o.printer_checked_at && Date.now() - new Date(o.printer_checked_at).getTime() < 20000) return res.json({ received: true });
    if (!webhookSigned(raw, req.headers['lulu-hmac-sha256'])) console.warn('lulu webhook: signature not verified for job', jobId);
    await syncOrder(o, { site: siteUrl(req) });
    return res.json({ received: true });
  } catch (e) { console.error('lulu webhook', e); return res.status(200).json({ received: true }); }
}
