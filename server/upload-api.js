import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createUploadRecord, getUploadRecord } from './persistence.js';
import { readSupabaseJson, supabaseError, supabaseRequest } from './supabase.js';
import { sessionUser } from './persistence.js';

const uploadDirectory = path.resolve(process.cwd(), 'uploads');
const safeId = (value) => /^[a-zA-Z0-9_-]+$/.test(value || '');
const pathsFor = (id) => ({
  part: path.join(uploadDirectory, `${id}.part`),
  file: path.join(uploadDirectory, id),
  meta: path.join(uploadDirectory, `${id}.json`)
});

const sendJson = (response, status, payload) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
};

const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const contentRangeStart = (request) => {
  const match = String(request.headers['content-range'] || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/);
  return match ? { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) } : null;
};

async function requireUser(request, response) {
  const user = await sessionUser(request);
  if (!user) {
    sendJson(response, 401, { error: 'Connexion requise pour gérer une vidéo.' });
    return null;
  }
  return user;
}

async function uploadToStorage(id, meta, filePath) {
  const storagePath = id;
  const file = await fsp.readFile(filePath);
  const storageResponse = await supabaseRequest(`/storage/v1/object/mozilanim-videos/${encodeURIComponent(storagePath)}`, {
    method: 'POST',
    headers: {
      'Content-Type': meta.type || 'video/mp4',
      'x-upsert': 'true'
    },
    body: file
  });
  const payload = await readSupabaseJson(storageResponse);
  if (!storageResponse.ok) throw supabaseError(storageResponse, payload);
  await createUploadRecord({
    id,
    name: meta.name || id,
    mime_type: meta.type || 'video/mp4',
    size: Number(meta.size),
    storage_path: storagePath
  });
  return `/api/uploads/${id}/file`;
}

export async function handleUpload(request, response, pathname) {
  if (!pathname.startsWith('/api/uploads')) return false;
  await fsp.mkdir(uploadDirectory, { recursive: true });
  const parts = pathname.split('/').filter(Boolean);

  if (request.method === 'POST' && parts.length === 3 && parts[1] === 'uploads' && parts[2] === 'init') {
    if (!await requireUser(request, response)) return true;
    const body = await readJson(request);
    const id = String(body.id || '');
    if (!safeId(id) || !Number.isFinite(body.size) || body.size < 1) {
      sendJson(response, 400, { error: 'Upload invalide.' });
      return true;
    }
    const paths = pathsFor(id);
    if (!fs.existsSync(paths.part) && !fs.existsSync(paths.file)) await fsp.writeFile(paths.part, '');
    await fsp.writeFile(paths.meta, JSON.stringify({ name: body.name || 'video', type: body.type || 'video/mp4', size: body.size }));
    sendJson(response, 200, { id, uploadedBytes: fs.existsSync(paths.part) ? (await fsp.stat(paths.part)).size : 0 });
    return true;
  }

  if (!safeId(parts[2])) {
    sendJson(response, 400, { error: 'Identifiant invalide.' });
    return true;
  }
  const id = parts[2];
  const paths = pathsFor(id);

  if (request.method === 'PATCH' && parts.length === 3) {
    if (!await requireUser(request, response)) return true;
    const range = contentRangeStart(request);
    if (!range) {
      sendJson(response, 400, { error: 'Content-Range manquant.' });
      return true;
    }
    const currentSize = fs.existsSync(paths.part) ? (await fsp.stat(paths.part)).size : 0;
    if (currentSize !== range.start) {
      sendJson(response, 409, { error: 'Décalage d’upload.', uploadedBytes: currentSize });
      return true;
    }
    await pipeline(request, fs.createWriteStream(paths.part, { flags: 'a' }));
    const uploadedBytes = (await fsp.stat(paths.part)).size;
    sendJson(response, 200, { id, uploadedBytes });
    return true;
  }

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'complete') {
    if (!await requireUser(request, response)) return true;
    const body = await readJson(request);
    if (!fs.existsSync(paths.part)) {
      sendJson(response, 404, { error: 'Upload introuvable.' });
      return true;
    }
    const size = (await fsp.stat(paths.part)).size;
    if (size !== Number(body.size)) {
      sendJson(response, 409, { error: 'Taille de fichier incomplète.', uploadedBytes: size });
      return true;
    }
    const meta = JSON.parse(await fsp.readFile(paths.meta, 'utf8'));
    const url = await uploadToStorage(id, meta, paths.part);
    await fsp.rm(paths.part, { force: true });
    await fsp.rm(paths.meta, { force: true });
    sendJson(response, 200, { id, url });
    return true;
  }

  if (request.method === 'GET' && parts.length === 4 && parts[3] === 'file') {
    const upload = await getUploadRecord(id);
    if (!upload) {
      sendJson(response, 404, { error: 'Vidéo introuvable.' });
      return true;
    }
    const range = request.headers.range;
    const storageResponse = await supabaseRequest(`/storage/v1/object/mozilanim-videos/${encodeURIComponent(upload.storage_path)}`, {
      headers: range ? { Range: range } : {}
    });
    if (!storageResponse.ok) {
      const payload = await readSupabaseJson(storageResponse);
      throw supabaseError(storageResponse, payload);
    }
    response.statusCode = storageResponse.status;
    response.setHeader('Content-Type', upload.mime_type || storageResponse.headers.get('content-type') || 'video/mp4');
    for (const header of ['content-length', 'content-range', 'accept-ranges']) {
      const value = storageResponse.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    if (storageResponse.body) return Readable.fromWeb(storageResponse.body).pipe(response);
    response.end(Buffer.from(await storageResponse.arrayBuffer()));
    return true;
  }

  sendJson(response, 404, { error: 'Route d’upload introuvable.' });
  return true;
}

export function uploadApiPlugin() {
  const attach = (server) => {
    server.middlewares.use(async (request, response, next) => {
      if (!new URL(request.url || '/', 'http://localhost').pathname.startsWith('/api/uploads')) return next();
      try {
        await handleUpload(request, response, new URL(request.url || '/', 'http://localhost').pathname);
      } catch (error) {
        console.error('[upload-api]', error);
        if (!response.headersSent) sendJson(response, 500, { error: error.message || 'Erreur pendant l’upload.' });
      }
    });
  };
  return {
    name: 'mozilanim-upload-api',
    configureServer: attach,
    configurePreviewServer: attach
  };
}