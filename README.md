# BOOKD — v1.28

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

## v1.13 — One resolution flag only
- A photo is flagged only when it would clearly print badly: under 800 px on the short side (below ~90 dpi) = **TOO SMALL**. No other label. Instagram downloads pass. (Change `SMALL_PX` in `lib/pricing.js` to move the line.)

## v1.14 — Decorations
- **Decoration** panel on each order (admin), under Book design: vector graphics for the text pages (bio, credits, last page): **None, Swish, Fine lines, Corners, Circles, Dot grid**, each with a mini preview, plus a **colour** (design colour, gold, black, white, rose, sage, blue). Photos stay clean and full page.
- The PDF and the online proof draw exactly the same shapes. On Couleur's coloured credit pages, the "design colour" decoration turns white.
- New file: `lib/ornaments.js` (shapes are SVG paths on an 850 x 1100 page; add a new decoration there).

## v1.15 — Page layout: Full page, Mix, Gallery
- In the **Book design** panel (admin), a **Page layout** choice per order: **Full page** (every photo fills the page, default), **Mix** (like the demo book: full pages, pages of two photos side by side, and framed photos), **Gallery** (every photo framed with a white border).
- In Mix, each shoot opens with a full-page photo after its credit page. The PDF and the online proof match.

## v1.16 — Photographer photo or logo on the credit page
- Each shoot can have an optional **photo of the photographer** (shown round) or a **company logo** (shown as is, PNG with transparency works), uploaded under the credits in the performer portal ("Add a photo of the photographer" / "Add a logo", Replace, Remove). JPG or PNG under 4 MB.
- It prints small under the credits on that shoot's credit page, and shows the same in the online proof.

## v1.17 — Photo count per package
- Performer portal: a counter with a bar at the top of Shoots & photos ("10 of 18 photos · 8 more you can add"). At the limit it turns orange ("your package is full"), over the limit red ("please remove N photos"), and suggests the next package up.
- Uploading past the limit asks for confirmation first. "Send for layout" is refused while there are too many photos (also checked on the server).

## v1.18 — Upgrade button
- When the package is full or over its photo limit, the portal shows **"Upgrade to [next package] · +$X USD"**. The customer pays only the difference on Stripe; the order switches to the bigger package automatically (price, photo limit, pages, cover), the payment is added to "paid online", the timeline notes it and you get an email. Possible until the proof is approved.
- Without Stripe keys, the message asks the customer to write in instead.

## v1.19 — Upgrade = extra printing only, added to the balance
- "Upgrade to [next package]" no longer opens a payment. One click (with a confirmation) switches the order to the bigger package and adds only the extra printing to the price: Lulu print difference + 30% markup, rounded up, per copy (Essentiel → Signature +$3, Signature → Prestige +$19, Essentiel → Prestige +$22). No extra design cost. It is paid with the balance after the proof is approved.
- Values in `lib/pricing.js` (`PRINT_USD`, `UPGRADE_MARKUP`).
- **New prices (USD):** Essentiel $129, **Signature $132**, **Prestige $151** (= Essentiel + the extra printing), so buying a bigger package directly costs the same as upgrading. Extra copies unchanged ($59 / $69 / $119). Website and back office updated.

## v1.20 — The performer updates their own proof
- After receiving a proof, the performer can still fix their own details or photos (About you, Shoots & photos). "Your proof" then shows **"You changed your details or photos after this proof"** with an **Update my proof** button: it rebuilds the proof with the same design, layout and decoration, sends it to them right away (new version), and emails the admin "proof updated by the customer" (nothing to do).
- No need to go through "Ask for changes" for their own mistakes. "Ask for changes" stays for what only the admin can change.
- New file `lib/proofs.js` (shared proof builder). `vercel.json`: the portal function may run up to 60 s (building the PDFs).

## v1.21 — Reading copy in double pages
- Each proof now also produces a **book preview PDF**: page 1 = the open cover (back, spine, front), then double pages trimmed to the final size, first page alone on the right like a real book. Opens as spreads in any PDF viewer.
- Performer portal: **Download PDF (double pages)** opens this preview. Admin: **Book preview (spreads) ↗** next to the Interior and Cover PDFs. The print files sent to Lulu are unchanged.

## v1.22 — Approve, then pay, then print
- New status **Approved & paid** between Approved and Printing.
- When the performer approves the proof, the shipping is set automatically from the delivery country (same rates as the website estimator, +50% per extra copy) and the performer gets an email with the balance and the payment link; the portal shows "Pay the balance" right away.
- When the balance is paid (Stripe, or "Balance paid" ticked in the admin for another payment method), the order moves to **Approved & paid** and the admin gets a "ready to print" email.
- **Send to Lulu** stays locked until the balance is paid; the Print with Lulu panel says how much is still due.

## v1.23 — Lulu print job fix
- Fix: Lulu refused the print job ("printable_normalization.pod_package_id: This field is required"). The package code now sits inside `printable_normalization`, as the Lulu API requires. The delivery address always carries an email (the customer's, otherwise LULU_CONTACT_EMAIL / CONTACT_TO), also required by Lulu.
- Confirmation buttons now say what they do ("Send to Lulu", "Cancel the job", "Delete") instead of "Save".

## v1.24 — Fonts embedded for Lulu
- Fix: Lulu rejected print job 361222 ("One or more line-items were rejected"). The PDFs used the 14 standard PDF fonts, which are not embedded; Lulu requires every font to be embedded. The PDFs now embed Liberation Serif / Sans (free SIL OFL fonts in `fonts/`, same metrics as Times / Helvetica, so the pages look identical). New dependency: `@pdf-lib/fontkit`.
- An approved proof made before this fix gets its print files regenerated automatically when you click "Send to Lulu" (same layout, same photos, approval kept).
- "Refresh status" now shows Lulu's detailed reason when a job is rejected, and the panel explains how to resend.

## v1.25 — Secret discount code
- New Vercel environment variable **DISCOUNT_CODES**, e.g. `M3TEST:90` (code:percent, several separated by commas). The code is never shown on the site.
- Use it through a private link: `https://<site>/?code=M3TEST`. A small "Private code applied: −90%" note appears; the link hides the code from the address bar.
- The discount applies to the book and the shipping (deposit and balance). The admin order shows a "Private code −90%" pill; the timeline logs it; the performer's balance line shows the discount.
- Customer page wording: after approving, says "Pay the balance … and we send it to print" until the balance is paid.

## v1.26 — Softcover or hardcover, customer's choice + Lulu promo check
- **Every package in softcover or hardcover.** Public site: a "Cover" toggle above the packages (and in the estimator) switches all prices; the choice is sent to Stripe and saved on the order (`orders.cover`).
- **New prices (USD, before shipping):** Essentiel $129 / $149 · Signature $139 / $159 · Prestige $159 / $179 (soft / hard). Extra copy: $59 / $69 / $99 soft, +$20 hard. Hardcover = +$20 per copy (Lulu case wrap ≈ $9.60 more than perfect bound at every size, cost model v8). Same numbers in `lib/pricing.js` and `index.html` (PRICES).
- **The order's cover drives everything:** proof layout (Lulu minimum 32 pages soft / 24 hard), cover PDF size (Lulu cover-dimensions) and the Lulu product (`0850X1100FCPREPB…` perfect bound / `0850X1100FCPRECW…` case wrap). Orders created before v1.26 keep their old binding (Prestige = hardcover).
- **Admin:** SOFTCOVER / HARDCOVER badge in the order list and on the order sheet; "Cover" in Order details (change it + "Recalculate price"); the Lulu panel shows "Customer chose …" and checks the approved proof was built for that cover. If not, "Send to Lulu" is blocked: build a new proof and have it approved again.
- **Performer portal:** shows "Your book: Signature · Softcover" with "Upgrade to hardcover · +$20" (added to the balance, like package upgrades). Upgrades = list-price difference.
- **Lulu promo check before paying:** Lulu's Print API has no promo-code field — promotions are applied when you pay the print job in the Lulu dashboard. "Send to Lulu" now asks you to tick "I checked Lulu promotions" and note the code you will use; it is saved on the order and shown again next to "pay job …". Save the current promo once under **Team → Lulu promo code** (clear it when it expires).
- Database: new columns `orders.cover`, `orders.lulu_promo`, `orders.lulu_promo_checked_at` and table `settings` — created automatically on first load. No new environment variables.

## v1.27 — Restricted live Stripe key
- A restricted live key (`rk_live_…`) now counts as **live** (admin pill, checkout config). Recommended key for BOOKD: Stripe → Developers → API keys → Create restricted key → "Powering an integration you built", permissions **Checkout Sessions: Write, Customers: Write, PaymentIntents: Read**, everything else None. Paste it in Vercel as `STRIPE_SECRET_KEY`.

## v1.28 — Duplicate a book · customers order more copies later
- **Admin → order → "Duplicate…"** (next to Delete): new order with the same photos, credits, profile, design and shipping address — nothing to upload again. Choose the cover and copies. Price = extra-copy price × copies (design already done); keep the private discount if the original had one.
  - Same cover as the approved proof → the approved proof is reused: the new order is **Approved**, ready for "Send to Lulu" once paid.
  - Other cover → status **In layout**: build a proof (the cover size and Lulu product change) and send it for approval.
- **Customer page → "Order more copies"** (once the book is approved & paid, printing, shipped or delivered): choose copies and cover, see book + shipping, pay in full with Stripe. A new linked order is created automatically (paid, same cover = ready to print; other cover = proof to approve first) and you get an email.
- The original keeps its approved build forever, so the customer can come back any time.
- Order sheet shows the family: "Duplicate of / More copies of BK-…" and links to all copies.
- Photos are shared between the original and its copies: a file is only deleted from storage when no order uses it any more.
- Database: new columns `orders.parent_id`, `orders.origin` (created automatically). No new environment variables.
