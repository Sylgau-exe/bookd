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
export async function removePublic(url) {
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
