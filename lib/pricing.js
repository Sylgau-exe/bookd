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
// a full-bleed 8.5x11 page (8.75x11.25 with bleed) at 300 dpi needs about 2625 x 3375 px;
// below ~2000 px on the short side (~230 dpi) we flag it and use a framed layout
export const isLowRes = (w, h) => !!(w && h && Math.min(w, h) < 2000);
