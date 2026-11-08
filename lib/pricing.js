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
export const priceFor = (pkg, copies = 1) => { const p = PACKAGES[pkg] || PACKAGES.signature; return p.price + p.extra * Math.max(0, (copies || 1) - 1); };
export const STATUSES = [
  ['new', 'New'], ['collecting', 'Collecting photos'], ['layout', 'In layout'], ['proof_sent', 'Proof sent'],
  ['changes', 'Changes requested'], ['approved', 'Approved'], ['printing', 'Printing'], ['shipped', 'Shipped'],
  ['delivered', 'Delivered'], ['cancelled', 'Cancelled'],
];
// Every photo prints full page (8.5x11 + bleed = 8.75x11.25 in). Instagram downloads (1080 to 1440 px wide) print well
// (Leila's gift book was ~177 dpi). Only a photo that would clearly print badly is flagged: under 800 px on the short side
// (below ~90 dpi) = "too small". One flag, a warning only: the layout never changes. Change SMALL_PX to move the line.
export const SMALL_PX = 800, SOFT_PX = SMALL_PX;
export const isLowRes = (w, h) => !!(w && h && Math.min(w, h) < SOFT_PX);
export const isTooSmall = (w, h) => !!(w && h && Math.min(w, h) < SMALL_PX);
