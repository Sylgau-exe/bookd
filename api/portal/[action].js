// api/portal/[action].js — the performer's private page (identified by the order token, no account needed)
import { q, one, ensureSchema, logEvent, hasDb } from '../../lib/db.js';
import { readJson, readRaw, fail, clip, siteUrl, handle } from '../../lib/http.js';
import { sendMail, adminInbox } from '../../lib/mail.js';
import { savePublic, removePublic, canClientUpload } from '../../lib/storage.js';
import { PACKAGES, isLowRes } from '../../lib/pricing.js';
import { KIND_LABELS } from '../../lib/layout.js';
import { balanceDue } from '../../lib/orders.js';
import { hasStripe } from '../../lib/stripe.js';

const LOCKED = ['approved', 'printing', 'shipped', 'delivered', 'cancelled'];
const PROFILE_KEYS = ['name', 'role', 'bio', 'height', 'languages', 'agency', 'city', 'contact', 'website'];
const SHIP_KEYS = ['ship_name', 'ship_address', 'ship_city', 'ship_region', 'ship_postal', 'ship_country', 'phone'];

export default async function handler(req, res) {
  const action = req.query.action;
  return handle(req, res, async () => {
    if (!hasDb()) return fail(res, 503, 'Not available yet');
    await ensureSchema();
    const t = String(req.query.t || '');
    const order = t.length >= 32 ? await one('SELECT * FROM orders WHERE token=$1', [t]) : null;
    if (!order) return fail(res, 404, 'This link is not valid. Please check the email you received.');
    const locked = LOCKED.includes(order.status);
    const ownShoot = async (id) => one('SELECT * FROM shoots WHERE id=$1 AND order_id=$2', [parseInt(id, 10), order.id]);

    if (action === 'blob-token') { // direct browser → Vercel Blob uploads (large originals)
      if (locked) return fail(res, 403, 'This book is locked');
      const { handleUpload } = await import('@vercel/blob/client');
      const body = await readJson(req);
      const json = await handleUpload({ body, request: req,
        onBeforeGenerateToken: async () => ({ allowedContentTypes: ['image/jpeg', 'image/png'], maximumSizeInBytes: 60 * 1024 * 1024, addRandomSuffix: true }),
        onUploadCompleted: async () => {} });
      return res.json(json);
    }

    if (action === 'get') {
      const shoots = await q('SELECT id, position, kind, title, credits, story FROM shoots WHERE order_id=$1 ORDER BY position, id', [order.id]);
      const photos = await q('SELECT id, shoot_id, position, url, width, height, low_res, keep, role FROM photos WHERE order_id=$1 ORDER BY shoot_id, position, id', [order.id]);
      const proof = await one(`SELECT id, version, status, layout, interior_url, page_count, sent_at FROM proofs WHERE order_id=$1 AND status IN ('sent','approved','changes') ORDER BY version DESC LIMIT 1`, [order.id]);
      const comments = proof ? await q('SELECT id, page, body, author, created_at FROM proof_comments WHERE proof_id=$1 ORDER BY created_at', [proof.id]) : [];
      const pkg = PACKAGES[order.package] || PACKAGES.signature;
      return res.json({ ok: true, uploadMode: canClientUpload() ? 'blob' : 'direct', kinds: KIND_LABELS,
        order: { ref: order.ref, status: order.status, locked, customer_name: order.customer_name, package: order.package, packageLabel: pkg.label, maxPhotos: pkg.maxPhotos, pages: pkg.pages, copies: order.copies,
          profile: order.profile || {}, ship: Object.fromEntries(SHIP_KEYS.map(k => [k, order[k] || ''])), submitted_at: order.submitted_at,
          pay: { online: hasStripe(), price: order.price_usd == null ? null : +order.price_usd, shipping: order.shipping_usd == null ? null : +order.shipping_usd,
            paid: +(order.paid_usd || order.deposit_usd || 0), deposit_paid: !!order.deposit_paid, balance_paid: !!order.balance_paid, due: balanceDue(order) } },
        shoots, photos, proof, comments });
    }
    const body = req.method === 'POST' && action !== 'upload' ? await readJson(req) : {};
    if (locked && !['proof-comment'].includes(action)) return fail(res, 403, 'This book is approved and locked. Write to us if you need a change.');

    switch (action) {
      case 'profile': {
        const pf = { ...(order.profile || {}) };
        for (const k of PROFILE_KEYS) if (k in (body.profile || {})) pf[k] = clip(body.profile[k], k === 'bio' ? 1200 : 200);
        const vals = [JSON.stringify(pf)], sets = ['profile=$1'];
        for (const k of SHIP_KEYS) if (k in (body.ship || {})) { vals.push(clip(body.ship[k], 300)); sets.push(`${k}=$${vals.length}`); }
        vals.push(order.id);
        await q(`UPDATE orders SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
        if (order.status === 'new') await q(`UPDATE orders SET status='collecting' WHERE id=$1`, [order.id]);
        return res.json({ ok: true });
      }
      case 'shoot-save': {
        const credits = Array.isArray(body.credits) ? body.credits.slice(0, 12).map(c => ({ label: clip(c.label, 40), value: clip(c.value, 160) })).filter(c => c.label || c.value) : [];
        const kind = KIND_LABELS[body.kind] ? body.kind : 'other';
        if (body.id) {
          if (!(await ownShoot(body.id))) return fail(res, 404, 'Shoot not found');
          await q('UPDATE shoots SET kind=$1, title=$2, credits=$3, story=$4 WHERE id=$5', [kind, clip(body.title, 120), JSON.stringify(credits), clip(body.story, 800), parseInt(body.id, 10)]);
          return res.json({ ok: true, id: parseInt(body.id, 10) });
        }
        const pos = (await one('SELECT coalesce(max(position),0)+1 AS p FROM shoots WHERE order_id=$1', [order.id])).p;
        const s = await one('INSERT INTO shoots (order_id, position, kind, title, credits, story) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [order.id, pos, kind, clip(body.title, 120), JSON.stringify(credits), clip(body.story, 800)]);
        return res.json({ ok: true, id: s.id });
      }
      case 'shoot-delete': {
        const s = await ownShoot(body.id); if (!s) return fail(res, 404, 'Shoot not found');
        const ph = await q('SELECT url FROM photos WHERE shoot_id=$1', [s.id]);
        await q('DELETE FROM shoots WHERE id=$1', [s.id]);
        for (const p of ph) await removePublic(p.url);
        return res.json({ ok: true });
      }
      case 'shoot-move': {
        const ids = (body.order || []).map(n => parseInt(n, 10));
        for (let i = 0; i < ids.length; i++) await q('UPDATE shoots SET position=$1 WHERE id=$2 AND order_id=$3', [i + 1, ids[i], order.id]);
        return res.json({ ok: true });
      }
      case 'upload': { // small files straight through the function (fallback when Blob client uploads are off)
        const s = await ownShoot(req.query.shoot); if (!s) return fail(res, 404, 'Shoot not found');
        const type = req.headers['content-type'] || '';
        if (!/^image\/(jpeg|png)$/.test(type)) return fail(res, 400, 'Please upload JPG or PNG photos');
        const buf = await readRaw(req);
        const ext = type === 'image/png' ? 'png' : 'jpg';
        const url = await savePublic(`orders/${order.ref}/s${s.id}-${Date.now()}.${ext}`, buf, type);
        const w = parseInt(req.headers['x-width'], 10) || null, h = parseInt(req.headers['x-height'], 10) || null;
        const pos = (await one('SELECT coalesce(max(position),0)+1 AS p FROM photos WHERE shoot_id=$1', [s.id])).p;
        const p = await one('INSERT INTO photos (order_id, shoot_id, position, url, filename, width, height, bytes, low_res) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [order.id, s.id, pos, url, clip(decodeURIComponent(req.headers['x-filename'] || ''), 200), w, h, buf.length, isLowRes(w, h)]);
        return res.json({ ok: true, photo: p });
      }
      case 'photo-register': { // after a direct-to-Blob upload
        const s = await ownShoot(body.shootId); if (!s) return fail(res, 404, 'Shoot not found');
        if (!/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(body.url || '')) return fail(res, 400, 'Invalid file');
        const w = parseInt(body.width, 10) || null, h = parseInt(body.height, 10) || null;
        const pos = (await one('SELECT coalesce(max(position),0)+1 AS p FROM photos WHERE shoot_id=$1', [s.id])).p;
        const p = await one('INSERT INTO photos (order_id, shoot_id, position, url, filename, width, height, bytes, low_res) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [order.id, s.id, pos, body.url, clip(body.filename, 200), w, h, parseInt(body.bytes, 10) || null, isLowRes(w, h)]);
        return res.json({ ok: true, photo: p });
      }
      case 'photo-delete': {
        const p = await one('SELECT * FROM photos WHERE id=$1 AND order_id=$2', [parseInt(body.id, 10), order.id]); if (!p) return fail(res, 404, 'Photo not found');
        await q('DELETE FROM photos WHERE id=$1', [p.id]); await removePublic(p.url); return res.json({ ok: true });
      }
      case 'photo-cover': {
        const p = await one('SELECT id FROM photos WHERE id=$1 AND order_id=$2', [parseInt(body.id, 10), order.id]); if (!p) return fail(res, 404, 'Photo not found');
        await q(`UPDATE photos SET role=NULL WHERE order_id=$1 AND role='cover'`, [order.id]);
        await q(`UPDATE photos SET role='cover' WHERE id=$1`, [p.id]); return res.json({ ok: true });
      }
      case 'photo-move': {
        const ids = (body.order || []).map(n => parseInt(n, 10));
        for (let i = 0; i < ids.length; i++) await q('UPDATE photos SET position=$1 WHERE id=$2 AND order_id=$3', [i + 1, ids[i], order.id]);
        return res.json({ ok: true });
      }
      case 'submit': {
        const n = (await one('SELECT count(*)::int AS n FROM photos WHERE order_id=$1', [order.id])).n;
        if (!n) return fail(res, 400, 'Add at least one photo first');
        await q(`UPDATE orders SET submitted_at=now(), status = CASE WHEN status IN ('new','collecting','changes') THEN 'layout' ELSE status END, updated_at=now() WHERE id=$1`, [order.id]);
        await logEvent(order.id, 'customer', `Photos submitted for layout (${n} photos)`);
        await sendMail({ to: adminInbox(), subject: `[BOOKD] ${order.ref} — photos submitted for layout`, text: `${order.customer_name} sent ${n} photos for layout.\n\nOpen the admin: ${siteUrl(req)}/admin/#order/${order.id}` });
        return res.json({ ok: true });
      }
      case 'proof-comment': {
        const p = await one(`SELECT * FROM proofs WHERE id=$1 AND order_id=$2 AND status='sent'`, [parseInt(body.proofId, 10), order.id]);
        if (!p) return fail(res, 400, 'This proof is no longer open for comments');
        if (!clip(body.body)) return fail(res, 400, 'Write a comment first');
        await q('INSERT INTO proof_comments (proof_id, page, body, author) VALUES ($1,$2,$3,$4)', [p.id, parseInt(body.page, 10) || null, clip(body.body, 1500), order.customer_name || 'Customer']);
        return res.json({ ok: true });
      }
      case 'proof-decide': {
        const p = await one(`SELECT * FROM proofs WHERE id=$1 AND order_id=$2 AND status='sent'`, [parseInt(body.proofId, 10), order.id]);
        if (!p) return fail(res, 400, 'This proof is no longer open');
        const approve = body.decision === 'approve';
        if (approve && !body.acceptFlagged) return fail(res, 400, 'Please confirm the flagged photos');
        await q(`UPDATE proofs SET status=$1, decided_at=now() WHERE id=$2`, [approve ? 'approved' : 'changes', p.id]);
        await q(`UPDATE orders SET status=$1, updated_at=now() WHERE id=$2`, [approve ? 'approved' : 'changes', order.id]);
        if (clip(body.note)) await q('INSERT INTO proof_comments (proof_id, page, body, author) VALUES ($1,NULL,$2,$3)', [p.id, clip(body.note, 1500), order.customer_name || 'Customer']);
        await logEvent(order.id, 'customer', approve ? `Proof v${p.version} APPROVED (flagged photos accepted as is)` : `Changes requested on proof v${p.version}`);
        await sendMail({ to: adminInbox(), subject: `[BOOKD] ${order.ref} — proof v${p.version} ${approve ? 'APPROVED' : 'changes requested'}`,
          text: `${order.customer_name} ${approve ? 'approved' : 'requested changes on'} proof v${p.version}.${body.note ? `\n\nNote: ${body.note}` : ''}\n\nOpen the admin: ${siteUrl(req)}/admin/#order/${order.id}` });
        return res.json({ ok: true });
      }
      default: return fail(res, 404, 'Unknown action');
    }
  });
}
