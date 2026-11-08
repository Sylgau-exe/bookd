// lib/pricing.js — packages and prices (USD before shipping). Prices unchanged from cost model v6; print = Lulu (cost model v7).
export const PACKAGES = {
  essentiel: { label: 'Essentiel', cover: 'soft', pages: 32, maxPhotos: 18, price: 129, extra: 59 },
  signature: { label: 'Signature', cover: 'soft', pages: 40, maxPhotos: 32, price: 139, extra: 69 },
  prestige:  { label: 'Prestige',  cover: 'hard', pages: 60, maxPhotos: 50, price: 189, extra: 119 },
};
export const priceFor = (pkg, copies = 1) => { const p = PACKAGES[pkg] || PACKAGES.signature; return p.price + p.extra * Math.max(0, (copies || 1) - 1); };
export const STATUSES = [
  ['new', 'New'], ['collecting', 'Collecting photos'], ['layout', 'In layout'], ['proof_sent', 'Proof sent'],
  ['changes', 'Changes requested'], ['approved', 'Approved'], ['printing', 'Printing'], ['shipped', 'Shipped'],
  ['delivered', 'Delivered'], ['cancelled', 'Cancelled'],
];
// Every photo prints full page (8.5x11 + bleed = 8.75x11.25 in). Instagram exports (1440x1800) give ~160 dpi, which prints
// well (Leila's gift book was ~177 dpi). Below 1400 px on the short side (~155 dpi) the photo is flagged "may print soft";
// below 1000 px (~115 dpi) "too small". Flags are warnings only: the layout never changes.
export const SOFT_PX = 1400, SMALL_PX = 1000;
export const isLowRes = (w, h) => !!(w && h && Math.min(w, h) < SOFT_PX);
export const isTooSmall = (w, h) => !!(w && h && Math.min(w, h) < SMALL_PX);
