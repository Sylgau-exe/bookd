// lib/templates.js — book designs. Photos are always full page; a design changes the text pages (bio, credits, closing),
// the cover and the colours. Shared by the PDF builder, the online proof and the admin picker.
export const TEMPLATES = {
  editorial: { label: 'Éditorial', desc: 'Serif titles, red accent numbers, warm white pages. Classic magazine feel.',
    paper: '#FBFBFA', ink: '#17171C', muted: '#6B6B73', accent: '#B0123B', titles: 'serif', num: 'italic', upper: false, back: '#17171C', backInk: '#FFFFFF', band: 0.35 },
  noir: { label: 'Noir', desc: 'Black pages, white type, bold capitals. High fashion and dramatic, perfect with black-and-white shoots.',
    paper: '#0E0E10', ink: '#F4F4F2', muted: '#9C9CA3', accent: '#F4F4F2', titles: 'sans-bold', num: 'bold', upper: true, back: '#000000', backInk: '#FFFFFF', band: 0.5 },
  minimal: { label: 'Minimal', desc: 'Pure white, small clean type, lots of space. A quiet agency and commercial look.',
    paper: '#FFFFFF', ink: '#111111', muted: '#8C8C8C', accent: '#111111', titles: 'sans', num: 'thin', upper: false, back: '#FFFFFF', backInk: '#111111', band: 0.25 },
  couleur: { label: 'Couleur', desc: 'Each shoot opens on its own bold colour. Playful, for beauty, pop and campaign work.',
    paper: '#FFFFFF', ink: '#151515', muted: '#6E6E6E', accent: '#E4007C', titles: 'sans-bold', num: 'bold', upper: false, back: '#E4007C', backInk: '#FFFFFF', band: 0,
    palette: ['#E4007C', '#FF5A1F', '#0057FF', '#00A36C', '#7A3CFF', '#E3A400'] },
};
export const templateKey = (k) => (TEMPLATES[k] ? k : 'editorial');
export const getTemplate = (k) => ({ key: templateKey(k), ...TEMPLATES[templateKey(k)] });
// colours of one credit page: { bg, ink, muted, accent }
export function creditColors(t, n) {
  if (t.palette) { const c = t.palette[(n - 1) % t.palette.length]; return { bg: c, ink: '#FFFFFF', muted: 'rgba(255,255,255,.78)', mutedHex: '#F2F2F2', accent: '#FFFFFF' }; }
  return { bg: t.paper, ink: t.ink, muted: t.muted, mutedHex: t.muted, accent: t.accent };
}
