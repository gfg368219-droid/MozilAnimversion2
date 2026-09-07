import { URL } from 'node:url';
import { fetchCatalogue, fetchPlanning, importAnime } from './anime-sama-api.js';
import { checkAdminCredentials, createAdminToken, isAdminRequest } from './admin-auth.js';
import { readState, storageDescription, updateState } from './catalog-store.js';
import { guardApiRequest } from './request-guard.js';

const MAX_ATTEMPTS = 5;
const WORKER_BATCH_SIZE = Math.max(
  1,
  Number(process.env.IMPORT_WORKER_CONCURRENCY || (process.env.VERCEL ? 48 : 96))
);
const WORKER_INTERVAL_MS = Math.max(1_000, Number(process.env.IMPORT_WORKER_INTERVAL_MS || 1_000));
let workerStarted = false;
let workerRunning = false;

const sendJson = (response, status, payload) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
};

async function readJson(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const sourceKey = (value) => {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(value || '').replace(/\/+$/, '').toLowerCase();
  }
};

function upsertAnime(anime, item) {
  const key = sourceKey(item.sourceUrl);
  const existingIndex = anime.findIndex((candidate) => candidate.id === item.id || (key && sourceKey(candidate.sourceUrl) === key));
  if (existingIndex < 0) return [item, ...anime];
  const next = [...anime];
  const existing = next[existingIndex];
  const episodeSignature = (value) => JSON.stringify((value.seasons || []).map((season) => ({
    id: season.id,
    versions: (season.versions || []).map((version) => ({
      name: version.name,
      episodes: (version.readers || []).flatMap((reader) => reader.episodes || [])
    }))
  })));
  const episodesChanged = episodeSignature(existing) !== episodeSignature(item);
  const updatedAt = episodesChanged
    ? (item.updatedAt || Date.now())
    : (existing.updatedAt || item.updatedAt || Date.now());
  next[existingIndex] = {
    ...existing,
    ...item,
    id: existing.id,
    updatedAt,
    lastEpisodeAt: episodesChanged ? updatedAt : (existing.lastEpisodeAt || updatedAt)
  };
  return next;
}

function summarizeJob(job) {
  const entries = job.entries || [];
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    total: entries.length || job.total || 0,
    completed: entries.filter((entry) => ['imported', 'skipped', 'failed'].includes(entry.status)).length,
    imported: entries.filter((entry) => entry.status === 'imported').length,
    skipped: entries.filter((entry) => entry.status === 'skipped').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
    pending: entries.filter((entry) => ['pending', 'retrying', 'running'].includes(entry.status)).length,
    errors: entries.filter((entry) => entry.status === 'failed').map((entry) => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      attempts: entry.attempts,
      error: entry.error
    })),
    entries
  };
}

async function initializeJob(jobId) {
  const state = await readState();
  const job = state.jobs.find((entry) => entry.id === jobId);
  if (!job || job.entries?.length || job.setupStatus === 'ready') return job;
  try {
    const source = process.env.ANIME_SAMA_SOURCE_URL || 'https://anime-sama.to';
    const entries = job.kind === 'planning' ? await fetchPlanning(source) : await fetchCatalogue(source);
    await updateState((current) => ({
      ...current,
      jobs: current.jobs.map((entry) => entry.id === jobId && entry.status !== 'cancelled' ? {
        ...entry,
        setupStatus: 'ready',
        status: entries.length ? 'running' : 'completed',
        total: entries.length,
        entries: entries.map((item, index) => ({
          id: `${jobId}-${index}`,
          title: item.title,
          url: item.url,
          poster: item.poster,
          day: item.day,
          date: item.date,
          time: item.time,
          status: 'pending',
          attempts: 0
        })),
        updatedAt: Date.now()
      } : entry)
    }));
  } catch (error) {
    await updateState((current) => ({
      ...current,
      jobs: current.jobs.map((entry) => entry.id === jobId ? {
        ...entry,
        setupAttempts: (entry.setupAttempts || 0) + 1,
        status: (entry.setupAttempts || 0) + 1 >= MAX_ATTEMPTS ? 'failed' : 'retrying',
        error: error.message,
        updatedAt: Date.now()
      } : entry)
    }));
  }
  return (await readState()).jobs.find((entry) => entry.id === jobId);
}

async function processEntry(entry) {
  try {
    const imported = await importAnime(entry.title, entry.url);
    return { entryId: entry.id, imported };
  } catch (error) {
    return { entryId: entry.id, error: error.message || 'Erreur inconnue' };
  }
}

export async function runImportWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const initial = await readState();
    const now = Date.now();
    const activeJobs = initial.jobs.filter((job) => ['queued', 'retrying', 'running'].includes(job.status));
    for (const job of activeJobs) {
      const currentJob = await initializeJob(job.id);
      if (!currentJob || currentJob.status === 'failed' || currentJob.status === 'completed') continue;
      const staleRunning = (entry) => entry.status === 'running' && now - Number(entry.startedAt || 0) > 120_000;
      const candidates = (currentJob.entries || [])
        .filter((entry) => entry.status === 'pending' || entry.status === 'retrying' || staleRunning(entry))
        .filter((entry) => !entry.nextAttemptAt || entry.nextAttemptAt <= now)
        .slice(0, WORKER_BATCH_SIZE);
      if (!candidates.length) continue;

      const candidateIds = new Set(candidates.map((entry) => entry.id));
      const startedAt = Date.now();
      await updateState((current) => ({
        ...current,
        jobs: current.jobs.map((savedJob) => savedJob.id !== job.id || savedJob.status === 'cancelled' ? savedJob : {
          ...savedJob,
          status: 'running',
          entries: savedJob.entries.map((entry) => candidateIds.has(entry.id) ? {
            ...entry,
            status: 'running',
            attempts: (entry.attempts || 0) + 1,
            startedAt
          } : entry),
          updatedAt: startedAt
        })
      }));

      const results = await Promise.all(candidates.map((entry) => processEntry(entry)));
      await updateState((current) => {
        const savedJob = current.jobs.find((candidate) => candidate.id === job.id);
        if (!savedJob || savedJob.status === 'cancelled') return current;
        const resultById = new Map(results.map((result) => [result.entryId, result]));
        const nextAnime = [...current.anime];
        const nextEntries = savedJob.entries.map((savedEntry) => {
          const result = resultById.get(savedEntry.id);
          if (!result) return savedEntry;
          if (result.imported) {
            nextAnime.splice(0, nextAnime.length, ...upsertAnime(nextAnime, {
              ...result.imported,
              ...(job.kind === 'planning' && (savedEntry.date || savedEntry.day !== undefined) ? {
                schedule: savedEntry.date
                  ? { date: savedEntry.date, time: savedEntry.time || '18:00', day: savedEntry.day, seasonId: result.imported.seasons.at(-1)?.id }
                  : { day: savedEntry.day, time: savedEntry.time || '18:00', seasonId: result.imported.seasons.at(-1)?.id }
              } : {})
            }));
            return {
              ...savedEntry,
              status: 'imported',
              error: '',
              itemId: result.imported.id,
              finishedAt: Date.now()
            };
          }
          const attempts = savedEntry.attempts || 1;
          return {
            ...savedEntry,
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'retrying',
            error: result.error,
            nextAttemptAt: Date.now() + Math.min(60_000, 2_000 * (2 ** Math.max(0, attempts - 1)))
          };
        });
        return {
          ...current,
          anime: nextAnime,
          jobs: current.jobs.map((savedJob) => savedJob.id !== job.id ? savedJob : {
            ...savedJob,
            entries: nextEntries,
            updatedAt: Date.now()
          })
        };
      });

      const after = await readState();
      const saved = after.jobs.find((entry) => entry.id === job.id);
      if (saved?.entries?.length && saved.entries.every((entry) => ['imported', 'skipped', 'failed'].includes(entry.status))) {
        await updateState((current) => ({
          ...current,
          jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : {
            ...entry,
            status: entry.entries.some((item) => item.status === 'failed') ? 'completed_with_errors' : 'completed',
            updatedAt: Date.now()
          })
        }));
      }
    }
  } finally {
    workerRunning = false;
  }
}

export function startImportWorker() {
  if (workerStarted) return;
  workerStarted = true;
  const tick = () => runImportWorker().catch((error) => console.error('[import-worker]', error));
  tick();
  setInterval(tick, WORKER_INTERVAL_MS);
}

async function handleCatalog(request, response) {
  if (request.method === 'GET') {
    const state = await readState();
    return sendJson(response, 200, { anime: state.anime, storage: storageDescription() });
  }
  if (request.method === 'PUT') {
    if (!isAdminRequest(request)) return sendJson(response, 401, { error: 'Session administrateur requise.' });
    const body = await readJson(request);
    if (!Array.isArray(body.anime)) return sendJson(response, 400, { error: 'Le catalogue est invalide.' });
    const state = await updateState((current) => ({ ...current, anime: body.anime }));
    return sendJson(response, 200, { anime: state.anime });
  }
  if (request.method === 'DELETE') {
    if (!isAdminRequest(request)) return sendJson(response, 401, { error: 'Session administrateur requise.' });
    const state = await updateState((current) => ({
      ...current,
      anime: [],
      jobs: current.jobs.map((job) => ['queued', 'retrying', 'running'].includes(job.status) ? {
        ...job,
        status: 'cancelled',
        updatedAt: Date.now(),
        entries: (job.entries || []).map((entry) => ['pending', 'retrying', 'running'].includes(entry.status)
          ? { ...entry, status: 'cancelled', error: 'Import annulé après suppression du catalogue.' }
          : entry)
      } : job)
    }));
    return sendJson(response, 200, { anime: state.anime, message: 'Catalogue et planning supprimés.' });
  }
  return sendJson(response, 405, { error: 'Méthode non autorisée.' });
}

async function handleJobs(request, response, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[2] === 'worker') {
    await runImportWorker();
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === 'GET' && parts.length === 2) {
    const state = await readState();
    return sendJson(response, 200, { jobs: state.jobs.slice(-30).reverse().map(summarizeJob) });
  }
  if (request.method === 'POST' && parts.length === 2) {
    if (!isAdminRequest(request)) return sendJson(response, 401, { error: 'Session administrateur requise.' });
    const body = await readJson(request);
    if (!['planning', 'catalogue'].includes(body.kind)) return sendJson(response, 400, { error: 'Type d’import invalide.' });
    const job = {
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: body.kind,
      status: 'queued',
      setupStatus: 'pending',
      setupAttempts: 0,
      total: 0,
      entries: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await updateState((current) => ({ ...current, jobs: [...current.jobs, job].slice(-50) }));
    startImportWorker();
    return sendJson(response, 202, { job: summarizeJob(job) });
  }
  if (parts.length >= 3) {
    const jobId = parts[2];
    if (request.method === 'GET' && parts.length === 3) {
      const state = await readState();
      const job = state.jobs.find((entry) => entry.id === jobId);
      return job ? sendJson(response, 200, { job: summarizeJob(job) }) : sendJson(response, 404, { error: 'Import introuvable.' });
    }
    if (request.method === 'POST' && parts[3] === 'retry-failed') {
      if (!isAdminRequest(request)) return sendJson(response, 401, { error: 'Session administrateur requise.' });
      const state = await updateState((current) => ({
        ...current,
        jobs: current.jobs.map((job) => job.id !== jobId ? job : {
          ...job,
          status: 'running',
          entries: job.entries.map((entry) => entry.status === 'failed' ? { ...entry, status: 'pending', attempts: 0, error: '', nextAttemptAt: 0 } : entry),
          updatedAt: Date.now()
        })
      }));
      const job = state.jobs.find((entry) => entry.id === jobId);
      startImportWorker();
      return sendJson(response, 202, { job: summarizeJob(job) });
    }
  }
  return sendJson(response, 404, { error: 'Route d’import introuvable.' });
}

export async function handleApiRequest(request, response, requestUrl = new URL(request.url || '/', 'http://localhost')) {
  try {
    if (guardApiRequest(request, response)) return;
    if (requestUrl.pathname === '/api/admin/session' && request.method === 'POST') {
      const body = await readJson(request);
      if (!checkAdminCredentials(body.email, body.password)) return sendJson(response, 401, { error: 'Identifiants administrateur incorrects.' });
      return sendJson(response, 200, { token: createAdminToken(String(body.email).trim().toLowerCase()) });
    }
    if (requestUrl.pathname === '/api/catalog') return handleCatalog(request, response);
    if (requestUrl.pathname.startsWith('/api/import-jobs')) return handleJobs(request, response, requestUrl.pathname);
    return sendJson(response, 404, { error: 'API introuvable.' });
  } catch (error) {
    console.error('[api]', error);
    if (!response.headersSent) sendJson(response, 500, { error: error.message || 'Erreur serveur.' });
  }
}