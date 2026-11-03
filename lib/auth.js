// lib/auth.js — admin login with JWT (pattern from the SaaS starter kit)
import jwt from 'jsonwebtoken';
import { one } from './db.js';
const SECRET = () => process.env.JWT_SECRET || (process.env.LOCAL_PG ? 'local-dev-secret' : null);
export function sign(admin) {
  if (!SECRET()) throw new Error('JWT_SECRET missing');
  return jwt.sign({ id: admin.id, email: admin.email }, SECRET(), { expiresIn: '7d' });
}
export async function requireAdmin(req, res) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  let d = null;
  try { d = tok && SECRET() ? jwt.verify(tok, SECRET()) : null; } catch { d = null; }
  if (!d) { res.status(401).json({ ok: false, error: 'Login required' }); return null; }
  const a = await one('SELECT id, email, name FROM admins WHERE id=$1', [d.id]);
  if (!a) { res.status(401).json({ ok: false, error: 'Login required' }); return null; }
  return a;
}
