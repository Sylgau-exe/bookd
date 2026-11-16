// lib/layout.js — turns an order (profile + shoots + photos) into a list of book pages.
// The same layout feeds the PDF and the online proof, so what the performer approves is what gets printed.
import { PACKAGES, isLowRes, isTooSmall, coverOf } from './pricing.js';
import { MIN_PAGES } from './lulu.js';
import { templateKey, getTemplate } from './templates.js';
import { ornamentKey, ornamentColor, ORNAMENTS } from './ornaments.js';
export const KIND_LABELS = { editorial: 'Editorial shoot', campaign: 'Campaign', runway: 'Runway', lookbook: 'Lookbook', headshots: 'Headshots',
  set: 'On set', stage: 'Stage', beauty: 'Beauty', event: 'Event', selection: 'Selection', other: 'Shoot' };
// v1.34 — is there room for a small photo between the credits and the story? An estimate of the printed page
// (text area 684 pt high): the PDF builder then fits the photo to the exact space.
function creditRoom(c) {
  const titleLines = Math.max(1, Math.ceil(String(c.title || '').length * 13 / 504));
  const creditsH = c.credits.reduce((h, x) => h + Math.max(1, Math.ceil(String(x.value).length * 5.6 / 394)) * 14 + 6, 0);
  const top = 72 + 34 + 30 + titleLines * 30 + 14 + creditsH + (c.creditImage ? 80 : 0);
  const story = c.story ? Math.ceil(String(c.story).length / 86) * 18 + 76 : 10;
  return 684 - top - story >= 170; // at least about 2.4 inches of height for the photo
}
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
  // v1.34 — a credit page always sits on a LEFT page, facing the first photo of its shoot on the right.
  // The book opens on a right page, so that holds when every shoot takes an even number of pages:
  // 1 credit page + an ODD number of photo pages. A shoot with an even number of photo pages gets one photo
  // placed small on its credit page (under the credits). If the credit page has no room for it, the shoot keeps
  // all its photo pages and the NEXT shoot starts with a title page on the right.
  const item = (p) => ({ photoId: p.id, url: p.url, w: p.width, h: p.height, lowRes: isLowRes(p.width, p.height), tooSmall: isTooSmall(p.width, p.height) });
  // photo pages of one shoot. 'full' = every photo full page; 'gallery' = every photo framed with a white margin;
  // 'mix' = like the demo book: full page, then a page of two photos, full page, framed, and so on
  const paginate = (ph, sid) => {
    const out = []; const single = (p, mode) => out.push({ type: 'photo', mode, ...item(p), shootId: sid });
    if (style !== 'mix') ph.forEach(p => single(p, style === 'gallery' ? 'framed' : 'full'));
    else {
      const rhythm = ['full', 'duo', 'full', 'framed']; let i = 0, k = 0;
      while (i < ph.length) {
        const mode = i === 0 ? 'full' : rhythm.at(k++ % rhythm.length);
        if (mode === 'duo' && i + 1 < ph.length) {
          const a = item(ph.at(i)), b = item(ph.at(i + 1));
          out.push({ type: 'photo', mode: 'duo', items: [a, b], url: a.url, photoId: a.photoId, lowRes: a.lowRes || b.lowRes, tooSmall: a.tooSmall || b.tooSmall, shootId: sid });
          i += 2;
        } else { single(ph.at(i), mode === 'duo' ? 'framed' : mode); i++; }
      }
    }
    return out;
  };
  let n = 0, openerNext = false, insets = 0, openers = 0;
  for (const s of [...shoots].sort((a, b) => a.position - b.position || a.id - b.id)) {
    const ph = byShoot(s.id).filter(p => p.role !== 'cover' || byShoot(s.id).length === 1);
    if (!ph.length) continue;
    n++;
    const credit = { type: 'credit', num: n, kind: KIND_LABELS[s.kind] || 'Shoot', title: s.title || '', credits: (s.credits || []).filter(c => c && c.label && c.value), story: s.story || '', shootId: s.id,
      creditImage: s.credit_image ? { url: s.credit_image, kind: s.credit_image_kind === 'logo' ? 'logo' : 'portrait' } : null };
    if (openerNext) { pages.push({ type: 'opener', num: n, kind: credit.kind, title: credit.title, shootId: s.id }); openers++; openerNext = false; }
    let photoPages = paginate(ph, s.id);
    if (photoPages.length % 2 === 0) {
      // which photo goes small: one that is too small to print full page if there is one (it looks sharp at this size), otherwise the last
      const pick = ph.length > 1 && creditRoom(credit) ? ([...ph].reverse().find(p => isTooSmall(p.width, p.height)) || [...ph].reverse().find(p => isLowRes(p.width, p.height)) || ph.at(-1)) : null;
      const rest = pick ? paginate(ph.filter(p => p !== pick), s.id) : null;
      if (rest && rest.length % 2 === 1) { credit.inset = item(pick); photoPages = rest; insets++; }
      else openerNext = true;
    }
    pages.push(credit, ...photoPages);
  }
  pages.push({ type: 'closing', name, contact: pf.contact || '', website: pf.website || '' });
  const pkg = PACKAGES[order.package] || PACKAGES.signature;
  const binding = coverOf(order); // v1.26: the customer's cover choice, not the package
  // Lulu needs an even page count and a minimum per binding (softcover 32, hardcover 24): pad with blank pages before the closing page
  const minPages = MIN_PAGES[binding] || 24;
  while (pages.length % 2 || pages.length < minPages) pages.splice(pages.length - 1, 0, { type: 'blank' });
  const warnings = [];
  // v1.29: the page count naturally grows with the number of shoots (one credit page each) — only the photo count is a limit
  const photoCount = kept.length;
  if (photoCount > pkg.maxPhotos) warnings.push(`${photoCount} photos; the ${pkg.label} package includes up to ${pkg.maxPhotos}. Remove photos or upgrade the package.`);
  else if (pages.length > pkg.pages) warnings.push(`For information: ${pages.length} pages (${pages.filter(p => p.type === 'credit').length} credit pages + bio and closing). Everything is printed; Lulu charges about $0.23 USD per extra page.`);
  if (insets || openers) warnings.push(`For information: credit pages are always on the left. ${insets ? `${insets} shoot(s) with an even number of photos have one photo placed small on their credit page` : ''}${insets && openers ? '; ' : ''}${openers ? `${openers} shoot(s) start with a title page (no room for a small photo on the previous credit page)` : ''}. Reorder a shoot's photos to choose which one goes small (the last one by default).`);
  const lowCount = pages.filter(p => p.lowRes).length;
  const smallCount = pages.filter(p => p.tooSmall).length;
  if (smallCount) warnings.push(`${smallCount} photo(s) under 800 px will print blurry: ask the customer for the original file.`);
  const blanks = pages.filter(p => p.type === 'blank').length;
  if (blanks > 1) warnings.push(`${blanks} blank pages added to reach ${pages.length} pages (Lulu ${binding === 'hard' ? 'hardcover' : 'softcover'} minimum ${minPages}). Add photos to fill them.`);
  if (!coverPhoto) warnings.push('No photos yet: the cover needs at least one photo.');
  return { cover: coverPhoto ? { url: coverPhoto.url, photoId: coverPhoto.id, name, role: pf.role || '' } : null, back: { contact: pf.contact || '', website: pf.website || '' },
    binding, photoStyle: style, template: templateKey(order.template), theme: getTemplate(order.template), ornament: { key: ornamentKey(order.ornament), color: ornamentColor(order.ornament_color) }, orn: ORNAMENTS[ornamentKey(order.ornament)].shapes, pages, warnings, pageCount: pages.length };
}
