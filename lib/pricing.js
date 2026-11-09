// lib/pricing.js — packages and prices (USD before shipping).
// v1.26 (Nov 9 2026): every package comes in softcover OR hardcover (customer's choice). Hardcover = softcover + $20
// (Lulu case wrap costs ~$9.60 more than perfect bound at every page count, cost model v8). Ladder: +$10 per package step.
export const COVERS = { soft: 'Softcover', hard: 'Hardcover' };
export const HARD_SURCHARGE = 20;        // first copy
export const HARD_EXTRA_SURCHARGE = 20;  // each extra copy
export const PACKAGES = {
  essentiel: { label: 'Essentiel', cover: 'soft', pages: 32, maxPhotos: 18, price: 129, extra: 59 },
  signature: { label: 'Signature', cover: 'soft', pages: 40, maxPhotos: 32, price: 139, extra: 69 },
  prestige:  { label: 'Prestige',  cover: 'soft', pages: 60, maxPhotos: 50, price: 159, extra: 99 },
};
// .cover above = default when an order has no cover recorded (orders created before v1.26 keep their old binding: Prestige was hardcover)
export const LEGACY_COVER = { essentiel: 'soft', signature: 'soft', prestige: 'hard' };
export const normCover = (c) => (c === 'hard' ? 'hard' : c === 'soft' ? 'soft' : null);
export const coverOf = (o) => normCover(o?.cover) || LEGACY_COVER[o?.package] || 'soft';
export const coverLabel = (c) => COVERS[c === 'hard' ? 'hard' : 'soft'];
export const listPrice = (pkg, cover) => { const p = PACKAGES[pkg] || PACKAGES.signature; return p.price + (cover === 'hard' ? HARD_SURCHARGE : 0); };
export const extraPrice = (pkg, cover) => { const p = PACKAGES[pkg] || PACKAGES.signature; return p.extra + (cover === 'hard' ? HARD_EXTRA_SURCHARGE : 0); };
export const priceFor = (pkg, copies = 1, cover = 'soft') => listPrice(pkg, cover) + extraPrice(pkg, cover) * Math.max(0, (copies || 1) - 1);
// Lulu print cost per copy (USD incl. fulfilment fee, cost model v8) — used for reference only
export const PRINT_USD = { soft: { essentiel: 10.92, signature: 12.73, prestige: 17.27 }, hard: { essentiel: 20.54, signature: 22.36, prestige: 26.89 } };
// Upgrade after ordering (bigger package and/or softcover → hardcover): no extra design cost, the customer pays the
// difference between the two list prices (first copy + extra copies). Added to the balance, paid after the proof is approved.
export const upgradeSurcharge = (from, to, copies = 1, fromCover = 'soft', toCover = fromCover) => {
  if (!PACKAGES[from] || !PACKAGES[to]) return 0;
  return Math.max(0, priceFor(to, copies, toCover) - priceFor(from, copies, fromCover));
};
// Is "to" a step up from "from"? (never allow a downgrade or hard → soft after ordering)
const RANK = { essentiel: 0, signature: 1, prestige: 2 };
export const isUpgrade = (from, to, fromCover, toCover) => RANK[to] >= RANK[from] && !(fromCover === 'hard' && toCover === 'soft') && (to !== from || toCover !== fromCover);
// Shipping charged to the customer (USD, Lulu tracked mail + 15% buffer, cost model v7) — same table as the website estimator.
// Regions: 0 US, 1 Canada, 2 UK, 3 Europe, 4 Australia/NZ, 5 Latin America, 6 Asia, 7 rest of the world. Each extra copy to the same address +50%.
export const SHIP_USD = [7, 16, 7, 12, 22, 24, 24, 24];
const EU = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE CH NO IS'.split(' ');
const LA = 'MX BR AR CO CL PE VE EC UY PY BO CR PA DO GT HN SV NI CU PR'.split(' ');
const AS = 'JP CN KR IN SG HK TW TH VN MY ID PH PK BD LK'.split(' ');
export function shipRegion(cc) { cc = String(cc || '').toUpperCase(); if (cc === 'US') return 0; if (cc === 'CA') return 1; if (cc === 'GB') return 2; if (EU.includes(cc)) return 3; if (cc === 'AU' || cc === 'NZ') return 4; if (LA.includes(cc)) return 5; if (AS.includes(cc)) return 6; return 7; }
export const shippingFor = (cc, copies = 1) => Math.round(SHIP_USD.at(shipRegion(cc)) * (1 + 0.5 * (Math.max(1, copies || 1) - 1)));
// Secret discount codes (test runs, VIP): Vercel env var DISCOUNT_CODES = "CODE:90,OTHER:25" (percent off).
// Never shown on the site; used only through a private link  https://<site>/?code=CODE
export function discountFor(code) {
  const c = String(code || '').trim().toUpperCase(); if (!c) return null;
  for (const part of String(process.env.DISCOUNT_CODES || '').split(',')) {
    const [k, v] = part.split(':').map(x => (x || '').trim()); const pct = Math.round(Number(v));
    if (k && k.toUpperCase() === c && pct > 0 && pct < 100) return { code: k.toUpperCase(), pct };
  }
  return null;
}
export const STATUSES = [
  ['new', 'New'], ['collecting', 'Collecting photos'], ['layout', 'In layout'], ['proof_sent', 'Proof sent'],
  ['changes', 'Changes requested'], ['approved', 'Approved'], ['paid', 'Approved & paid'], ['printing', 'Printing'], ['shipped', 'Shipped'],
  ['delivered', 'Delivered'], ['cancelled', 'Cancelled'],
];
// Every photo prints full page (8.5x11 + bleed = 8.75x11.25 in). Instagram downloads (1080 to 1440 px wide) print well
// (Leila's gift book was ~177 dpi). Only a photo that would clearly print badly is flagged: under 800 px on the short side
// (below ~90 dpi) = "too small". One flag, a warning only: the layout never changes. Change SMALL_PX to move the line.
export const SMALL_PX = 800, SOFT_PX = SMALL_PX;
export const isLowRes = (w, h) => !!(w && h && Math.min(w, h) < SOFT_PX);
export const isTooSmall = (w, h) => !!(w && h && Math.min(w, h) < SMALL_PX);
