# BOOKD — v1.12

Public site (5 languages) + performer portal + admin back office (English).

| Part | URL | Who |
|---|---|---|
| Public site | `/` | everyone |
| Admin back office | `/admin` | Leila and you (login) |
| Performer portal | `/my/?t=…` (private link per order) | the performer |

## What's new in v1.1
- **Admin** (`/admin`): orders pipeline, order sheet (customer, package, copies, price, payments, shipping, printer & tracking, notes, timeline), website messages (convert to order), team accounts.
- **Performer portal**: profile, shipping address, shoots with credits + story, photo uploads (low-res flagged, not blocked), cover choice, "Send for layout".
- **Proofs**: one click builds the layout + print PDFs to Lulu's specs (interior 8.75 x 11.25 in = US Letter + bleed, and the full wrap-around cover). The performer flips the proof online, comments per page, then approves (accepting flagged photos) or asks for changes. Nothing prints before approval.
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
Message or new order → **Email link to customer** → performer fills the portal and presses **Send for layout** → you get an email → **Build new proof** → check the PDFs → **Send to customer** → performer approves → **Print with Lulu → Get Lulu price → Send to Lulu** → pay the job in Lulu → Print Jobs (if Lulu shows it as unpaid) → **Refresh status**: when Lulu reports SHIPPED, the order moves to Shipped, the tracking is saved and the performer gets the shipping email.

## Notes
- Print PDFs follow Lulu's photo book specs: US Letter 8.5 x 11 in, premium colour, 80# white coated, glossy cover. The cover size comes from Lulu for each page count.
- Prices are in `lib/pricing.js` (unchanged from cost model v6; Lulu print costs are in cost model v7).

## v1.2
- Works with Blob stores connected through OIDC (no read-write token): uploads then go through the site (max ~4 MB per photo). With `BLOB_READ_WRITE_TOKEN` present, large originals upload straight to Blob.

## v1.3
- Simpler admin access: one Sign in screen (email + password). The very first sign-in uses ADMIN_SETUP_KEY as the password and creates your account. Extra spaces are ignored.

## v1.4
- Deleting an order also deletes its stored photos and proof PDFs.
- Admin photo thumbnails: larger, clearer Hide / Cover buttons.
- Proof pages in the performer portal: sized for reading, no empty white half on the first spread.

## v1.5
- Actor sample book (Raphaël Vachon): new film-set, stage and "Transformations" photos replace the earlier drafts; the Transformations shoot now has 3 photos.

## v1.6
- "Who it's for": Photographers and Agencies added in all 5 languages (also in the contact form), with a line on offering the book to clients or a roster at volume pricing.

## v1.7
- Full re-test of the public site in all 5 languages, the back office and the performer portal.
- Spanish, Portuguese and Italian versions of the last two untranslated shoot titles.
- Screen-reader labels (book arrows, language menu, 3D books) translated into all 5 languages.
- First admin sign-in on a brand-new database no longer fails if two requests arrive at once.

## v1.8 — Lulu
- **Printer: Lulu Print API.** New "Print with Lulu" panel on each order: Lulu price (books + shipping + fee + tax), **Send to Lulu** (only once the customer has approved a proof), Refresh status, Cancel (before payment). Status SHIPPED from Lulu → order Shipped + tracking + shipping email.
- **Format: US Letter 8.5 x 11 in** (Lulu has no 8 x 10). Interior PDF 8.75 x 11.25 in with bleed; full wrap-around cover (back + spine + front) sized by Lulu's cover-dimensions API.
- Lulu minimums: softcover 32 pages, hardcover 24. Proofs are padded with blank pages before the closing page (the admin shows a warning). **Essentiel is now 32 pages** (site, all 5 languages).
- Public site: "8.5 × 11", "premium coated paper", shipping estimates from Lulu rates (cost model v7). Prices unchanged.
- Portal: country and state hints, phone required (couriers need it). Country names in EN/FR/ES/PT/IT or 2-letter codes are converted for Lulu.

### New environment variables (Vercel → bookd → Settings → Environment Variables)
| Name | Value |
|---|---|
| `LULU_CLIENT_KEY` | Client key from developers.**sandbox**.lulu.com → API Keys (test) or developers.lulu.com (live) |
| `LULU_CLIENT_SECRET` | Client secret from the same page |
| `LULU_ENV` | `sandbox` for tests, `production` to really print |
| `LULU_CONTACT_EMAIL` | Email Lulu contacts about print jobs (optional, default CONTACT_TO) |

Sandbox jobs are never printed and are paid with a test card in the sandbox Print Jobs page. Switch to live = change the three LULU_ values to the production keys + `production`, then redeploy.

## v1.9 — Online payment (Stripe)
- **Reserve = pay the deposit.** On the public site, "Reserve my spot" opens Stripe Checkout for the deposit (DEPOSIT_PERCENT of the package price, default 50%; copies from the estimator). When it's paid, the order is **created automatically**, marked "deposit paid", the performer lands straight on their private portal and receives the link by email; you get a "New order" email.
- **Balance.** After the performer approves the proof, set **Shipping (USD)** on the order (use the Lulu price). The portal then shows "Pay the balance" (book + shipping − paid). When paid, the order shows "balance paid" and you get an email. "Send to Lulu" warns if the balance isn't paid.
- Without Stripe keys, the site falls back to the reservation form as before.

### Stripe setup (test mode first)
1. Stripe dashboard → switch on **Test mode** → Developers → **API keys** → copy the **Secret key** (`sk_test_…`).
2. Developers → **Webhooks** → Add endpoint `https://bookd-nine.vercel.app/api/stripe-webhook`, event **checkout.session.completed** → copy the **Signing secret** (`whsec_…`).
3. Vercel environment variables:

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (later `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 2 |
| `DEPOSIT_PERCENT` | optional, default `50` |

Test card: **4242 4242 4242 4242**, any future date, any CVC, any postal code. Payments show as TEST in the order timeline.

## v1.10 — Full pages only
- **Every photo prints full page** (full bleed, no white frame), in the PDF, the online proof and the sample books on the site.
- Resolution flags are **warnings only**, they never change the layout: under 1400 px on the short side = "may print soft", under 1000 px = "too small" (ask for the original). Instagram exports (1440 x 1800, about 160 dpi) pass without a flag.
- Flags are recalculated when an order is opened, so photos uploaded earlier follow the new rule.
- FAQ updated in the 5 languages.

## v1.11 — Book designs
- **Book design** panel on each order (admin): 4 designs shown as mini previews with the customer's own cover photo — **Éditorial** (default), **Noir**, **Minimal**, **Couleur**. One click saves it; "Build a new proof with this design" applies it.
- Photos stay full page in every design. A design changes the cover (name font, shade, back colour), the bio, credit and closing pages, and the colours. Couleur gives each shoot its own colour.
- The customer's online proof shows the same design as the PDF.
- New file: `lib/templates.js` (the 4 designs; add or adjust one there).

## v1.12 — Cover and photo order made easy
- Performer portal: a **"How to build your book"** guide at the top of Shoots & photos, a **"Your cover"** box showing the chosen cover, and a clear bar under every photo: **◀ ▶** (move), **★ Cover**, **✕** (remove). **↑ Move up / ↓ Move down** on each shoot. The order on screen is the order in the book.
- Admin: the same **◀ ▶** on each photo and **↑ ↓** on each shoot; then "Build new proof".
- The cover is chosen among the uploaded photos (no separate upload) and is not repeated inside the book.
