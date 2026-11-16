// lib/pdf.js — print-ready PDFs with pdf-lib, to Lulu's specs.
// Interior: US Letter 8.5 x 11 in trim + 0.125 in bleed on every side = 8.75 x 11.25 in, single pages.
// Cover: one wrap-around spread (back + spine + front) at the size Lulu gives for the page count (lib/lulu.js coverDimensions).
import { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, moveTo, appendBezierCurve, closePath } from 'pdf-lib';
import { fetchBytes } from './storage.js';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
// Lulu requires every font to be embedded in the PDF. The 14 standard PDF fonts are NOT embedded,
// so we embed Liberation Serif / Sans (SIL OFL), which have the same metrics as Times / Helvetica.
const FONT_FILES = { serif: 'LiberationSerif-Regular.ttf', serifI: 'LiberationSerif-Italic.ttf', sans: 'LiberationSans-Regular.ttf', sansB: 'LiberationSans-Bold.ttf', sansO: 'LiberationSans-Italic.ttf' };
const fontCache = {};
const fontBytes = async (k) => fontCache[k] || (fontCache[k] = await readFile(new URL(`../fonts/${FONT_FILES[k]}`, import.meta.url)));
async function embedFonts(doc, keys) { doc.registerFontkit(fontkit); const out = {}; for (const k of keys) out[k] = await doc.embedFont(await fontBytes(k), { subset: true }); return out; }
import { TRIM, BLEED, FLAP, hardSpine } from './lulu.js';
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
  const { serif, serifI, sans, sansB, sansO } = await embedFonts(doc, ['serif', 'serifI', 'sans', 'sansB', 'sansO']);
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
    if (p.type === 'credit' || p.type === 'opener') { const c = creditColors(tpl, p.num); bg = hex(c.bg); ink = hex(c.ink); muted = hex(c.mutedHex); accent = hex(c.accent); }
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: bg });
    if (['credit', 'bio', 'closing', 'opener'].includes(p.type) && layout.ornament) {
      const orn = ornamentFor(layout.ornament.key, layout.ornament.color, tpl, (p.type === 'credit' || p.type === 'opener') && !!tpl.palette);
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
            page.drawImage(im, { x: L, y: y - 10 - im.height * s, width: im.width * s, height: im.height * s }); y -= 10 + im.height * s;
          } else {
            const d = 0.95 * PT, r = d / 2, cx = L + r, cy = y - 10 - r, k = 0.5523 * r; y -= 10 + d;
            page.pushOperators(pushGraphicsState(), moveTo(cx + r, cy), appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
              appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy), appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
              appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy), closePath(), clip(), endPath());
            drawCover(page, im, cx - r, cy - r, d, d);
            page.pushOperators(popGraphicsState());
          }
        } catch (e) { console.error('credit image', e.message); }
      }
      const storyLines = p.story ? wrap(p.story, STORY, 13, TW) : [];
      if (p.inset) { // v1.34 — one photo of the shoot, small, between the credits and the story (keeps the credit page on the left)
        try {
          const im = await embed(doc, cache, p.inset.url, base);
          const top = y - 16, bottom = storyLines.length ? B + 20 + storyLines.length * 18 + 22 + 20 : B + 14, avail = top - bottom;
          if (avail >= 0.9 * PT) {
            const sc = Math.min(Math.min(avail, 4.4 * PT) / im.height, TW * 0.62 / im.width), iw = im.width * sc, ih = im.height * sc;
            page.drawImage(im, { x: L + (TW - iw) / 2, y: top - ih, width: iw, height: ih }); // centred on the page
          } else console.error('inset photo: no room on credit page', p.num);
        } catch (e) { console.error('inset photo', e.message); }
      }
      if (p.story) {
        const lines = storyLines;
        let sy = B + 20 + lines.length * 18;
        page.drawLine({ start: { x: L, y: sy + 22 }, end: { x: minimal ? L + 36 : R, y: sy + 22 }, thickness: minimal ? 0.6 : 0.8, color: ink });
        page.drawText('THE STORY', { x: L, y: sy + 8, size: 7.5, font: sans, color: muted });
        lines.forEach((ln, i) => page.drawText(ln, { x: L, y: sy - 12 - i * 18, size: 13, font: STORY, color: ink }));
      }
      folio(false);
    } else if (p.type === 'opener') { // v1.34 — title page of a shoot (right page), used when the small photo does not fit
      const ns = String(p.num).padStart(2, '0'), big = minimal ? 40 : 150;
      let y = H / 2 + (minimal ? 30 : 40);
      page.drawText(ns, { x: L, y, size: big, font: NUMF, color: accent });
      y -= 40; page.drawText(safe(p.kind).toUpperCase(), { x: L, y, size: 9, font: sans, color: muted });
      const ts = minimal ? 24 : tpl.titles === 'serif' ? 34 : 30;
      y -= 40; for (const ln of wrap(up(p.title), TITLE, ts, TW)) { page.drawText(ln, { x: L, y, size: ts, font: TITLE, color: ink }); y -= ts + 6; }
      folio(false);
    } else if (p.type === 'bio') {
      let y = T - 30; const ns = minimal ? 24 : 34;
      for (const ln of wrap(up(p.name), TITLE, ns, TW)) { page.drawText(ln, { x: L, y, size: ns, font: TITLE, color: ink }); y -= ns + 4; }
      if (p.role) { page.drawText(safe(p.role).toUpperCase(), { x: L, y, size: 8.5, font: sans, color: tpl.palette ? accent : muted }); y -= 30; }
      for (const ln of wrap(p.bio, sans, 11.5, TW)) { page.drawText(ln, { x: L, y, size: 11.5, font: sans, color: ink }); y -= 17; }
      if (p.photo) { // v1.35 — small portrait under the biography, centred
        try {
          const im = await embed(doc, cache, p.photo.url, base);
          const top = y - 14, bottom = B + 20 + p.facts.length * 18 + 26, avail = top - bottom;
          if (avail >= 0.9 * PT) {
            const sc = Math.min(Math.min(avail, 4.4 * PT) / im.height, TW * 0.62 / im.width), iw = im.width * sc, ih = im.height * sc;
            page.drawImage(im, { x: L + (TW - iw) / 2, y: top - ih, width: iw, height: ih });
          } else console.error('bio photo: no room under the biography');
        } catch (e) { console.error('bio photo', e.message); }
      }
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
  if (layout.jacket) { // v1.36 — dust jacket edition: the cover file is the jacket laid flat, flaps included
    const jk = await buildJacket(layout, tpl, base);
    const preview = await buildPreview(interior, jk.bytes, BLEED * PT, layout);
    return { interior: Buffer.from(interior), cover: Buffer.from(jk.bytes), preview: Buffer.from(preview), pageCount: layout.pages.length, coverSize: { width: jk.CW, height: jk.CH, spine: jk.spine } };
  }
  // wrap-around cover: back | spine | front. Margin = bleed (softcover) or wrap (hardcover case wrap).
  const dims = layout.coverDims || { width: 2 * W + 0.15 * PT, height: H };
  const CW = dims.width, CH = dims.height, mg = (CH - TRIM.h * PT) / 2, panel = TRIM.w * PT + mg, spine = Math.max(0, CW - 2 * panel);
  const safeIn = mg + 0.25 * PT; // keep text this far from the outer edges
  const cdoc = await PDFDocument.create(); cdoc.setTitle(safe(`BOOKD cover — ${layout.cover?.name || ''}`)); cdoc.setCreator('BOOKD');
  const { serif: cserif, sans: csans, sansB: csansB } = await embedFonts(cdoc, ['serif', 'sans', 'sansB']);
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
// v1.36 — Dust jacket, laid flat, left to right:  back flap | back cover | spine | front cover | front flap
//   Total size comes from Lulu (cover-dimensions). Flaps are 3.25 in, the spine follows Lulu's hardcover table,
//   and the two cover panels share what is left. The front photo and the back colour run 0.25 in past each fold,
//   so a fold that lands a little off never shows a wrong-coloured edge. Text stays 0.3 in clear of folds and edges.
async function buildJacket(layout, tpl, base) {
  const J = layout.jacket, pages = layout.pageCount || layout.pages.length;
  const dims = layout.coverDims || { width: (2 * BLEED + 2 * FLAP + 2 * (TRIM.w + 0.3125) + hardSpine(pages)) * PT, height: (TRIM.h + 0.25 + 2 * BLEED) * PT };
  const CW = dims.width, CH = dims.height, b = BLEED * PT, F = FLAP * PT, S = hardSpine(pages) * PT, P = (CW - 2 * b - 2 * F - S) / 2;
  const fold1 = b + F, spineL = fold1 + P, spineR = spineL + S, fold2 = spineR + P, wrap = 0.25 * PT, pad = 0.3 * PT, fpad = 0.4 * PT; // fpad: text margin inside the flaps
  const doc = await PDFDocument.create(); doc.setTitle(safe(`BOOKD jacket — ${layout.cover?.name || ''}`)); doc.setCreator('BOOKD');
  const { serif, serifI, sans, sansB } = await embedFonts(doc, ['serif', 'serifI', 'sans', 'sansB']);
  const TF = tpl.titles === 'serif' ? serif : tpl.titles === 'sans-bold' ? sansB : sans;
  const up = (t) => tpl.upper ? safe(t).toUpperCase() : safe(t);
  const pg = doc.addPage([CW, CH]); const cache = new Map();
  const paper = hex('#FBFBFA'), ink = hex('#17171C'), muted = hex('#6B6B73'), accent = hex(tpl.palette ? tpl.palette[0] : (tpl.accent === '#F4F4F2' || tpl.accent === '#111111' ? '#17171C' : tpl.accent)), backInk = hex(tpl.backInk);
  const white = rgb(1, 1, 1), name = layout.cover?.name || layout.pages[0]?.name || '';
  // backgrounds: flaps on warm white, back cover + spine in the design's back colour
  pg.drawRectangle({ x: 0, y: 0, width: CW, height: CH, color: paper });
  pg.drawRectangle({ x: fold1 - wrap, y: 0, width: P + S + wrap, height: CH, color: hex(tpl.back) });
  // front cover: same photo, band, name and role as the printed hardcover
  if (layout.cover) {
    const im = await embed(doc, cache, layout.cover.url, base), fw = P + wrap;
    pg.pushOperators(pushGraphicsState(), rectangle(spineR, 0, fw, CH), clip(), endPath());
    drawCover(pg, im, spineR, 0, fw, CH);
    if (tpl.band) pg.drawRectangle({ x: spineR, y: 0, width: fw, height: b + TRIM.h * PT * 0.4, color: rgb(0, 0, 0), opacity: tpl.band });
    if (tpl.palette) pg.drawRectangle({ x: spineR, y: 0, width: fw, height: b + 1.15 * PT, color: hex(tpl.palette[0]) });
    pg.pushOperators(popGraphicsState());
  }
  const fl = spineR + pad + 0.1 * PT, fwT = fold2 - pad - fl, CS = tpl.num === 'thin' ? 30 : tpl.titles === 'serif' ? 46 : 40;
  const nm = wrap2(tpl.upper ? name.toUpperCase() : name, TF, CS, fwT);
  let y = b + pad + 40 + (nm.length - 1) * (CS + 2);
  nm.forEach((ln, i) => pg.drawText(ln, { x: fl, y: y - i * (CS + 2), size: CS, font: TF, color: white }));
  if (layout.cover?.role) pg.drawText(safe(layout.cover.role).toUpperCase(), { x: fl, y: b + pad + 12, size: 9, font: sans, color: white });
  pg.drawText('BOOKD', { x: fold2 - pad - serif.widthOfTextAtSize('BOOKD', 12), y: CH - b - pad - 12, size: 12, font: serif, color: white });
  // spine of the jacket
  if (S >= 0.24 * PT) { const st = safe(`${name}  ·  BOOKD`).toUpperCase(), ss = Math.min(10, S * 0.45);
    pg.drawText(st, { x: spineL + S / 2 + ss * 0.35, y: CH / 2 - sansB.widthOfTextAtSize(st, ss) / 2, size: ss, font: sansB, color: backInk, rotate: degrees(90) }); }
  // back cover: name and contact, bottom left
  { const bl = fold1 + pad + 0.1 * PT, bw = spineL - pad - bl, lines = [name, layout.back?.contact, layout.back?.website].filter(Boolean).map(safe);
    let by = b + pad + 0.5 * PT + lines.length * 16;
    lines.forEach((t, i) => { for (const ln of wrap2(t, i ? sans : TF, i ? 10 : 16, bw)) { pg.drawText(ln, { x: bl, y: by, size: i ? 10 : 16, font: i ? sans : TF, color: backInk }); by -= i ? 14 : 22; } }); }
  // FRONT FLAP: a short introduction on top, the sponsor block at the bottom
  { const x = fold2 + wrap + fpad, w = CW - b - fpad - x; let ty = CH - b - fpad - 14;
    pg.drawText('ABOUT', { x, y: ty, size: 7.5, font: sans, color: muted }); ty -= 26;
    for (const ln of wrap2(up(name), TF, 20, w)) { pg.drawText(ln, { x, y: ty, size: 20, font: TF, color: ink }); ty -= 24; }
    ty -= 6; pg.drawLine({ start: { x, y: ty + 6 }, end: { x: x + 28, y: ty + 6 }, thickness: 0.8, color: accent }); ty -= 12;
    const sp = J.sponsor; let floor = b + fpad;
    if (sp) { // built from the bottom up
      let sy = b + fpad;
      const note = sp.note ? wrap2(sp.note, sans, 8.5, w) : [];
      note.slice().reverse().forEach(ln => { pg.drawText(ln, { x, y: sy, size: 8.5, font: sans, color: muted }); sy += 12; });
      if (note.length) sy += 8;
      let drew = false;
      if (sp.logo) { try { const lg = await embed(doc, cache, sp.logo, base); const sc = Math.min(w * 0.8 / lg.width, 1.7 * PT / lg.height); pg.drawImage(lg, { x, y: sy, width: lg.width * sc, height: lg.height * sc }); sy += lg.height * sc + 12; drew = true; } catch (e) { console.error('sponsor logo', e.message); } }
      if (!drew && sp.name) { const nl = wrap2(sp.name, TF, 24, w); nl.slice().reverse().forEach(ln => { pg.drawText(ln, { x, y: sy, size: 24, font: TF, color: ink }); sy += 28; }); sy += 4; }
      pg.drawText('SPECIAL EDITION PRESENTED BY', { x, y: sy, size: 6.8, font: sansB, color: accent }); sy += 16;
      pg.drawLine({ start: { x, y: sy }, end: { x: x + w, y: sy }, thickness: 0.6, color: ink }); floor = sy + 22;
    }
    for (const ln of wrap2(J.intro || '', sans, 9.2, w)) { if (ty < floor) break; pg.drawText(ln, { x, y: ty, size: 9.2, font: sans, color: ink }); ty -= 13.6; } }
  // BACK FLAP: portrait, name, facts, BOOKD
  { const x = b + fpad, w = fold1 - wrap - fpad - x; let ty = CH - b - fpad;
    if (J.portrait) { try { const im = await embed(doc, cache, J.portrait.url, base); const pw = Math.min(w, 2.0 * PT), ph = pw * 1.25; drawFillClipped(pg, im, x, ty - ph, pw, ph); ty -= ph + 26; } catch (e) { console.error('jacket portrait', e.message); ty -= 14; } } else ty -= 14;
    for (const ln of wrap2(up(name), TF, 18, w)) { pg.drawText(ln, { x, y: ty, size: 18, font: TF, color: ink }); ty -= 22; }
    if (layout.cover?.role) { pg.drawText(safe(layout.cover.role).toUpperCase(), { x, y: ty, size: 7.5, font: sans, color: muted }); ty -= 24; }
    for (const [k, v] of J.facts || []) { pg.drawText(safe(k).toUpperCase(), { x, y: ty, size: 6.8, font: sans, color: muted }); ty -= 12; for (const ln of wrap2(v, sans, 9.2, w)) { pg.drawText(ln, { x, y: ty, size: 9.2, font: sans, color: ink }); ty -= 13; } ty -= 7; }
    pg.drawText('BOOKD', { x, y: b + fpad, size: 8, font: sansB, color: muted }); }
  return { bytes: await doc.save(), CW, CH, spine: S };
}
const wrap2 = (t, f, s, w) => wrap(t, f, s, w);
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
