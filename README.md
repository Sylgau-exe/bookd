# BOOKD — v1.3

Public site (5 languages) + performer portal + admin back office (English).

| Part | URL | Who |
|---|---|---|
| Public site | `/` | everyone |
| Admin back office | `/admin` | Leila and you (login) |
| Performer portal | `/my/?t=…` (private link per order) | the performer |

## What's new in v1.1
- **Admin** (`/admin`): orders pipeline, order sheet (customer, package, copies, price, payments, shipping, printer & tracking, notes, timeline), website messages (convert to order), team accounts.
- **Performer portal**: profile, shipping address, shoots with credits + story, photo uploads (low-res flagged, not blocked), cover choice, "Send for layout".
- **Proofs**: one click builds the layout + print PDFs (interior 8.125 x 10.25 in with bleed, and front cover). The performer flips the proof online, comments per page, then approves (accepting flagged photos) or asks for changes. Nothing prints before approval.
- **Emails** (Resend): portal link, proof ready, shipped (to the performer); photos submitted, proof approved / changes (to you).
- Contact-form messages are now also saved in the admin "Messages".

## One-time setup in Vercel (project `bookd`)
1. **Database** — Vercel → bookd → **Storage → Create / Connect → Neon (Postgres)** → connect to the project. This adds `DATABASE_URL` automatically. Tables are created automatically on first use.
2. **File storage** — Vercel → bookd → **Storage → Create → Blob** → choose **Public** access (it cannot be changed later) and the region closest to your customers → connect it to the `bookd` project.
3. **Environment variables** (Settings → Environment Variables), in addition to the Resend ones you already have:
   - `JWT_SECRET` = any long random text (40+ characters) — signs admin logins
   - `ADMIN_SETUP_KEY` = the password for your first sign-in
   - `SITE_URL` = `https://bookd-nine.vercel.app` (or your future domain) — used in email links
4. **Upload these files to GitHub** (replace everything in the repo) → Vercel redeploys automatically. If it doesn't, Deployments → Redeploy.
5. Open `/admin` and sign in with **your email + the ADMIN_SETUP_KEY value as password**. That first sign-in creates your admin account (change the password later under Team).
6. In **Team**, add Leila with a temporary password.

## Daily flow
Message or new order → **Email link to customer** → performer fills the portal and presses **Send for layout** → you get an email → **Build new proof** → check the PDFs → **Send to customer** → performer approves → set status **Printing**, upload the PDFs to the printer, note the printer order # → set **Shipped** with the tracking # (the performer gets an email).

## Notes
- Print PDFs follow the Blurb 8x10 Standard Portrait interior size. The full wrap-around cover (front + spine + back) depends on the printer and page count; use the front-cover PDF with the printer's cover template for now.
- Prices come from the cost model v6 (`lib/pricing.js`).

## v1.2
- Works with Blob stores connected through OIDC (no read-write token): uploads then go through the site (max ~4 MB per photo). With `BLOB_READ_WRITE_TOKEN` present, large originals upload straight to Blob.

## v1.3
- Simpler admin access: one Sign in screen (email + password). The very first sign-in uses ADMIN_SETUP_KEY as the password and creates your account. Extra spaces are ignored.
