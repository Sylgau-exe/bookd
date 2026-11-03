// lib/pricing.js — packages and prices (from BOOKD cost model v6, USD before shipping)
export const PACKAGES = {
  essentiel: { label: 'Essentiel', cover: 'soft', pages: 24, maxPhotos: 18, price: 129, extra: 59 },
  signature: { label: 'Signature', cover: 'soft', pages: 40, maxPhotos: 32, price: 139, extra: 69 },
  prestige:  { label: 'Prestige',  cover: 'hard', pages: 60, maxPhotos: 50, price: 189, extra: 119 },
};
export const priceFor = (pkg, copies = 1) => { const p = PACKAGES[pkg] || PACKAGES.signature; return p.price + p.extra * Math.max(0, (copies || 1) - 1); };
export const STATUSES = [
  ['new', 'New'], ['collecting', 'Collecting photos'], ['layout', 'In layout'], ['proof_sent', 'Proof sent'],
  ['changes', 'Changes requested'], ['approved', 'Approved'], ['printing', 'Printing'], ['shipped', 'Shipped'],
  ['delivered', 'Delivered'], ['cancelled', 'Cancelled'],
];
// a full-bleed 8x10 page at 300 dpi needs about 2438 x 3075 px; below ~2000 px on the short side we flag it
export const isLowRes = (w, h) => !!(w && h && Math.min(w, h) < 2000);
