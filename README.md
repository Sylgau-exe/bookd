# BOOKD website — v1.0

Static one-page site (5 languages) + one serverless function for the contact form.

## Files
- `index.html` — the whole site
- `images/` — sample book images (AI-generated, fictional performers)
- `api/contact.js` — sends contact/reservation messages by email through Resend

## Put it online (GitHub web + Vercel, no command line)
1. GitHub → New repository → name it `bookd` (private) → create.
2. "uploading an existing file" → drag the **contents** of this folder (index.html, images, api, README.md) → Commit.
3. Vercel → Add New → Project → import `bookd` → Framework preset: **Other** → Deploy.
4. Vercel → Project → Settings → Environment Variables:
   - `RESEND_API_KEY` = your Resend key
   - `CONTACT_TO` = where messages should arrive (default sgauthier@executiveproducer.ca)
   - `RESEND_FROM` = a sender on a domain verified in Resend, e.g. `BOOKD <hello@bookd.example>`
   Then Deployments → Redeploy.
5. Test the form. Without the Resend key the site still works: the form shows the message for the visitor to copy and email.

## Later
- Stripe deposit: set `STRIPE_DEPOSIT_URL` near the top of the script in index.html to your Stripe Payment Link.
- Custom domain: Vercel → Settings → Domains.
- Database (Neon) only when the production tool (uploads, proofs, orders) is built.
