// lib/ornaments.js — vector decorations for the text pages (bio, credit, closing). Never on photo pages.
// Shapes are SVG paths in a 850 x 1100 box = the 8.5 x 11 in trim at 100 units per inch (y down).
// Shapes may run past the edge (into the bleed). The PDF and the online proof draw the same paths.
const circle = (cx, cy, r) => `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
const dots = () => { let d = ''; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) d += circle(650 + i * 24, 56 + j * 24, 3.6) + ' '; return d.trim(); };
export const ORNAMENTS = {
  none:    { label: 'None', desc: 'Clean text pages.', shapes: [] },
  swish:   { label: 'Swish', desc: 'Two flowing brush strokes in the top corner, like the gift book.', shapes: [
             { d: 'M 470 -12 C 590 64 740 96 872 70 L 872 116 C 726 146 574 112 452 -12 Z', fill: true, op: 0.9 },
             { d: 'M 560 -12 C 660 100 772 152 872 150', w: 3, op: 0.9 } ] },
  lines:   { label: 'Fine lines', desc: 'A thin rule at the top and the bottom of the page.', shapes: [
             { d: 'M 75 52 L 775 52', w: 1.4 }, { d: 'M 75 1048 L 775 1048', w: 1.4 }, { d: 'M 75 60 L 175 60', w: 4 } ] },
  corners: { label: 'Corners', desc: 'Frame marks in the four corners.', shapes: [
             { d: 'M 40 110 L 40 40 L 110 40', w: 2 }, { d: 'M 740 40 L 810 40 L 810 110', w: 2 },
             { d: 'M 40 990 L 40 1060 L 110 1060', w: 2 }, { d: 'M 740 1060 L 810 1060 L 810 990', w: 2 } ] },
  circles: { label: 'Circles', desc: 'Large outline circles running off the top corner.', shapes: [
             { d: circle(830, 70, 220), w: 2 }, { d: circle(830, 70, 160), w: 1 } ] },
  dots:    { label: 'Dot grid', desc: 'A small grid of dots in the top corner.', shapes: [ { d: dots(), fill: true, op: 0.85 } ] },
};
export const ORNAMENT_COLORS = { accent: 'Design colour', '#C9A227': 'Gold', '#111111': 'Black', '#FFFFFF': 'White', '#E8A0B4': 'Rose', '#8FA98F': 'Sage', '#2F5DFF': 'Blue' };
export const ornamentKey = (k) => (ORNAMENTS[k] ? k : 'none');
export const ornamentColor = (c) => (ORNAMENT_COLORS[c] ? c : 'accent');
// resolved for one page: color 'accent' = the design's accent; on a coloured credit page (Couleur) = white
export function ornamentFor(key, color, theme, pageBgIsColour) {
  const o = ORNAMENTS[ornamentKey(key)]; if (!o.shapes.length) return null;
  let c = ornamentColor(color) === 'accent' ? (theme?.accent || '#B0123B') : color;
  if (pageBgIsColour && ornamentColor(color) === 'accent') c = '#FFFFFF';
  return { color: c, shapes: o.shapes };
}
