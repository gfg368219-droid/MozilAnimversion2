import { ReplitConnectors } from '@replit/connectors-sdk';

const supabaseUrl = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');

export async function supabaseRequest(pathname, init = {}) {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const headers = { ...(init.headers || {}) };

  if (url && key) {
    headers.apikey = key;
    headers.Authorization = `Bearer ${key}`;
    return fetch(`${url}${pathname}`, { ...init, headers });
  }

  if (process.env.REPLIT_CONNECTORS_HOSTNAME || process.env.REPLIT_IDENTITY || process.env.WEB_REPL_RENEWAL) {
    const connectors = new ReplitConnectors();
    return connectors.proxy('supabase', pathname, { ...init, headers });
  }

  throw new Error('Supabase non configuré. Ajoutez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sur cet hébergeur.');
}

export async function readSupabaseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function supabaseError(response, payload) {
  const message = typeof payload === 'string' ? payload : payload?.message || payload?.hint;
  return new Error(`Supabase ${response.status}: ${message || 'réponse inattendue'}`);
}
