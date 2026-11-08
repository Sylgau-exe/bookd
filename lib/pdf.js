// lib/pdf.js — print-ready PDFs with pdf-lib, to Lulu's specs.
// Interior: US Letter 8.5 x 11 in trim + 0.125 in bleed on every side = 8.75 x 11.25 in, single pages.
// Cover: one wrap-around spread (back + spine + front) at the size Lulu gives for the page count (lib/lulu.js coverDimensions).
import { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, moveTo, appendBezierCurve, closePath } from 'pdf-lib';
import { fetchBytes } from './storage.js';
import { TRIM, BLEED } from './lulu.js';
import { getTemplate, creditColors } from './templates.js';
import { ornamentFor } from './ornaments.js';
const PT = 72, W = (TRIM.w + 2 * BLEED) * PT, H = (TRIM.h + 2 * BLEED) * PT, BX = BLEED * PT, BY = BLEED * PT, M = 0.75 * PT;
const hex = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
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
function drawFillClipped(page, img, x, y, w, h) { // fill a slot, crop what overflows the slot
  page.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath());
  drawCover(page, img, x, y, w, h);
  page.pushOperators(popGraphicsState());
}
function drawContain(page, img, x, y, w, h) {
  const s = Math.min(w / img.width, h / img.height), iw = img.width * s, ih = img.height * s;
  page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
}
export async function buildPdfs(layout, base) {
  const tpl = getTemplate(layout.template);
  const INK = hex(tpl.ink), MUTED = hex(tpl.muted), ACCENT = hex(tpl.accent), PAPER = hex(tpl.paper);
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`BOOKD — ${layout.pages[0]?.name || ''}`)); doc.setCreator('BOOKD');
  const serif = await doc.embedFont(StandardFonts.TimesRoman), serifI = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica), sansB = await doc.embedFont(StandardFonts.HelveticaBold), sansO = await doc.embedFont(StandardFonts.HelveticaOblique);
  // design: title font, number font, story font, case
  const TITLE = tpl.titles === 'serif' ? serif : tpl.titles === 'sans-bold' ? sansB : sans;
  const NUMF = tpl.num === 'italic' ? serifI : tpl.num === 'bold' ? sansB : sans;
  const STORY = tpl.titles === 'serif' ? serifI : sansO;
  const up = (t) => tpl.upper ? safe(t).toUpperCase() : safe(t);
  const minimal = tpl.num === 'thin';
  const cache = new Map();
  const L = BX + M, R = W - BX - M, T = H - BY - M, B = BY + M, TW = R - L;
  let num = 0;
  for (const p of layout.pages) {
    num++;
    const page = doc.addPage([W, H]);
    let bg = PAPER, ink = INK, muted = MUTED, accent = ACCENT;
    if (p.type === 'credit') { const c = creditColors(tpl, p.num); bg = hex(c.bg); ink = hex(c.ink); muted = hex(c.mutedHex); accent = hex(c.accent); }
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: bg });
    if (['credit', 'bio', 'closing'].includes(p.type) && layout.ornament) {
      const orn = ornamentFor(layout.ornament.key, layout.ornament.color, tpl, p.type === 'credit' && !!tpl.palette);
      if (orn) for (const sh of orn.shapes) {
        const o = { x: BX, y: H - BY, scale: 0.72, opacity: sh.op ?? 1, borderOpacity: sh.op ?? 1 };
        if (sh.fill) page.drawSvgPath(sh.d, { ...o, color: hex(orn.color) });
        else page.drawSvgPath(sh.d, { ...o, borderColor: hex(orn.color), borderWidth: (sh.w || 1.5) * 0.72 });
      }
    }
    const folio = (dark) => { if (p.type === 'blank') return; const s = String(num).padStart(2, '0'); const odd = num % 2 === 1;
      page.drawText(s, { x: odd ? W - BX - 0.45 * PT - sans.widthOfTextAtSize(s, 7) : BX + 0.45 * PT, y: BY + 0.3 * PT, size: 7, font: sans, color: dark ? rgb(1, 1, 1) : muted }); };
    if (p.type === 'photo') {
      if (p.mode === 'duo') { // two photos side by side, 4:5 slots, centred on the page
        const gap = 0.25 * PT, sw = (TW - gap) / 2, sh = sw * 1.25, sy = (H - sh) / 2;
        for (const [k, it] of p.items.entries()) drawFillClipped(page, await embed(doc, cache, it.url, base), L + k * (sw + gap), sy, sw, sh);
        folio(false);
      } else {
        const img = await embed(doc, cache, p.url, base);
        if (p.mode === 'full') drawCover(page, img, 0, 0, W, H);
        else drawContain(page, img, L, B + 0.3 * PT, TW, T - B - 0.3 * PT);
        folio(p.mode === 'full');
      }
    } else if (p.type === 'credit') {
      let y = T - (minimal ? 24 : 72);
      const ns = String(p.num).padStart(2, '0');
      page.drawText(ns, { x: L, y, size: minimal ? 14 : 84, font: NUMF, color: accent });
      y -= minimal ? 30 : 34; page.drawText(safe(p.kind).toUpperCase(), { x: L, y, size: 8.5, font: sans, color: muted });
      const ts = minimal ? 20 : tpl.titles === 'serif' ? 26 : 24;
      y -= 30; for (const ln of wrap(up(p.title), TITLE, ts, TW)) { page.drawText(ln, { x: L, y, size: ts, font: TITLE, color: ink }); y -= ts + 4; }
      if (minimal) { y -= 8; page.drawLine({ start: { x: L, y }, end: { x: L + 36, y }, thickness: 0.6, color: ink }); y -= 10; }
      y -= 14;
      for (const c of p.credits) {
        page.drawText(safe(c.label).toUpperCase(), { x: L, y, size: 7.5, font: sans, color: muted });
        const lines = wrap(c.value, sans, 10.5, TW - 110);
        lines.forEach((ln, i) => page.drawText(ln, { x: L + 110, y: y - i * 14, size: 10.5, font: sans, color: ink }));
        y -= 14 * lines.length + 6;
      }
      if (p.creditImage) { // photographer portrait (round) or company logo (as is), under the credits
        try {
          const im = await embed(doc, cache, p.creditImage.url, base);
          if (p.creditImage.kind === 'logo') {
            const bw = 1.6 * PT, bh = 0.8 * PT, s = Math.min(bw / im.width, bh / im.height);
            page.drawImage(im, { x: L, y: y - 10 - im.height * s, width: im.width * s, height: im.height * s });
          } else {
            const d = 0.95 * PT, r = d / 2, cx = L + r, cy = y - 10 - r, k = 0.5523 * r;
            page.pushOperators(pushGraphicsState(), moveTo(cx + r, cy), appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
              appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy), appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
              appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy), closePath(), clip(), endPath());
            drawCover(page, im, cx - r, cy - r, d, d);
            page.pushOperators(popGraphicsState());
          }
        } catch (e) { console.error('credit image', e.message); }
      }
      if (p.story) {
        const lines = wrap(p.story, STORY, 13, TW);
        let sy = B + 20 + lines.length * 18;
        page.drawLine({ start: { x: L, y: sy + 22 }, end: { x: minimal ? L + 36 : R, y: sy + 22 }, thickness: minimal ? 0.6 : 0.8, color: ink });
        page.drawText('THE STORY', { x: L, y: sy + 8, size: 7.5, font: sans, color: muted });
        lines.forEach((ln, i) => page.drawText(ln, { x: L, y: sy - 12 - i * 18, size: 13, font: STORY, color: ink }));
      }
      folio(false);
    } else if (p.type === 'bio') {
      let y = T - 30; const ns = minimal ? 24 : 34;
      for (const ln of wrap(up(p.name), TITLE, ns, TW)) { page.drawText(ln, { x: L, y, size: ns, font: TITLE, color: ink }); y -= ns + 4; }
      if (p.role) { page.drawText(safe(p.role).toUpperCase(), { x: L, y, size: 8.5, font: sans, color: tpl.palette ? accent : muted }); y -= 30; }
      for (const ln of wrap(p.bio, sans, 11.5, TW)) { page.drawText(ln, { x: L, y, size: 11.5, font: sans, color: ink }); y -= 17; }
      let fy = B + 20 + p.facts.length * 18;
      for (const [k, v] of p.facts) { page.drawText(safe(k).toUpperCase(), { x: L, y: fy, size: 7.5, font: sans, color: muted }); page.drawText(safe(v), { x: L + 110, y: fy, size: 10.5, font: sans, color: ink }); fy -= 18; }
      folio(false);
    } else if (p.type === 'closing') {
      const cx = (t, f, s) => W / 2 - f.widthOfTextAtSize(t, s) / 2;
      const nm = up(p.name), cs = minimal ? 22 : 30; page.drawText(nm, { x: cx(nm, TITLE, cs), y: H / 2 + 30, size: cs, font: TITLE, color: ink });
      let y = H / 2;
      for (const t of [p.contact, p.website].filter(Boolean).map(safe)) { page.drawText(t, { x: cx(t, sans, 10.5), y, size: 10.5, font: sans, color: muted }); y -= 18; }
      const b = 'BOOKD'; page.drawText(b, { x: cx(b, sansB, 8), y: B, size: 8, font: sansB, color: muted });
    }
  }
  const interior = await doc.save();
  // wrap-around cover: back | spine | front. Margin = bleed (softcover) or wrap (hardcover case wrap).
  const dims = layout.coverDims || { width: 2 * W + 0.15 * PT, height: H };
  const CW = dims.width, CH = dims.height, mg = (CH - TRIM.h * PT) / 2, panel = TRIM.w * PT + mg, spine = Math.max(0, CW - 2 * panel);
  const safeIn = mg + 0.25 * PT; // keep text this far from the outer edges
  const cdoc = await PDFDocument.create(); cdoc.setTitle(safe(`BOOKD cover — ${layout.cover?.name || ''}`)); cdoc.setCreator('BOOKD');
  const cserif = await cdoc.embedFont(StandardFonts.TimesRoman), csans = await cdoc.embedFont(StandardFonts.Helvetica), csansB = await cdoc.embedFont(StandardFonts.HelveticaBold);
  const cp = cdoc.addPage([CW, CH]);
  cp.drawRectangle({ x: 0, y: 0, width: CW, height: CH, color: hex(tpl.back) });  // back + spine background
  const fx = panel + spine;                                                       // front panel starts here
  if (layout.cover) {
    const cimg = await embed(cdoc, new Map(), layout.cover.url, base);
    const s2 = Math.max(panel / cimg.width, CH / cimg.height), iw = cimg.width * s2, ih = cimg.height * s2;
        cp.pushOperators(pushGraphicsState(), rectangle(fx, 0, panel, CH), clip(), endPath());
    cp.drawImage(cimg, { x: fx + (panel - iw) / 2, y: (CH - ih) / 2, width: iw, height: ih });
    cp.pushOperators(popGraphicsState());
    if (tpl.band) cp.drawRectangle({ x: fx, y: 0, width: panel, height: mg + TRIM.h * PT * 0.4, color: rgb(0, 0, 0), opacity: tpl.band });
    if (tpl.palette) cp.drawRectangle({ x: fx, y: 0, width: panel, height: mg + 1.15 * PT, color: hex(tpl.palette[0]) });
  }
  const fl = fx + 0.25 * PT + (spine ? 0.125 * PT : 0), fw = CW - safeIn - fl;   // front text box (clear of the hinge)
  const CF = tpl.titles === 'serif' ? cserif : tpl.titles === 'sans-bold' ? csansB : csans, CS = tpl.num === 'thin' ? 30 : tpl.titles === 'serif' ? 46 : 40;
  const cname = layout.cover?.name || layout.pages[0]?.name || '';
  const nmLines = wrap(tpl.upper ? cname.toUpperCase() : cname, CF, CS, fw);
  let y = safeIn + 40 + (nmLines.length - 1) * (CS + 2);
  nmLines.forEach((ln, i) => cp.drawText(ln, { x: fl, y: y - i * (CS + 2), size: CS, font: CF, color: rgb(1, 1, 1) }));
  if (layout.cover?.role) cp.drawText(safe(layout.cover.role).toUpperCase(), { x: fl, y: safeIn + 12, size: 9, font: csans, color: rgb(1, 1, 1) });
  cp.drawText('BOOKD', { x: CW - safeIn - cserif.widthOfTextAtSize('BOOKD', 12), y: CH - safeIn - 12, size: 12, font: cserif, color: rgb(1, 1, 1) });
  // spine text only when the spine is wide enough to read
  if (spine >= 0.3 * PT) {
    const st = safe(`${layout.cover?.name || ''}  ·  BOOKD`).toUpperCase(), ss = Math.min(10, spine * 0.45);
    cp.drawText(st, { x: panel + spine / 2 + ss * 0.35, y: CH / 2 - csansB.widthOfTextAtSize(st, ss) / 2, size: ss, font: csansB, color: hex(tpl.backInk), rotate: degrees(90) });
  }
  if (tpl.back.toUpperCase() === '#FFFFFF') cp.drawLine({ start: { x: panel, y: 0 }, end: { x: panel, y: CH }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
  // back panel: contact block
  const bl = safeIn, bw = panel - safeIn - 0.25 * PT - bl;
  const back = [layout.cover?.name, layout.back?.contact, layout.back?.website].filter(Boolean).map(safe);
  let by = safeIn + 0.6 * PT + back.length * 16;
  back.forEach((t, i) => { for (const ln of wrap(t, i ? csans : CF, i ? 10 : 16, bw)) { cp.drawText(ln, { x: bl, y: by, size: i ? 10 : 16, font: i ? csans : CF, color: hex(tpl.backInk) }); by -= i ? 14 : 22; } });
  cp.drawText('BOOKD', { x: bl, y: safeIn, size: 8, font: csansB, color: hex(tpl.backInk), opacity: 0.7 });
  const cover = await cdoc.save();
  const preview = await buildPreview(interior, cover, mg, layout);
  return { interior: Buffer.from(interior), cover: Buffer.from(cover), preview: Buffer.from(preview), pageCount: layout.pages.length, coverSize: { width: CW, height: CH, spine } };
}
// Reading copy for the performer: the open cover (back, spine, front) then double pages, trimmed to the final size (no bleed).
// Any PDF viewer shows it as spreads. Not used for printing.
async function buildPreview(interiorBytes, coverBytes, coverMargin, layout) {
  const doc = await PDFDocument.create(); doc.setTitle(safe(`BOOKD — ${layout.cover?.name || ''} — preview`)); doc.setCreator('BOOKD');
  const TW = TRIM.w * PT, TH = TRIM.h * PT, b = BLEED * PT;
  const [cv] = await doc.embedPdf(coverBytes, [0]);
  const cw = cv.width - 2 * coverMargin, ch = cv.height - 2 * coverMargin;
  doc.addPage([cw, ch]).drawPage(cv, { x: -coverMargin, y: -coverMargin });
  const src = await PDFDocument.load(interiorBytes); const n = src.getPageCount();
  const pages = await doc.embedPdf(interiorBytes, [...Array(n).keys()]);
  const paper = hex(getTemplate(layout.template).paper);
  const spread = (l, r) => {
    const pg = doc.addPage([2 * TW, TH]);
    pg.drawRectangle({ x: 0, y: 0, width: 2 * TW, height: TH, color: rgb(0.93, 0.93, 0.92) });
    if (l) { pg.pushOperators(pushGraphicsState(), rectangle(0, 0, TW, TH), clip(), endPath()); pg.drawPage(l, { x: -b, y: -b }); pg.pushOperators(popGraphicsState()); }
    if (r) { pg.pushOperators(pushGraphicsState(), rectangle(TW, 0, TW, TH), clip(), endPath()); pg.drawPage(r, { x: TW - b, y: -b }); pg.pushOperators(popGraphicsState()); }
    pg.drawLine({ start: { x: TW, y: 0 }, end: { x: TW, y: TH }, thickness: 0.4, color: rgb(0.75, 0.75, 0.75) });
  };
  spread(null, pages.at(0));                                   // first page alone on the right, like a real book
  for (let i = 1; i < pages.length; i += 2) spread(pages.at(i), i + 1 < pages.length ? pages.at(i + 1) : null);
  return doc.save();
}
