// lib/assistant.js — BOOKD Assistant (v1.31): Claude + READ-ONLY tools on BOOKD orders and Lulu.
// Env: ANTHROPIC_API_KEY (required), BOOKD_ASSISTANT_MODEL (default claude-sonnet-5-5).
import { q, one } from './db.js';
import { GUIDE } from './assistant-guide.js';
import { PACKAGES, coverOf, coverLabel, isTooSmall } from './pricing.js';
import { balanceDue } from './orders.js';
import * as lulu from './lulu.js';

export const hasAssistant = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.BOOKD_ASSISTANT_MODEL || 'claude-sonnet-5-5';

async function findOrder(ref) {
  const s = String(ref ?? '').trim();
  if (/^\d+$/.test(s)) return one('SELECT * FROM orders WHERE id=$1', [parseInt(s, 10)]);
  const m = s.toUpperCase().match(/BK-?(\d+)/); if (m) return one('SELECT * FROM orders WHERE ref=$1', ['BK-' + m[1]]);
  return null;
}
const parse = (x) => (typeof x === 'string' ? JSON.parse(x) : x) || {};

async function orderSummary(o) {
  const shoots = await q('SELECT id, position, kind, title, credits, story, credit_image FROM shoots WHERE order_id=$1 ORDER BY position, id', [o.id]);
  const photos = await q('SELECT id, shoot_id, width, height, role, keep FROM photos WHERE order_id=$1', [o.id]);
  const proofs = await q('SELECT version, status, page_count, layout, sent_at, decided_at, created_at FROM proofs WHERE order_id=$1 ORDER BY version DESC LIMIT 5', [o.id]);
  const events = await q('SELECT actor, text, created_at FROM events WHERE order_id=$1 ORDER BY created_at DESC LIMIT 20', [o.id]);
  const family = await q('SELECT id, ref, status, cover, package, copies, origin, parent_id FROM orders WHERE id<>$1 AND (parent_id=$1 OR id=$2 OR (parent_id=$2 AND $2 IS NOT NULL))', [o.id, o.parent_id]);
  const { address, problems } = lulu.addressFor(o);
  return {
    ref: o.ref, id: o.id, status: o.status, customer: o.customer_name, email_on_file: !!o.customer_email,
    package: PACKAGES[o.package]?.label || o.package, cover: coverLabel(coverOf(o)), copies: o.copies,
    price_usd: Number(o.price_usd || 0), shipping_usd: o.shipping_usd == null ? null : Number(o.shipping_usd),
    discount: o.discount_pct ? `${o.discount_pct}% (code ${o.discount_code})` : 'none',
    deposit_paid: !!o.deposit_paid, balance_paid: !!o.balance_paid, paid_usd: Number(o.paid_usd || 0), balance_due_usd: balanceDue(o),
    submitted_for_layout: !!o.submitted_at, design: { template: o.template, photo_style: o.photo_style },
    shipping_address_for_lulu: address, address_problems: problems,
    shoots: shoots.map(s => ({ position: s.position, type: s.kind, title: s.title, credits: (s.credits || []).filter(c => c?.value).map(c => `${c.label}: ${c.value}`),
      has_story: !!s.story, has_credit_image: !!s.credit_image, photos: photos.filter(p => p.shoot_id === s.id).length })),
    photos: { total: photos.length, too_small: photos.filter(p => isTooSmall(p.width, p.height)).length, cover_chosen: photos.some(p => p.role === 'cover') },
    proofs: proofs.map(p => { const L = parse(p.layout); return { version: p.version, status: p.status, pages: p.page_count, built_for_cover: L.binding === 'hard' ? 'Hardcover' : 'Softcover', warnings: L.warnings || [] }; }),
    lulu: o.printer_order_id ? { job: o.printer_order_id, status: o.printer_status, env: o.printer_env, cost: o.printer_cost, shipping_level: o.ship_level, tracking: o.tracking, promo_checked: !!o.lulu_promo_checked_at, promo: o.lulu_promo } : null,
    related_orders: family.map(f => ({ ref: f.ref, status: f.status, cover: coverLabel(coverOf(f)), copies: f.copies, relation: f.id === o.parent_id ? 'original' : (f.origin || 'copy') })),
    timeline_latest_first: events.map(e => `${new Date(e.created_at).toISOString().slice(0, 16).replace('T', ' ')} ${e.actor}: ${e.text}`),
  };
}

const TOOLS = [
  { name: 'list_orders', description: 'List BOOKD orders (most recently updated first) with ref, status, customer, package, cover, copies, payments.',
    input_schema: { type: 'object', properties: { status: { type: 'string', description: 'optional status key: new, collecting, layout, proof_sent, changes, approved, paid, printing, shipped, delivered, cancelled' } } } },
  { name: 'get_order', description: 'Full read-only picture of one order: status, payments, address as sent to Lulu (+ problems), shoots, photos, proofs with warnings, Lulu job, related orders, timeline.',
    input_schema: { type: 'object', properties: { ref: { type: 'string', description: 'Order ref like BK-1005, or the numeric id' } }, required: ['ref'] } },
  { name: 'lulu_price', description: 'Ask Lulu (no charge, nothing created) the price to print the approved proof of an order: books + shipping + fee + tax, for a shipping level.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, level: { type: 'string', enum: ['MAIL', 'PRIORITY_MAIL', 'GROUND', 'EXPEDITED', 'EXPRESS'] } }, required: ['ref'] } },
  { name: 'lulu_job_status', description: 'Read the live status of the Lulu print job of an order directly from Lulu (status, message, rejection reasons, tracking). Read-only.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } },
];

async function runTool(name, input) {
  try {
    if (name === 'list_orders') {
      const st = input?.status; const rows = await q(`SELECT ref, status, customer_name, package, cover, copies, price_usd, deposit_paid, balance_paid, printer_status, updated_at FROM orders ${st ? 'WHERE status=$1' : ''} ORDER BY updated_at DESC LIMIT 40`, st ? [st] : []);
      return rows.map(r => ({ ref: r.ref, status: r.status, customer: r.customer_name, package: PACKAGES[r.package]?.label, cover: coverLabel(coverOf(r)), copies: r.copies, price_usd: Number(r.price_usd || 0), deposit_paid: r.deposit_paid, balance_paid: r.balance_paid, lulu: r.printer_status, updated: r.updated_at }));
    }
    const o = await findOrder(input?.ref); if (!o) return { error: `No order found for "${input?.ref}"` };
    if (name === 'get_order') return orderSummary(o);
    if (name === 'lulu_price') {
      if (!lulu.hasLulu()) return { error: 'Lulu is not connected (Vercel keys missing).' };
      const p = await one(`SELECT * FROM proofs WHERE order_id=$1 AND status='approved' ORDER BY version DESC LIMIT 1`, [o.id]);
      if (!p) return { error: 'No approved proof yet: Lulu needs the final page count.' };
      const { address, problems } = lulu.addressFor(o); if (problems.length) return { error: 'Address incomplete for Lulu: ' + problems.join(', ') };
      const qt = await lulu.quote({ cover: coverOf(o), pages: p.page_count, quantity: o.copies || 1, address, level: input.level || o.ship_level || 'MAIL' });
      return { env: lulu.luluEnv(), cover: coverLabel(coverOf(o)), pages: p.page_count, copies: o.copies || 1, level: input.level || o.ship_level || 'MAIL', ...qt };
    }
    if (name === 'lulu_job_status') {
      if (!o.printer_order_id) return { error: 'This order has not been sent to Lulu yet.' };
      if ((o.printer_env || 'sandbox') !== lulu.luluEnv()) return { error: `Job was created in Lulu ${o.printer_env}; the site is now on ${lulu.luluEnv()}.` };
      const job = await lulu.getJob(o.printer_order_id);
      return { job: o.printer_order_id, status: job.status?.name, message: job.status?.message, problems: lulu.problemsOf(job) || null, tracking: lulu.trackingOf(job), status_saved_in_bookd: o.printer_status };
    }
    return { error: 'Unknown tool' };
  } catch (e) { return { error: e.message }; }
}

async function callClaude(body) {
  const r = await fetch((process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com') + '/v1/messages', { method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Assistant unavailable (${r.status}): ${j.error?.message || 'error'}`), { status: 502 });
  return j;
}

// messages: [{role:'user'|'assistant', content:'text'}] from the admin chat. Returns { reply, toolsUsed }.
export async function runAssistant({ messages, orderRef, adminName }) {
  if (!hasAssistant()) throw Object.assign(new Error('The assistant is not set up yet: add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy.'), { status: 400 });
  const clean = (messages || []).filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
    .slice(-16).map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
  if (!clean.length || clean.at(-1).role !== 'user') throw Object.assign(new Error('Ask a question first.'), { status: 400 });
  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
  const system = [
    { type: 'text', text: GUIDE, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Today: ${now} (Montreal time). Signed-in admin: ${adminName || 'admin'}. ${orderRef ? `The admin is looking at order ${orderRef} right now: "this order" means ${orderRef} — call get_order before answering about it.` : 'The admin is on the orders list.'}` },
  ];
  const convo = [...clean], toolsUsed = [];
  for (let i = 0; i < 6; i++) {
    const res = await callClaude({ model: MODEL(), max_tokens: 1200, system, tools: TOOLS, messages: convo });
    if (res.stop_reason !== 'tool_use') return { reply: (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim(), toolsUsed };
    convo.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const c of res.content.filter(c => c.type === 'tool_use')) {
      toolsUsed.push(c.name + (c.input?.ref ? ' ' + c.input.ref : ''));
      results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(await runTool(c.name, c.input)).slice(0, 30000) });
    }
    convo.push({ role: 'user', content: results });
  }
  return { reply: 'Sorry, that took too many steps. Please ask in a simpler way, or name the order (e.g. BK-1005).', toolsUsed };
}
