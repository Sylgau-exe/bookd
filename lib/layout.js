// lib/layout.js — turns an order (profile + shoots + photos) into a list of book pages.
// The same layout feeds the PDF and the online proof, so what the performer approves is what gets printed.
import { PACKAGES, isLowRes, isTooSmall } from './pricing.js';
import { MIN_PAGES } from './lulu.js';
import { templateKey, getTemplate } from './templates.js';
export const KIND_LABELS = { editorial: 'Editorial shoot', campaign: 'Campaign', runway: 'Runway', lookbook: 'Lookbook', headshots: 'Headshots',
  set: 'On set', stage: 'Stage', beauty: 'Beauty', event: 'Event', selection: 'Selection', other: 'Shoot' };
export function buildLayout(order, shoots, photos) {
  const pf = order.profile || {};
  const kept = photos.filter(p => p.keep !== false);
  const byShoot = (sid) => kept.filter(p => p.shoot_id === sid).sort((a, b) => a.position - b.position || a.id - b.id);
  const coverPhoto = kept.find(p => p.role === 'cover') || kept[0] || null;
  const name = (pf.name || order.customer_name || '').trim();
  const pages = [];
  pages.push({ type: 'bio', name, role: pf.role || '', bio: pf.bio || '',
    facts: [['Height', pf.height], ['Languages', pf.languages], ['Agency', pf.agency], ['Based in', pf.city]].filter(f => f[1]) });
  let n = 0;
  for (const s of [...shoots].sort((a, b) => a.position - b.position || a.id - b.id)) {
    const ph = byShoot(s.id).filter(p => p.role !== 'cover' || byShoot(s.id).length === 1);
    if (!ph.length) continue;
    n++;
    pages.push({ type: 'credit', num: n, kind: KIND_LABELS[s.kind] || 'Shoot', title: s.title || '', credits: (s.credits || []).filter(c => c && c.label && c.value), story: s.story || '', shootId: s.id });
    ph.forEach((p) => {
      // every photo full page (full bleed); resolution flags are warnings only
      pages.push({ type: 'photo', mode: 'full', photoId: p.id, url: p.url, w: p.width, h: p.height, lowRes: isLowRes(p.width, p.height), tooSmall: isTooSmall(p.width, p.height), shootId: s.id });
    });
  }
  pages.push({ type: 'closing', name, contact: pf.contact || '', website: pf.website || '' });
  const pkg = PACKAGES[order.package] || PACKAGES.signature;
  // Lulu needs an even page count and a minimum per binding (softcover 32, hardcover 24): pad with blank pages before the closing page
  const minPages = MIN_PAGES[pkg.cover] || 24;
  while (pages.length % 2 || pages.length < minPages) pages.splice(pages.length - 1, 0, { type: 'blank' });
  const warnings = [];
  if (pages.length > pkg.pages) warnings.push(`Layout has ${pages.length} pages; the ${pkg.label} package includes ${pkg.pages}. Remove photos or upgrade the package.`);
  const lowCount = pages.filter(p => p.lowRes).length;
  const smallCount = pages.filter(p => p.tooSmall).length;
  if (smallCount) warnings.push(`${smallCount} photo(s) under 1000 px: too small for a full page, ask the customer for the original file.`);
  if (lowCount - smallCount > 0) warnings.push(`${lowCount - smallCount} photo(s) between 1000 and 1400 px: full page, may print slightly soft.`);
  const blanks = pages.filter(p => p.type === 'blank').length;
  if (blanks > 1) warnings.push(`${blanks} blank pages added to reach ${pages.length} pages (Lulu ${pkg.cover === 'hard' ? 'hardcover' : 'softcover'} minimum ${minPages}). Add photos to fill them.`);
  if (!coverPhoto) warnings.push('No photos yet: the cover needs at least one photo.');
  return { cover: coverPhoto ? { url: coverPhoto.url, photoId: coverPhoto.id, name, role: pf.role || '' } : null, back: { contact: pf.contact || '', website: pf.website || '' },
    binding: pkg.cover, template: templateKey(order.template), theme: getTemplate(order.template), pages, warnings, pageCount: pages.length };
}
