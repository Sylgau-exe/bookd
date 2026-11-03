// lib/pdf.js — print-ready PDFs with pdf-lib.
// Interior: 8.125 x 10.25 in (8x10 trim + bleed, Blurb Standard Portrait spec). Cover: front cover page at the same size.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fetchBytes } from './storage.js';
const PT = 72, W = 8.125 * PT, H = 10.25 * PT, BX = 0.0625 * PT, BY = 0.125 * PT, M = 0.75 * PT;
const INK = rgb(0.09, 0.09, 0.11), MUTED = rgb(0.42, 0.42, 0.45), ACCENT = rgb(0.69, 0.07, 0.23), PAPER = rgb(0.984, 0.984, 0.98);
const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function safe(t) {
  return String(t || '').replace(/[′‘’]/g, "'").replace(/[″“”]/g, '"').replace(/[‐-―]/g, '-').replace(/[→]/g, '->').replace(/ /g, ' ')
    .split('').filter(c => c.charCodeAt(0) < 256 || WIN.has(c)).join('');
}
function wrap(text, font, size, width) {
  const out = [];
  for (const para of safe(text).split(/\n+/)) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
async function embed(doc, cache, url, base) {
  if (cache.has(url)) return cache.get(url);
  const bytes = await fetchBytes(url, base);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  cache.set(url, img); return img;
}
function drawCover(page, img, x, y, w, h) { // fill box, crop overflow (page clips at its edge)
  const s = Math.max(w / img.width, h / img.height), iw = img.width * s, ih = img.height * s;
  page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
}
function drawContain(page, img, x, y, w, h) {
  const s = Math.min(w / img.width, h / img.height), iw = img.width * s, ih = img.height * s;
  page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
}
export async function buildPdfs(layout, base) {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`BOOKD — ${layout.pages[0]?.name || ''}`)); doc.setCreator('BOOKD');
  const serif = await doc.embedFont(StandardFonts.TimesRoman), serifI = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica), sansB = await doc.embedFont(StandardFonts.HelveticaBold);
  const cache = new Map();
  const L = BX + M, R = W - BX - M, T = H - BY - M, B = BY + M, TW = R - L;
  let num = 0;
  for (const p of layout.pages) {
    num++;
    const page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });
    const folio = (dark) => { if (p.type === 'blank') return; const s = String(num).padStart(2, '0'); const odd = num % 2 === 1;
      page.drawText(s, { x: odd ? W - BX - 0.45 * PT - sans.widthOfTextAtSize(s, 7) : BX + 0.45 * PT, y: BY + 0.3 * PT, size: 7, font: sans, color: dark ? rgb(1, 1, 1) : MUTED }); };
    if (p.type === 'photo') {
      const img = await embed(doc, cache, p.url, base);
      if (p.mode === 'full') drawCover(page, img, 0, 0, W, H);
      else drawContain(page, img, L, B + 0.3 * PT, TW, T - B - 0.3 * PT);
      folio(p.mode === 'full');
    } else if (p.type === 'credit') {
      let y = T - 72;
      page.drawText(String(p.num).padStart(2, '0'), { x: L, y, size: 84, font: serifI, color: ACCENT });
      y -= 34; page.drawText(safe(p.kind).toUpperCase(), { x: L, y, size: 8.5, font: sans, color: MUTED });
      y -= 30; for (const ln of wrap(p.title, serif, 26, TW)) { page.drawText(ln, { x: L, y, size: 26, font: serif, color: INK }); y -= 30; }
      y -= 14;
      for (const c of p.credits) {
        page.drawText(safe(c.label).toUpperCase(), { x: L, y, size: 7.5, font: sans, color: MUTED });
        const lines = wrap(c.value, sans, 10.5, TW - 110);
        lines.forEach((ln, i) => page.drawText(ln, { x: L + 110, y: y - i * 14, size: 10.5, font: sans, color: INK }));
        y -= 14 * lines.length + 6;
      }
      if (p.story) {
        const lines = wrap(p.story, serifI, 13, TW);
        let sy = B + 20 + lines.length * 18;
        page.drawLine({ start: { x: L, y: sy + 22 }, end: { x: R, y: sy + 22 }, thickness: 0.8, color: INK });
        page.drawText('THE STORY', { x: L, y: sy + 8, size: 7.5, font: sans, color: MUTED });
        lines.forEach((ln, i) => page.drawText(ln, { x: L, y: sy - 12 - i * 18, size: 13, font: serifI, color: INK }));
      }
      folio(false);
    } else if (p.type === 'bio') {
      let y = T - 30;
      for (const ln of wrap(p.name, serif, 34, TW)) { page.drawText(ln, { x: L, y, size: 34, font: serif, color: INK }); y -= 38; }
      if (p.role) { page.drawText(safe(p.role).toUpperCase(), { x: L, y, size: 8.5, font: sans, color: MUTED }); y -= 30; }
      for (const ln of wrap(p.bio, sans, 11.5, TW)) { page.drawText(ln, { x: L, y, size: 11.5, font: sans, color: INK }); y -= 17; }
      let fy = B + 20 + p.facts.length * 18;
      for (const [k, v] of p.facts) { page.drawText(safe(k).toUpperCase(), { x: L, y: fy, size: 7.5, font: sans, color: MUTED }); page.drawText(safe(v), { x: L + 110, y: fy, size: 10.5, font: sans, color: INK }); fy -= 18; }
      folio(false);
    } else if (p.type === 'closing') {
      const cx = (t, f, s) => W / 2 - f.widthOfTextAtSize(t, s) / 2;
      const nm = safe(p.name); page.drawText(nm, { x: cx(nm, serif, 30), y: H / 2 + 30, size: 30, font: serif, color: INK });
      let y = H / 2;
      for (const t of [p.contact, p.website].filter(Boolean).map(safe)) { page.drawText(t, { x: cx(t, sans, 10.5), y, size: 10.5, font: sans, color: MUTED }); y -= 18; }
      const b = 'BOOKD'; page.drawText(b, { x: cx(b, sansB, 8), y: B, size: 8, font: sansB, color: MUTED });
    }
  }
  const interior = await doc.save();
  // front cover
  const cdoc = await PDFDocument.create(); cdoc.setTitle('BOOKD cover');
  const cserif = await cdoc.embedFont(StandardFonts.TimesRoman), csans = await cdoc.embedFont(StandardFonts.Helvetica);
  const cp = cdoc.addPage([W, H]);
  if (layout.cover) {
    const cimg = await embed(cdoc, new Map(), layout.cover.url, base);
    drawCover(cp, cimg, 0, 0, W, H);
    cp.drawRectangle({ x: 0, y: 0, width: W, height: H * 0.4, color: rgb(0, 0, 0), opacity: 0.35 });
  } else cp.drawRectangle({ x: 0, y: 0, width: W, height: H, color: INK });
  const nmLines = wrap(layout.cover?.name || layout.pages[0]?.name || '', cserif, 46, W - 2 * (BX + M));
  let y = BY + M + 40 + (nmLines.length - 1) * 48;
  nmLines.forEach((ln, i) => cp.drawText(ln, { x: BX + M, y: y - i * 48, size: 46, font: cserif, color: rgb(1, 1, 1) }));
  if (layout.cover?.role) cp.drawText(safe(layout.cover.role).toUpperCase(), { x: BX + M, y: BY + M + 12, size: 9, font: csans, color: rgb(1, 1, 1) });
  cp.drawText('BOOKD', { x: W - BX - M - cserif.widthOfTextAtSize('BOOKD', 12), y: H - BY - M, size: 12, font: cserif, color: rgb(1, 1, 1) });
  const cover = await cdoc.save();
  return { interior: Buffer.from(interior), cover: Buffer.from(cover), pageCount: layout.pages.length };
}
