import { handleUpload } from './upload-api.js';
import {
  listUsers,
  loadState,
  loginUser,
  privateState,
  registerUser,
  savePrivateState,
  sessionUser
} from './persistence.js';

const json = (response, status, payload) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
};

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function errorStatus(error) {
  return /Supabase 404|schema cache|non configuré/i.test(error.message) ? 503 : 400;
}

export function createApiHandler() {
  return async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/uploads')) return handleUpload(request, response, pathname);
    if (!pathname.startsWith('/api/')) return false;

    try {
      if (request.method === 'GET' && pathname === '/api/state') {
        const state = await loadState();
        return json(response, 200, { anime: state.anime, stats: state.stats });
      }
      if (request.method === 'GET' && pathname === '/api/private-state') {
        const user = await sessionUser(request);
        if (!user) return json(response, 401, { error: 'Connexion requise.' });
        return json(response, 200, await privateState());
      }
      if (request.method === 'GET' && pathname === '/api/auth/session') {
        return json(response, 200, { user: await sessionUser(request) });
      }
      if (request.method === 'POST' && pathname === '/api/auth/register') {
        return json(response, 201, await registerUser(await body(request)));
      }
      if (request.method === 'POST' && pathname === '/api/auth/login') {
        return json(response, 200, await loginUser(await body(request)));
      }
      if (request.method === 'POST' && pathname === '/api/auth/logout') return json(response, 200, { ok: true });
      if (request.method === 'PUT' && pathname === '/api/state') {
        const user = await sessionUser(request);
        if (!user) return json(response, 401, { error: 'Connexion requise.' });
        return json(response, 200, await savePrivateState(await body(request)));
      }
      if (request.method === 'GET' && pathname === '/api/users') {
        const user = await sessionUser(request);
        if (!user || user.role !== 'admin') return json(response, 403, { error: 'Accès administrateur requis.' });
        return json(response, 200, { users: await listUsers() });
      }
      return json(response, 404, { error: 'Route API introuvable.' });
    } catch (error) {
      console.error('[api]', error);
      return json(response, errorStatus(error), { error: error.message || 'Erreur serveur.' });
    }
  };
}

export function apiPlugin() {
  const attach = (server) => {
    const handler = createApiHandler();
    server.middlewares.use(async (request, response, next) => {
      try {
        if (!await handler(request, response)) next();
      } catch (error) {
        console.error('[api]', error);
        if (!response.headersSent) json(response, 500, { error: error.message || 'Erreur serveur.' });
      }
    });
  };
  return {
    name: 'mozilanim-api',
    configureServer: attach,
    configurePreviewServer: attach
  };
}
