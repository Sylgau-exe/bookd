// BOOKD contact form -> saved in the database (admin "Messages") + email via Resend
// Vercel environment variables: RESEND_API_KEY, RESEND_FROM, CONTACT_TO (see README)
import { q, ensureSchema, hasDb } from '../lib/db.js';
import { sendMail, adminInbox } from '../lib/mail.js';
import { readJson } from '../lib/http.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  try {
    const b = await readJson(req);
    if (b.website) return res.status(200).json({ ok: true }); // honeypot
    const clip = (v, n) => String(v || '').trim().slice(0, n);
    const name = clip(b.name, 120), email = clip(b.email, 200), message = clip(b.message, 5000);
    const type = clip(b.type, 20) === 'reservation' ? 'Reservation' : 'Question';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'invalid' });
    let saved = false;
    if (hasDb()) {
      try { await ensureSchema(); await q('INSERT INTO messages (type, name, email, discipline, package, message, lang) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [type, name, email, clip(b.discipline, 80), clip(b.package, 80), message, clip(b.lang, 5)]); saved = true; }
      catch (e) { console.error('save message', e); }
    }
    if (!process.env.RESEND_API_KEY) return saved ? res.json({ ok: true }) : res.status(503).json({ ok: false, error: 'email not configured' });
    const text = [`Type: ${type}`, `Name: ${name}`, `Email: ${email}`, `Discipline: ${clip(b.discipline, 80)}`, `Package: ${clip(b.package, 80)}`, `Site language: ${clip(b.lang, 5)}`, '', message || '(no message)'].join('\n');
    const r = await sendMail({ to: adminInbox(), subject: `[BOOKD] ${type} — ${name}`, text, replyTo: email });
    if (!r.ok && !saved) return res.status(502).json({ ok: false });
    return res.status(200).json({ ok: true });
  } catch (e) { console.error('contact error', e); return res.status(500).json({ ok: false }); }
}
