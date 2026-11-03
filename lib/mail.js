// lib/mail.js — email through Resend (same settings as the contact form)
export async function sendMail({ to, subject, text, replyTo }) {
  if (!process.env.RESEND_API_KEY) { console.log('[mail skipped — no RESEND_API_KEY]', subject, '→', to); return { skipped: true }; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'BOOKD <onboarding@resend.dev>', to: Array.isArray(to) ? to : [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) })
  });
  if (!r.ok) { console.error('Resend error', r.status, await r.text()); return { ok: false }; }
  return { ok: true };
}
export const adminInbox = () => process.env.CONTACT_TO || 'sgauthier@executiveproducer.ca';
