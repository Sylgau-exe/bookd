// lib/http.js — small helpers shared by every endpoint
export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}
export async function readRaw(req, limit = 4.4 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' }); chunks.push(c); }
  return Buffer.concat(chunks);
}
export function fail(res, status, error) { return res.status(status).json({ ok: false, error }); }
export const clip = (v, n = 500) => (v == null ? '' : String(v).trim().slice(0, n));
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
export async function handle(req, res, fn) {
  try { return await fn(); }
  catch (e) {
    console.error(e);
    if (e.code === 'NO_DB') return fail(res, 503, 'Database not configured');
    if (e.code === 'TOO_LARGE') return fail(res, 413, 'File too large for direct upload');
    return fail(res, 500, 'Server error');
  }
}
