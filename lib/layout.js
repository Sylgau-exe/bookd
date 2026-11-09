// lib/layout.js — turns an order (profile + shoots + photos) into a list of book pages.
// The same layout feeds the PDF and the online proof, so what the performer approves is what gets printed.
import { PACKAGES, isLowRes, isTooSmall, coverOf } from './pricing.js';
import { MIN_PAGES } from './lulu.js';
import { templateKey, getTemplate } from './templates.js';
import { ornamentKey, ornamentColor, ORNAMENTS } from './ornaments.js';
export const KIND_LABELS = { editorial: 'Editorial shoot', campaign: 'Campaign', runway: 'Runway', lookbook: 'Lookbook', headshots: 'Headshots',
  set: 'On set', stage: 'Stage', beauty: 'Beauty', event: 'Event', selection: 'Selection', other: 'Shoot' };
export function buildLayout(order, shoots, photos) {
  const pf = order.profile || {};
  const kept = photos.filter(p => p.keep !== false);
  const byShoot = (sid) => kept.filter(p => p.shoot_id === sid).sort((a, b) => a.position - b.position || a.id - b.id);
  const coverPhoto = kept.find(p => p.role === 'cover') || kept[0] || null;
  const name = (pf.name || order.customer_name || '').trim();
  const pages = [];
  const style = ['full', 'mix', 'gallery'].includes(order.photo_style) ? order.photo_style : 'full';
  pages.push({ type: 'bio', name, role: pf.role || '', bio: pf.bio || '',
    facts: [['Height', pf.height], ['Languages', pf.languages], ['Agency', pf.agency], ['Based in', pf.city]].filter(f => f[1]) });
  let n = 0;
  for (const s of [...shoots].sort((a, b) => a.position - b.position || a.id - b.id)) {
    const ph = byShoot(s.id).filter(p => p.role !== 'cover' || byShoot(s.id).length === 1);
    if (!ph.length) continue;
    n++;
    pages.push({ type: 'credit', num: n, kind: KIND_LABELS[s.kind] || 'Shoot', title: s.title || '', credits: (s.credits || []).filter(c => c && c.label && c.value), story: s.story || '', shootId: s.id,
      creditImage: s.credit_image ? { url: s.credit_image, kind: s.credit_image_kind === 'logo' ? 'logo' : 'portrait' } : null });
    // page layout: 'full' = every photo full page; 'gallery' = every photo framed with a white margin;
    // 'mix' = like the demo book: full page, then a page of two photos, full page, framed, and so on
    const item = (p) => ({ photoId: p.id, url: p.url, w: p.width, h: p.height, lowRes: isLowRes(p.width, p.height), tooSmall: isTooSmall(p.width, p.height) });
    const single = (p, mode) => pages.push({ type: 'photo', mode, ...item(p), shootId: s.id });
    if (style !== 'mix') ph.forEach(p => single(p, style === 'gallery' ? 'framed' : 'full'));
    else {
      const rhythm = ['full', 'duo', 'full', 'framed']; let i = 0, k = 0;
      while (i < ph.length) {
        const mode = i === 0 ? 'full' : rhythm.at(k++ % rhythm.length);
        if (mode === 'duo' && i + 1 < ph.length) {
          const a = item(ph.at(i)), b = item(ph.at(i + 1));
          pages.push({ type: 'photo', mode: 'duo', items: [a, b], url: a.url, photoId: a.photoId, lowRes: a.lowRes || b.lowRes, tooSmall: a.tooSmall || b.tooSmall, shootId: s.id });
          i += 2;
        } else { single(ph.at(i), mode === 'duo' ? 'framed' : mode); i++; }
      }
    }
  }
  pages.push({ type: 'closing', name, contact: pf.contact || '', website: pf.website || '' });
  const pkg = PACKAGES[order.package] || PACKAGES.signature;
  const binding = coverOf(order); // v1.26: the customer's cover choice, not the package
  // Lulu needs an even page count and a minimum per binding (softcover 32, hardcover 24): pad with blank pages before the closing page
  const minPages = MIN_PAGES[binding] || 24;
  while (pages.length % 2 || pages.length < minPages) pages.splice(pages.length - 1, 0, { type: 'blank' });
  const warnings = [];
  if (pages.length > pkg.pages) warnings.push(`Layout has ${pages.length} pages; the ${pkg.label} package includes ${pkg.pages}. Remove photos or upgrade the package.`);
  const lowCount = pages.filter(p => p.lowRes).length;
  const smallCount = pages.filter(p => p.tooSmall).length;
  if (smallCount) warnings.push(`${smallCount} photo(s) under 800 px will print blurry: ask the customer for the original file.`);
  const blanks = pages.filter(p => p.type === 'blank').length;
  if (blanks > 1) warnings.push(`${blanks} blank pages added to reach ${pages.length} pages (Lulu ${binding === 'hard' ? 'hardcover' : 'softcover'} minimum ${minPages}). Add photos to fill them.`);
  if (!coverPhoto) warnings.push('No photos yet: the cover needs at least one photo.');
  return { cover: coverPhoto ? { url: coverPhoto.url, photoId: coverPhoto.id, name, role: pf.role || '' } : null, back: { contact: pf.contact || '', website: pf.website || '' },
    binding, photoStyle: style, template: templateKey(order.template), theme: getTemplate(order.template), ornament: { key: ornamentKey(order.ornament), color: ornamentColor(order.ornament_color) }, orn: ORNAMENTS[ornamentKey(order.ornament)].shapes, pages, warnings, pageCount: pages.length };
}
