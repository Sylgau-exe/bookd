// lib/lulu.js — Lulu Print API (https://api.lulu.com/docs/). Sandbox or production, chosen by LULU_ENV.
// Env: LULU_CLIENT_KEY, LULU_CLIENT_SECRET, LULU_ENV ('sandbox' | 'production'), LULU_CONTACT_EMAIL
export const TRIM = { w: 8.5, h: 11 };              // US Letter, inches
export const BLEED = 0.125;                          // inches, each side
// Photo book, US Letter, premium colour, 80# white coated, glossy cover
export const POD = { soft: '0850X1100FCPREPB080CW444GXX', hard: '0850X1100FCPRECW080CW444GXX' };
export const MIN_PAGES = { soft: 32, hard: 24 };
export const SHIPPING_LEVELS = ['MAIL', 'PRIORITY_MAIL', 'GROUND', 'EXPEDITED', 'EXPRESS'];

export const luluEnv = () => (process.env.LULU_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
export const hasLulu = () => !!(process.env.LULU_CLIENT_KEY && process.env.LULU_CLIENT_SECRET);
const base = () => process.env.LULU_API_BASE || (luluEnv() === 'production' ? 'https://api.lulu.com' : 'https://api.sandbox.lulu.com');

let tok = null, tokUntil = 0;
async function token() {
  if (!hasLulu()) throw Object.assign(new Error('Lulu keys missing: add LULU_CLIENT_KEY and LULU_CLIENT_SECRET in Vercel'), { code: 'NO_LULU' });
  if (tok && Date.now() < tokUntil) return tok;
  const basic = Buffer.from(`${process.env.LULU_CLIENT_KEY.trim()}:${process.env.LULU_CLIENT_SECRET.trim()}`).toString('base64');
  const r = await fetch(`${base()}/auth/realms/glasstree/protocol/openid-connect/token`, {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error(`Lulu sign-in failed (${r.status}) — check the keys and LULU_ENV (${luluEnv()})`), { code: 'LULU' });
  tok = j.access_token; tokUntil = Date.now() + Math.max(30, (j.expires_in || 300) - 60) * 1000;
  return tok;
}
async function call(method, path, body) {
  const r = await fetch(base() + path, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok) throw Object.assign(new Error(`Lulu ${method} ${path} → ${r.status}: ${errText(j)}`), { code: 'LULU', status: r.status, detail: j });
  return j;
}
function errText(j) {
  if (!j || typeof j !== 'object') return String(j);
  const flat = []; const walk = (v, k) => { if (v == null) return; if (typeof v === 'string') flat.push(k ? `${k}: ${v}` : v); else if (Array.isArray(v)) v.forEach(x => walk(x, k)); else if (typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => walk(vv, k ? `${k}.${kk}` : kk)); };
  walk(j); return flat.slice(0, 6).join(' · ').slice(0, 500) || 'error';
}

export const podFor = (cover) => POD[cover === 'hard' ? 'hard' : 'soft'];

// Cover size in points. Uses the API when keys are set; otherwise Lulu's published rules (close enough for proofs).
export async function coverDimensions(cover, pages) {
  if (hasLulu()) {
    try { const j = await call('POST', '/cover-dimensions/', { pod_package_id: podFor(cover), interior_page_count: pages, unit: 'pt' }); return { width: +j.width, height: +j.height, source: 'lulu' }; }
    catch (e) { console.error('cover-dimensions', e.message); }
  }
  const pt = 72;
  if (cover === 'hard') { // case wrap: 0.875 in wrap/hinge around the board; spine 0.25 in up to 84 pages
    const spine = pages <= 84 ? 0.25 : Math.round((pages * 0.0025 + 0.06) * 1000) / 1000;
    return { width: (2 * (TRIM.w + 0.875) + spine) * pt, height: (TRIM.h + 2 * 0.875) * pt, source: 'estimate' };
  }
  const spine = Math.round((pages * 0.00225 + 0.06) * 1000) / 1000; // perfect bound, 80# coated (32 pp → 0.132 in)
  return { width: (2 * (TRIM.w + BLEED) + spine) * pt, height: (TRIM.h + 2 * BLEED) * pt, source: 'estimate' };
}

// ---------- addresses ----------
const EXTRA_NAMES = { 'usa': 'US', 'us': 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states of america': 'US', 'états-unis': 'US', 'etats-unis': 'US', 'uk': 'GB', 'england': 'GB', 'angleterre': 'GB', 'great britain': 'GB' };
let names = null;
export function countryCode(v) {
  const s = String(v || '').trim(); if (!s) return '';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  if (!names) {
    names = { ...EXTRA_NAMES };
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', OLD = new Set(['DD', 'FX', 'YU', 'CS', 'SU', 'ZR', 'TP', 'BU', 'NT', 'AN', 'QO', 'EU', 'EZ', 'UN', 'ZZ', 'XA', 'XB']);
    for (const lang of ['en', 'fr', 'es', 'pt', 'it']) {
      let dn; try { dn = new Intl.DisplayNames([lang], { type: 'region' }); } catch { continue; }
      for (const a of A) for (const b of A) { const c = a + b; if (OLD.has(c)) continue; let n; try { n = dn.of(c); } catch { continue; } if (n && n !== c) names[n.toLowerCase()] = names[n.toLowerCase()] || c; }
    }
  }
  const k = s.toLowerCase();
  return names[k] || names[k.normalize('NFD').replace(/[̀-ͯ]/g, '')] || '';
}
const REGIONS = {
  CA: { 'alberta': 'AB', 'british columbia': 'BC', 'colombie-britannique': 'BC', 'manitoba': 'MB', 'new brunswick': 'NB', 'nouveau-brunswick': 'NB', 'newfoundland and labrador': 'NL', 'terre-neuve-et-labrador': 'NL',
    'nova scotia': 'NS', 'nouvelle-écosse': 'NS', 'ontario': 'ON', 'prince edward island': 'PE', 'île-du-prince-édouard': 'PE', 'quebec': 'QC', 'québec': 'QC', 'saskatchewan': 'SK',
    'northwest territories': 'NT', 'territoires du nord-ouest': 'NT', 'nunavut': 'NU', 'yukon': 'YT' },
  US: Object.fromEntries('AL Alabama,AK Alaska,AZ Arizona,AR Arkansas,CA California,CO Colorado,CT Connecticut,DE Delaware,DC District of Columbia,FL Florida,GA Georgia,HI Hawaii,ID Idaho,IL Illinois,IN Indiana,IA Iowa,KS Kansas,KY Kentucky,LA Louisiana,ME Maine,MD Maryland,MA Massachusetts,MI Michigan,MN Minnesota,MS Mississippi,MO Missouri,MT Montana,NE Nebraska,NV Nevada,NH New Hampshire,NJ New Jersey,NM New Mexico,NY New York,NC North Carolina,ND North Dakota,OH Ohio,OK Oklahoma,OR Oregon,PA Pennsylvania,RI Rhode Island,SC South Carolina,SD South Dakota,TN Tennessee,TX Texas,UT Utah,VT Vermont,VA Virginia,WA Washington,WV West Virginia,WI Wisconsin,WY Wyoming'.split(',').map(x => [x.slice(3).toLowerCase(), x.slice(0, 2)])),
  AU: { 'new south wales': 'NSW', 'victoria': 'VIC', 'queensland': 'QLD', 'western australia': 'WA', 'south australia': 'SA', 'tasmania': 'TAS', 'australian capital territory': 'ACT', 'northern territory': 'NT' },
};
export function regionCode(country, v) {
  const s = String(v || '').trim(); if (!s) return '';
  const map = REGIONS[country]; if (!map) return s;
  if (Object.values(map).includes(s.toUpperCase())) return s.toUpperCase();
  return map[s.toLowerCase()] || s;
}
// Lulu address from an order. Returns { address, problems[] }
// v1.30 — Lulu allows 30 characters per address line: split a long street address over street1 + street2,
// breaking at a comma or a space (e.g. "1234 avenue Van Horne, app. 5" stays readable). A line break typed by the customer is respected.
export function splitStreet(raw) {
  const s = String(raw || '').replace(/\s+\n/g, '\n').trim();
  const lines = s.split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let one = lines[0] || '', rest = lines.slice(1).join(', ');
  if (one.length > 30) {
    const cut = Math.max(one.lastIndexOf(',', 30), one.lastIndexOf(' ', 30));
    const at = cut > 0 ? cut : 30;
    rest = [one.slice(at).replace(/^[,\s]+/, ''), rest].filter(Boolean).join(', ');
    one = one.slice(0, at).replace(/[,\s]+$/, '');
  }
  return [one, rest];
}
export function addressFor(o) {
  const country_code = countryCode(o.ship_country);
  const [street1, street2] = splitStreet(o.ship_address);
  const address = { name: (o.ship_name || o.customer_name || '').trim(), street1, ...(street2 ? { street2 } : {}), city: (o.ship_city || '').trim(),
    state_code: regionCode(country_code, o.ship_region), postcode: (o.ship_postal || '').trim(), country_code, phone_number: (o.phone || '').trim(), email: (o.customer_email || '').trim() || process.env.LULU_CONTACT_EMAIL || process.env.CONTACT_TO || 'sgauthier@executiveproducer.ca' };
  const problems = [];
  if (!address.name) problems.push('name'); if (!address.street1) problems.push('street address'); if (!address.city) problems.push('city');
  if (!country_code) problems.push(`country (“${o.ship_country || ''}” not recognised — use a country name or 2-letter code)`);
  if (['US', 'CA', 'AU'].includes(country_code) && !address.state_code) problems.push('state / province');
  if (!address.postcode && !['HK', 'AE', 'IE'].includes(country_code)) problems.push('postal code');
  if (!address.phone_number) problems.push('phone (required by the courier)');
  if ((street2 || '').length > 30) problems.push('street address too long for Lulu (2 lines of 30 characters max) — shorten it in Order details');
  return { address, problems };
}

// ---------- API ----------
export async function quote({ cover, pages, quantity, address, level = 'MAIL' }) {
  const j = await call('POST', '/print-job-cost-calculations/', { line_items: [{ page_count: pages, pod_package_id: podFor(cover), quantity }], shipping_address: address, shipping_option: level });
  return { currency: j.currency, total: +j.total_cost_incl_tax, totalExclTax: +j.total_cost_excl_tax, shipping: +(j.shipping_cost?.total_cost_excl_tax ?? 0),
    fulfillment: +(j.fulfillment_cost?.total_cost_excl_tax ?? 0), books: (j.line_item_costs || []).reduce((s, l) => s + +(l.total_cost_excl_tax || 0), 0), tax: +(j.total_tax || 0) };
}
export async function shippingOptions({ cover, pages, quantity, address }) {
  return call('POST', '/shipping-options/', { line_items: [{ page_count: pages, pod_package_id: podFor(cover), quantity }], shipping_address: address });
}
export async function createJob({ ref, title, cover, quantity, interiorUrl, coverUrl, address, level = 'MAIL' }) {
  return call('POST', '/print-jobs/', {
    contact_email: process.env.LULU_CONTACT_EMAIL || process.env.CONTACT_TO || 'sgauthier@executiveproducer.ca', external_id: ref,
    // Lulu wants pod_package_id INSIDE printable_normalization (see the API's "Example Book")
    line_items: [{ external_id: ref, title: String(title || ref).slice(0, 255), quantity,
      printable_normalization: { pod_package_id: podFor(cover), cover: { source_url: coverUrl }, interior: { source_url: interiorUrl } } }],
    shipping_address: address, shipping_level: level });
}
export const getJob = (id) => call('GET', `/print-jobs/${encodeURIComponent(id)}/`);
// Why Lulu rejected a job: the reasons live on each line item (file errors, page size, fonts...).
export function problemsOf(job) {
  const out = [];
  const walk = (v) => { if (v == null) return; if (typeof v === 'string') { if (v.trim()) out.push(v.trim()); } else if (Array.isArray(v)) v.forEach(walk); else if (typeof v === 'object') Object.values(v).forEach(walk); };
  for (const li of job.line_items || []) {
    const m = li.status?.messages; if (m && !m.tracking_id && !m.tracking_urls) walk(m);
    for (const part of ['cover', 'interior']) { const p = li.printable_normalization?.[part]; if (p?.job_id && p?.status && /ERROR|FAIL|REJECT/i.test(JSON.stringify(p.status))) walk(p.status); }
    const pid = li.printable_id; if (li.status?.name === 'REJECTED' && pid && !out.length) out.push(`printable ${pid} rejected`);
  }
  return [...new Set(out)].join(' | ');
}
export const cancelJob = (id) => call('PUT', `/print-jobs/${encodeURIComponent(id)}/status/`, { name: 'CANCELED' });
export function trackingOf(job) {
  const out = [];
  for (const li of job?.line_items || []) {
    const t = li.tracking_id || li.status?.messages?.tracking_id; const urls = li.tracking_urls || li.status?.messages?.tracking_urls || [];
    if (t || urls.length) out.push({ id: t || '', url: urls[0] || '', carrier: li.carrier_name || li.status?.messages?.carrier_name || '' });
  }
  return out;
}
