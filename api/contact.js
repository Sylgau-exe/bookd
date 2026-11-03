// BOOKD contact form -> email via Resend (https://resend.com)
// Vercel environment variables:
//   RESEND_API_KEY  (required)  your Resend API key
//   CONTACT_TO      (optional)  where messages go, default sgauthier@executiveproducer.ca
//   RESEND_FROM     (optional)  verified sender, e.g. "BOOKD <hello@yourdomain.com>"; default onboarding@resend.dev (test only)
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false }); }
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (b.website) return res.status(200).json({ ok: true }); // honeypot: bots fill this hidden field
    const clip = (v, n) => String(v || "").trim().slice(0, n);
    const name = clip(b.name, 120), email = clip(b.email, 200), message = clip(b.message, 5000);
    const type = clip(b.type, 20) === "reservation" ? "Reservation" : "Question";
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: "invalid" });
    if (!process.env.RESEND_API_KEY) return res.status(503).json({ ok: false, error: "email not configured" });
    const text = [
      `Type: ${type}`, `Name: ${name}`, `Email: ${email}`,
      `Discipline: ${clip(b.discipline, 80)}`, `Package: ${clip(b.package, 80)}`, `Site language: ${clip(b.lang, 5)}`,
      "", message || "(no message)"
    ].join("\n");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "BOOKD <onboarding@resend.dev>",
        to: [process.env.CONTACT_TO || "sgauthier@executiveproducer.ca"],
        reply_to: email,
        subject: `[BOOKD] ${type} — ${name}`,
        text
      })
    });
    if (!r.ok) { console.error("Resend error", r.status, await r.text()); return res.status(502).json({ ok: false }); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("contact error", e);
    return res.status(500).json({ ok: false });
  }
}
