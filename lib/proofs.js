// lib/proofs.js — build a proof (layout + print PDFs) for an order. Used by the admin ("Build new proof")
// and by the performer portal ("Update my proof" after the performer fixes their own text or photos).
import { q, one, logEvent } from './db.js';
import { buildLayout } from './layout.js';
import { buildPdfs } from './pdf.js';
import { savePublic } from './storage.js';
import * as lulu from './lulu.js';
// PDF engine version. 2 = fonts embedded (Lulu rejects PDFs whose fonts aren't embedded).
export const PDF_ENGINE = 2;
// An approved proof built by an older engine: redo its print files from the SAME layout (same pages, same photos),
// so the customer's approval still stands. Used right before sending to Lulu.
export async function refreshPrintFiles(proof, order, site, actor) {
  const layout = typeof proof.layout === 'string' ? JSON.parse(proof.layout) : proof.layout;
  if (!layout || (layout.engine || 1) >= PDF_ENGINE) return proof;
  const pdf = await buildPdfs(layout, site);
  const stamp = Date.now().toString(36);
  const interior_url = await savePublic(`proofs/${order.ref}/v${proof.version}-print-${stamp}-interior.pdf`, pdf.interior, 'application/pdf');
  const cover_url = await savePublic(`proofs/${order.ref}/v${proof.version}-print-${stamp}-cover.pdf`, pdf.cover, 'application/pdf');
  layout.engine = PDF_ENGINE;
  await q('UPDATE proofs SET interior_url=$1, cover_url=$2, layout=$3 WHERE id=$4', [interior_url, cover_url, JSON.stringify(layout), proof.id]);
  await logEvent(order.id, actor, `Print files of approved proof v${proof.version} regenerated with embedded fonts (same pages, same photos)`);
  return { ...proof, interior_url, cover_url, layout };
}
export async function buildProof(orderId, site, actor) {
  const order = await one('SELECT * FROM orders WHERE id=$1', [orderId]); if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  const shoots = await q('SELECT * FROM shoots WHERE order_id=$1 ORDER BY position, id', [orderId]);
  const photos = await q('SELECT * FROM photos WHERE order_id=$1 ORDER BY shoot_id, position, id', [orderId]);
  const last = await one('SELECT version FROM proofs WHERE order_id=$1 ORDER BY version DESC LIMIT 1', [orderId]);
  const layout = buildLayout(order, shoots, photos);
  if (!layout.cover) throw Object.assign(new Error('Add photos before building a proof'), { status: 400 });
  layout.coverDims = await lulu.coverDimensions(layout.binding, layout.pageCount);
  layout.engine = PDF_ENGINE;
  const pdf = await buildPdfs(layout, site);
  const version = (last?.version || 0) + 1;
  const interior_url = await savePublic(`proofs/${order.ref}/v${version}-interior.pdf`, pdf.interior, 'application/pdf');
  const cover_url = await savePublic(`proofs/${order.ref}/v${version}-cover.pdf`, pdf.cover, 'application/pdf');
  const preview_url = await savePublic(`proofs/${order.ref}/v${version}-preview-spreads.pdf`, pdf.preview, 'application/pdf');
  const p = await one(`INSERT INTO proofs (order_id, version, status, layout, interior_url, cover_url, preview_url, page_count) VALUES ($1,$2,'draft',$3,$4,$5,$6,$7) RETURNING id`,
    [orderId, version, JSON.stringify(layout), interior_url, cover_url, preview_url, pdf.pageCount]);
  await logEvent(orderId, actor, `Proof v${version} built (${pdf.pageCount} pages, cover ${(pdf.coverSize.width / 72).toFixed(3)} x ${(pdf.coverSize.height / 72).toFixed(3)} in${layout.coverDims.source === 'lulu' ? ' from Lulu' : ' estimated'})`);
  return { proofId: p.id, version, warnings: layout.warnings, interior_url, cover_url, preview_url, pageCount: pdf.pageCount, order };
}
