import crypto from 'node:crypto';

const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'ysoeok@gmail.com').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '#Real2012mvogo';

function secretOrThrow() {
  if (!SESSION_SECRET) throw new Error('SESSION_SECRET est requis pour les sessions administrateur.');
  return SESSION_SECRET;
}

export function createAdminToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secretOrThrow()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function isAdminRequest(request) {
  const token = request.headers['x-mozilanim-admin'] || request.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return false;
  try {
    const expected = crypto.createHmac('sha256', secretOrThrow()).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.email === ADMIN_EMAIL && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

export function checkAdminCredentials(email, password) {
  return String(email || '').trim().toLowerCase() === ADMIN_EMAIL && String(password || '') === ADMIN_PASSWORD;
}