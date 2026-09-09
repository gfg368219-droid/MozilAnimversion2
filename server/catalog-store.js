import fs from 'node:fs/promises';
import path from 'node:path';

const STATE_KEY = 'mozilanim:state';
const DATA_DIR = process.env.MOZILANIM_DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'mozilanim.json');
const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const STATE_CACHE_TTL_MS = Math.max(250, Number(process.env.MOZILANIM_STATE_CACHE_MS || 2_000));
let writeQueue = Promise.resolve();
let stateCache = null;
let stateCacheAt = 0;

const emptyState = () => ({ anime: [], jobs: [] });
const normalizeState = (parsed) => ({
  anime: Array.isArray(parsed?.anime) ? parsed.anime : [],
  jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : []
});

async function readFileState() {
  try {
    const parsed = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    return {
      anime: Array.isArray(parsed.anime) ? parsed.anime : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw error;
  }
}

async function kvCommand(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error(`Le stockage KV a répondu HTTP ${response.status}.`);
  const payload = await response.json();
  return payload.result;
}

export async function readState() {
  if (stateCache && Date.now() - stateCacheAt < STATE_CACHE_TTL_MS) return stateCache;
  if (hasKv) {
    const value = await kvCommand(['GET', STATE_KEY]);
    stateCache = value ? normalizeState(typeof value === 'string' ? JSON.parse(value) : value) : emptyState();
    stateCacheAt = Date.now();
    return stateCache;
  }
  stateCache = await readFileState();
  stateCacheAt = Date.now();
  return stateCache;
}

export async function writeState(state) {
  const normalized = {
    anime: Array.isArray(state.anime) ? state.anime : [],
    jobs: Array.isArray(state.jobs) ? state.jobs : []
  };
  if (hasKv) {
    await kvCommand(['SET', STATE_KEY, JSON.stringify(normalized)]);
    stateCache = normalized;
    stateCacheAt = Date.now();
    return normalized;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(normalized, null, 2));
  await fs.rename(temporaryFile, DATA_FILE);
  stateCache = normalized;
  stateCacheAt = Date.now();
  return normalized;
}

export function updateState(updater) {
  const operation = writeQueue.then(async () => {
    const next = await updater(await readState());
    return writeState(next);
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export function storageDescription() {
  return hasKv ? 'Vercel KV / Upstash Redis' : 'fichier local de développement';
}