// lib/pricing.js — packages and prices (USD before shipping). Nov 8 2026: Signature and Prestige = Essentiel + the extra printing (+30%), so buying a bigger package directly costs the same as upgrading.
export const PACKAGES = {
  essentiel: { label: 'Essentiel', cover: 'soft', pages: 32, maxPhotos: 18, price: 129, extra: 59 },
  signature: { label: 'Signature', cover: 'soft', pages: 40, maxPhotos: 32, price: 132, extra: 69 },
  prestige:  { label: 'Prestige',  cover: 'hard', pages: 60, maxPhotos: 50, price: 151, extra: 119 },
};
// Upgrade after ordering: no extra design cost, only the extra printing (Lulu, cost model v7, USD incl. fulfilment fee) + 30% markup,
// rounded up to the dollar, per copy. Added to the balance, paid after the proof is approved.
export const PRINT_USD = { essentiel: 10.92, signature: 12.73, prestige: 26.88 };
export const UPGRADE_MARKUP = 0.30;
// first copy: the list-price difference (list prices are built as Essentiel + extra printing); each extra copy: the printing difference + 30%
export const upgradeSurcharge = (from, to, copies = 1) => {
  const a = PACKAGES[from], b = PACKAGES[to]; if (!a || !b) return 0;
  const perExtra = Math.ceil(Math.max(0, (PRINT_USD[to] || 0) - (PRINT_USD[from] || 0)) * (1 + UPGRADE_MARKUP));
  return Math.max(0, b.price - a.price) + perExtra * Math.max(0, (copies || 1) - 1);
};
// Shipping charged to the customer (USD, Lulu tracked mail + 15% buffer, cost model v7) — same table as the website estimator.
// Regions: 0 US, 1 Canada, 2 UK, 3 Europe, 4 Australia/NZ, 5 Latin America, 6 Asia, 7 rest of the world. Each extra copy to the same address +50%.
export const SHIP_USD = [7, 16, 7, 12, 22, 24, 24, 24];
const EU = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE CH NO IS'.split(' ');
const LA = 'MX BR AR CO CL PE VE EC UY PY BO CR PA DO GT HN SV NI CU PR'.split(' ');
const AS = 'JP CN KR IN SG HK TW TH VN MY ID PH PK BD LK'.split(' ');
export function shipRegion(cc) { cc = String(cc || '').toUpperCase(); if (cc === 'US') return 0; if (cc === 'CA') return 1; if (cc === 'GB') return 2; if (EU.includes(cc)) return 3; if (cc === 'AU' || cc === 'NZ') return 4; if (LA.includes(cc)) return 5; if (AS.includes(cc)) return 6; return 7; }
export const shippingFor = (cc, copies = 1) => Math.round(SHIP_USD.at(shipRegion(cc)) * (1 + 0.5 * (Math.max(1, copies || 1) - 1)));
export const priceFor = (pkg, copies = 1) => { const p = PACKAGES[pkg] || PACKAGES.signature; return p.price + p.extra * Math.max(0, (copies || 1) - 1); };
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
