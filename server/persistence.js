import crypto from 'node:crypto';
import { readSupabaseJson, supabaseError, supabaseRequest } from './supabase.js';

const STATE_ID = 'main';
const SESSION_DAYS = 365;

const emptyState = () => ({ anime: [], applications: [], stats: {}, users: [] });
const publicUser = (user) => user && ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.created_at || user.createdAt || Date.now()
});

function normalizeState(row) {
  return {
    anime: Array.isArray(row?.anime) ? row.anime : [],
    applications: Array.isArray(row?.applications) ? row.applications : [],
    stats: row?.stats && typeof row.stats === 'object' ? row.stats : {},
    users: Array.isArray(row?.users) ? row.users : []
  };
}

async function ensureOk(response) {
  const payload = await readSupabaseJson(response);
  if (!response.ok) throw supabaseError(response, payload);
  return payload;
}

export async function loadState() {
  const query = `/rest/v1/mozilanim_state?id=eq.${encodeURIComponent(STATE_ID)}&select=anime,applications,stats,users`;
  const response = await supabaseRequest(query);
  const rows = await ensureOk(response);
  return normalizeState(rows?.[0] || emptyState());
}

export async function saveState(input) {
  const state = normalizeState(input);
  const response = await supabaseRequest('/rest/v1/mozilanim_state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      id: STATE_ID,
      anime: state.anime,
      applications: state.applications,
      stats: state.stats,
      users: state.users,
      updated_at: new Date().toISOString()
    })
  });
  await ensureOk(response);
  return state;
}

export async function listUsers() {
  const response = await supabaseRequest('/rest/v1/mozilanim_users?select=id,name,email,role,created_at&order=created_at.asc');
  const rows = await ensureOk(response);
  return (Array.isArray(rows) ? rows : []).map(publicUser);
}

async function findUser(email) {
  const query = `/rest/v1/mozilanim_users?email=eq.${encodeURIComponent(email)}&select=id,name,email,password_hash,role,created_at&limit=1`;
  const response = await supabaseRequest(query);
  const rows = await ensureOk(response);
  return rows?.[0] || null;
}

async function insertUser(user) {
  const response = await supabaseRequest('/rest/v1/mozilanim_users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(user)
  });
  const rows = await ensureOk(response);
  return rows?.[0] || user;
}

export async function updateUserRole(userId, role) {
  const response = await supabaseRequest(`/rest/v1/mozilanim_users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ role })
  });
  await ensureOk(response);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, stored) {
  const [salt, digest] = String(stored || '').split(':');
  if (!salt || !digest) return false;
  const candidate = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(candidate.split(':')[1], 'hex'), Buffer.from(digest, 'hex'));
}

function adminCredentials() {
  return {
    email: String(process.env.MOZILANIM_ADMIN_EMAIL || 'ysoeok@gmail.com').trim().toLowerCase(),
    password: String(process.env.MOZILANIM_ADMIN_PASSWORD || '#Real2012mvogo')
  };
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const response = await supabaseRequest('/rest/v1/mozilanim_sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ token_hash: tokenHash, user_id: user.id, role: user.role, expires_at: expiresAt })
  });
  await ensureOk(response);
  return { token, expiresAt };
}

export async function registerUser({ name, email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!name?.trim() || !normalizedEmail || String(password || '').length < 6) {
    throw new Error('Nom, email et mot de passe valide requis.');
  }
  if (normalizedEmail === adminCredentials().email) throw new Error('Cet email est réservé à l’administration.');
  if (await findUser(normalizedEmail)) throw new Error('Un compte existe déjà avec cet email.');
  const user = await insertUser({
    id: `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    name: name.trim(),
    email: normalizedEmail,
    password_hash: await hashPassword(password),
    role: 'user'
  });
  const session = await createSession(user);
  return { user: publicUser(user), ...session };
}

export async function loginUser({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const admin = adminCredentials();
  if (normalizedEmail === admin.email && password === admin.password) {
    const user = { id: 'admin', name: 'Administrateur', email: admin.email, role: 'admin' };
    const session = await createSession(user);
    return { user, ...session };
  }
  const user = await findUser(normalizedEmail);
  if (!user || !(await verifyPassword(password, user.password_hash))) throw new Error('Email ou mot de passe incorrect.');
  const session = await createSession(user);
  return { user: publicUser(user), ...session };
}

function tokenFromRequest(request) {
  const header = String(request.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export async function sessionUser(request) {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const query = `/rest/v1/mozilanim_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=token_hash,user_id,role,expires_at&limit=1`;
  const response = await supabaseRequest(query);
  const rows = await ensureOk(response);
  const session = rows?.[0];
  if (!session) return null;
  if (session.role === 'admin') return { id: 'admin', name: 'Administrateur', email: adminCredentials().email, role: 'admin' };
  const user = await findUserById(session.user_id);
  return user ? publicUser(user) : null;
}

async function findUserById(id) {
  const query = `/rest/v1/mozilanim_users?id=eq.${encodeURIComponent(id)}&select=id,name,email,role,created_at&limit=1`;
  const response = await supabaseRequest(query);
  const rows = await ensureOk(response);
  return rows?.[0] || null;
}

export async function privateState() {
  const state = await loadState();
  state.users = await listUsers();
  return state;
}

export async function savePrivateState(state) {
  const saved = await saveState(state);
  if (Array.isArray(state.users)) {
    for (const user of state.users) {
      if (user?.id && ['user', 'studio-maker', 'admin'].includes(user.role)) {
        await updateUserRole(user.id, user.role);
      }
    }
    saved.users = await listUsers();
  }
  return saved;
}

export async function createUploadRecord(record) {
  const response = await supabaseRequest('/rest/v1/mozilanim_uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(record)
  });
  const rows = await ensureOk(response);
  return rows?.[0] || record;
}

export async function getUploadRecord(id) {
  const response = await supabaseRequest(`/rest/v1/mozilanim_uploads?id=eq.${encodeURIComponent(id)}&select=id,name,mime_type,size,storage_path&limit=1`);
  const rows = await ensureOk(response);
  return rows?.[0] || null;
}
