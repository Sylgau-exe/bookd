// api/cron/lulu-sync.js — v1.33: hourly check of every open Lulu print job (see "crons" in vercel.json).
// Vercel calls it with "Authorization: Bearer CRON_SECRET" when CRON_SECRET is set in the project (recommended).
import { ensureSchema, hasDb } from '../../lib/db.js';
import { siteUrl } from '../../lib/http.js';
import { syncOpenJobs, ensureWebhook } from '../../lib/shipping.js';
export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!hasDb()) return res.json({ ok: true, skipped: 'no database' });
  try {
    await ensureSchema();
    const site = siteUrl(req);
    const webhook = await ensureWebhook(site);
    const r = await syncOpenJobs({ site });
    return res.json({ ok: true, ...r, webhook: webhook.ok ? 'on' : webhook.skipped ? 'skipped' : 'off' });
  } catch (e) { console.error('lulu-sync cron', e); return res.status(500).json({ ok: false }); }
}
