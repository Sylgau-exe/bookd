// lib/storage.js — files in Vercel Blob (production) or a local folder (testing)
import { put, del } from '@vercel/blob';
import fs from 'node:fs/promises';
import path from 'node:path';
// a connected Blob store gives either OIDC (BLOB_STORE_ID) or a read-write token; browser uploads need the token
export const hasBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
export const canClientUpload = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export async function savePublic(key, data, contentType) {
  if (process.env.LOCAL_BLOB_DIR) {
    const f = path.join(process.env.LOCAL_BLOB_DIR, key);
    await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, data);
    return `/_blob/${key}`;
  }
  if (!hasBlob()) throw Object.assign(new Error('Blob storage not configured'), { code: 'NO_BLOB' });
  const b = await put(key, data, { access: 'public', contentType, addRandomSuffix: true });
  return b.url;
}
// v1.28: duplicated / re-ordered books share the same photo files, so a file is only deleted
// when no order still uses it (photos, credit images, proof PDFs). Call it AFTER the database row is changed.
async function stillUsed(url) {
  try {
    const { one } = await import('./db.js');
    const r = await one(`SELECT (SELECT count(*) FROM photos WHERE url=$1) + (SELECT count(*) FROM shoots WHERE credit_image=$1)
      + (SELECT count(*) FROM proofs WHERE interior_url=$1 OR cover_url=$1 OR preview_url=$1) AS n`, [url]);
    return Number(r?.n || 0) > 0;
  } catch (e) { console.error('stillUsed', e.message); return true; } // when in doubt, keep the file
}
export async function removePublic(url) {
  if (!url || await stillUsed(url)) return;
  try {
    if (process.env.LOCAL_BLOB_DIR && url.startsWith('/_blob/')) return fs.unlink(path.join(process.env.LOCAL_BLOB_DIR, url.slice(7)));
    if (hasBlob() && /^https:\/\//.test(url)) await del(url);
  } catch (e) { console.error('remove', e.message); }
}
export async function fetchBytes(url, base) {
  if (process.env.LOCAL_BLOB_DIR && url.startsWith('/_blob/')) return fs.readFile(path.join(process.env.LOCAL_BLOB_DIR, url.slice(7)));
  const full = /^https?:/.test(url) ? url : base + url;
  const r = await fetch(full); if (!r.ok) throw new Error('fetch ' + r.status + ' ' + full);
  return Buffer.from(await r.arrayBuffer());
}
