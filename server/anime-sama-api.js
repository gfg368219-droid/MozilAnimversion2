import { URL } from 'node:url';
import { isAdminRequest } from './admin-auth.js';
import { guardApiRequest } from './request-guard.js';

const DEFAULT_SOURCE = 'https://anime-sama.to';
const SOURCE_HOSTS = new Set(['anime-sama.to', 'anime-sama.org', 'anime-sama.tv', 'anime-sama.fr']);
const REQUEST_TIMEOUT_MS = 25_000;
const FETCH_ATTEMPTS = 3;
const VERSION_PATHS = ['vostfr', 'vf', 'vo', 'vkr', 'va'];
const VERSION_CONCURRENCY = Math.max(1, Number(process.env.IMPORT_VERSION_CONCURRENCY || 8));

const sendJson = (response, status, payload) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
};

const htmlDecode = (value = '') => value
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#039;|&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const textOnly = (value = '') => htmlDecode(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const absoluteUrl = (value, base) => new URL(value, base).toString();
const slugify = (value) => value.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function validSourceUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !SOURCE_HOSTS.has(url.hostname)) {
    throw new Error('L’URL doit pointer vers un catalogue Anime-Sama autorisé.');
  }
  return url;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/javascript,text/javascript,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; MozilanimImporter/1.1)'
        },
        signal: controller.signal
      });
      if (response.ok) return await response.text();
      lastError = new Error(`Anime-Sama a répondu HTTP ${response.status} pour ${url}.`);
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_ATTEMPTS) throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < FETCH_ATTEMPTS) await wait(350 * (2 ** (attempt - 1)));
  }
  throw lastError;
}

function parseSearchResults(html, query, source) {
  const wanted = query.toLocaleLowerCase('fr');
  const results = [];
  const cardPattern = /<a\s+href=["']([^"']*\/catalogue\/[^"']+)["'][\s\S]{0,2600}?<h2[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>[\s\S]{0,600}?<p[^>]*class=["'][^"']*alternate-titles[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi;
  for (const match of html.matchAll(cardPattern)) {
    const title = textOnly(match[2]);
    const alternateTitles = textOnly(match[3]);
    const haystack = `${title} ${alternateTitles}`.toLocaleLowerCase('fr');
    if (!haystack.includes(wanted)) continue;
    const url = absoluteUrl(match[1], source);
    if (!results.some((item) => item.url === url)) results.push({ title, url, alternateTitles });
  }
  return results.slice(0, 12);
}

function extractCatalogueCards(html, source) {
  const results = [];
  const cardPattern = /<div[^>]*class=["'][^"']*\bcatalog-card\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["'][^"']*\bcatalog-card\b|$)/gi;
  for (const match of html.matchAll(cardPattern)) {
    const card = match[1];
    const urlMatch = card.match(/<a\s+href=["']([^"']*\/catalogue\/[^"']+)["']/i);
    const titleMatch = card.match(/<h2[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
    if (!urlMatch || !titleMatch) continue;
    const url = absoluteUrl(urlMatch[1], source);
    if (results.some((item) => item.url === url)) continue;
    const alternateTitles = textOnly(card.match(/<p[^>]*class=["'][^"']*alternate-titles[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const poster = absoluteUrl(card.match(/<img[^>]*class=["'][^"']*card-image[^"']*["'][^>]*src=["']([^"']+)/i)?.[1] || '', url);
    results.push({ title: textOnly(titleMatch[1]), url, poster, alternateTitles });
  }
  return results;
}

function planningDayToJsDay(sourceDay) {
  const number = Number(sourceDay);
  return number === 6 ? 0 : number + 1;
}

function normalizePlanningTime(value) {
  const clean = textOnly(value).replace(/\s+/g, '').replace('：', ':');
  const match = clean.match(/(\d{1,2})[h:](\d{2})/i);
  return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : '18:00';
}

function planningDateFromTimestamp(timestamp) {
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return '';
  return new Date(number * 1000).toISOString().slice(0, 10);
}

function planningDateFromLabel(value) {
  const match = textOnly(value).match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return '';
  const now = new Date();
  let year = now.getUTCFullYear();
  const month = Number(match[2]);
  if (month === 12 && now.getUTCMonth() === 0) year -= 1;
  if (month === 1 && now.getUTCMonth() === 11) year += 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
}

function extractPlanningEntries(html, source) {
  const entries = [];
  const sectionPattern = /<div[^>]*id=["'](\d+)["'][^>]*class=["'][^"']*\bselectedRow\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*id=["']\d+["'][^>]*class=["'][^"']*\bselectedRow\b|$)/gi;
  for (const sectionMatch of html.matchAll(sectionPattern)) {
    const sourceDay = Number(sectionMatch[1]);
    const section = sectionMatch[2];
    const sectionDate = planningDateFromLabel(section.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const cardPattern = /<div[^>]*class=["'][^"']*\banime-card-premium\b[^"']*\bplanning-card\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["'][^"']*\banime-card-premium\b[^"']*\bplanning-card\b|<div[^>]*class=["'][^"']*\bscan-card-premium\b[^"']*\bplanning-card\b|$)/gi;
    for (const cardMatch of section.matchAll(cardPattern)) {
      const card = cardMatch[1];
      const path = card.match(/<a\s+href=["']([^"']*\/catalogue\/[^"']+)["']/i)?.[1];
      const title = textOnly(card.match(/<h2[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
      if (!path || !title) continue;
      const url = absoluteUrl(path, source);
      const animePath = new URL(url).pathname.match(/(\/catalogue\/[^/]+\/?)/i)?.[1];
      if (!animePath) continue;
      const posterValue = card.match(/<img[^>]*class=["'][^"']*card-image[^"']*["'][^>]*src=["']([^"']+)/i)?.[1] || '';
      const timeValue = card.match(/<div[^>]*class=["'][^"']*planning-time[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '';
      const timestamp = card.match(/data-release-ts=["']([^"']+)["']/i)?.[1];
      const entry = {
        title,
        url: absoluteUrl(animePath, source),
        poster: absoluteUrl(posterValue, source),
        day: planningDayToJsDay(sourceDay),
        time: normalizePlanningTime(timeValue),
        date: planningDateFromTimestamp(timestamp) || sectionDate
      };
      const existing = entries.find((candidate) => candidate.url === entry.url);
      if (!existing) entries.push(entry);
      else if (!existing.date && entry.date) Object.assign(existing, entry);
    }
  }
  return entries;
}

export async function searchAnime(query, source) {
  const catalogueHtml = await fetchText(`${source.replace(/\/+$/, '')}/catalogue/`);
  const results = parseSearchResults(catalogueHtml, query, source);
  if (results.length) return results;
  const candidateUrl = `${source.replace(/\/+$/, '')}/catalogue/${slugify(query)}/`;
  try {
    const candidateHtml = await fetchText(candidateUrl);
    const metadata = parseAnimePage(candidateHtml, candidateUrl);
    if (metadata.title) return [{ title: metadata.title, url: candidateUrl, alternateTitles: '' }];
  } catch {
    // The catalogue can use a different slug; an empty result is clearer than a guessed import.
  }
  return [];
}

export async function fetchPlanning(source) {
  const html = await fetchText(`${source.replace(/\/+$/, '')}/planning/`);
  return extractPlanningEntries(html, source);
}

export async function fetchCatalogue(source) {
  const base = source.replace(/\/+$/, '');
  const firstPage = await fetchText(`${base}/catalogue/`);
  const pageNumbers = [...firstPage.matchAll(/[?&]page=(\d+)/gi)]
    .map((match) => Number(match[1]))
    .filter((page) => Number.isInteger(page) && page > 0);
  const lastPage = Math.max(1, ...pageNumbers);
  const pages = [firstPage];
  let nextPage = 2;
  const worker = async () => {
    while (nextPage <= lastPage) {
      const page = nextPage;
      nextPage += 1;
      try {
        pages[page - 1] = await fetchText(`${base}/catalogue/?page=${page}`);
      } catch (error) {
        console.warn(`[anime-sama-api] Page catalogue ignorée (${page}): ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, lastPage - 1) }, worker));
  return pages.filter(Boolean).flatMap((page) => extractCatalogueCards(page, source));
}

function parseEpisodes(script) {
  const readers = [];
  const expression = /(?:var|let|const)\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]/gi;
  for (const match of script.matchAll(expression)) {
    const episodes = [...match[2].matchAll(/['"`](https?:\/\/[^'"`]+)['"`]/g)]
      .map((entry) => entry[1].trim())
      .filter(Boolean);
    if (episodes.length) readers.push({ name: `Lecteur ${match[1]}`, episodes });
  }
  return readers;
}

function parseAnimePage(html, sourceUrl) {
  const executableHtml = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const title = textOnly(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s*\|.*$/, '')
    .trim();
  const poster = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)/i)?.[1] || '';
  const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] || '';
  const genres = [...executableHtml.matchAll(/<span[^>]*class=["'][^"']*genre-tag[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => textOnly(match[1]))
    .filter((genre) => genre && genre !== '…');
  const links = [...executableHtml.matchAll(/panneauAnime\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/gi)]
    .map((match) => ({ label: textOnly(match[1]), path: match[2].replace(/^\/+|\/+$/g, '') }))
    .filter((link) => link.path.includes('/') && link.path.toLowerCase() !== 'url');
  return {
    title,
    poster: absoluteUrl(poster, sourceUrl),
    description: htmlDecode(description),
    genres: [...new Set(genres)],
    links: [...new Map(links.map((link) => [link.path, link])).values()]
  };
}

function expandVersionLinks(links) {
  const expanded = [];
  for (const link of links) {
    const parts = link.path.split('/').filter(Boolean);
    const currentVersion = parts.at(-1)?.toLowerCase();
    if (!parts.length || !VERSION_PATHS.includes(currentVersion)) {
      expanded.push(link);
      continue;
    }
    const seasonPath = parts.slice(0, -1).join('/');
    for (const versionPath of VERSION_PATHS) {
      expanded.push({ ...link, path: `${seasonPath}/${versionPath}` });
    }
  }
  return [...new Map(expanded.map((link) => [link.path, link])).values()];
}

async function parseVersion(source, basePath, seasonLabel, versionPath) {
  const pageUrl = new URL(`${basePath.replace(/\/+$/, '')}/${versionPath.replace(/^\/+/, '')}/`, source);
  const html = await fetchText(pageUrl);
  const scriptMatch = html.match(/<script[^>]+src=['"]([^'"]*(?:episodes?|lecteurs?)[^'"]*\.js[^'"]*)['"]/i);
  if (!scriptMatch) return null;
  const scriptUrl = absoluteUrl(scriptMatch[1], pageUrl);
  const readers = parseEpisodes(await fetchText(scriptUrl));
  if (!readers.length) return null;
  const versionName = versionPath.split('/').pop().toUpperCase();
  const seasonNumber = Number(versionPath.match(/saison(\d+)/i)?.[1] || 1);
  return {
    seasonNumber,
    seasonLabel: seasonLabel || `Saison ${seasonNumber}`,
    version: {
      name: versionName,
      sourceUrl: pageUrl.toString(),
      readers,
      episodeNames: readers[0].episodes.map((_, index) => `Épisode ${index + 1}`)
    }
  };
}

export async function importAnime(query, directUrl) {
  const source = process.env.ANIME_SAMA_SOURCE_URL || DEFAULT_SOURCE;
  const sourceUrl = directUrl ? validSourceUrl(directUrl) : null;
  let animeUrl = sourceUrl;
  if (!animeUrl) {
    const results = await searchAnime(query.trim(), source);
    const result = results[0];
    if (!result) throw new Error('Anime introuvable dans le catalogue Anime-Sama.');
    animeUrl = validSourceUrl(result.url);
  }

  const baseHtml = await fetchText(animeUrl);
  const metadata = parseAnimePage(baseHtml, animeUrl);
  const parsedLinks = expandVersionLinks(metadata.links);
  const versions = await mapWithConcurrency(parsedLinks, VERSION_CONCURRENCY, async (link) => {
    try {
      return await parseVersion(source, animeUrl.pathname, link.label, link.path);
    } catch (error) {
      if (!/HTTP 404\b/.test(error.message || '')) {
        console.warn(`[anime-sama-api] Version ignorée (${link.path}): ${error.message}`);
      }
      return null;
    }
  });
  const seasons = new Map();
  for (const entry of versions.filter(Boolean)) {
    const seasonId = `saison-${entry.seasonNumber}`;
    const saved = seasons.get(seasonId) || { id: seasonId, name: entry.seasonLabel, sourceUrl: new URL(entry.version.sourceUrl).origin + animeUrl.pathname, versions: [] };
    if (!saved.versions.some((version) => version.name === entry.version.name)) saved.versions.push(entry.version);
    seasons.set(seasonId, saved);
  }
  if (!seasons.size) throw new Error('Aucune saison exploitable n’a été trouvée sur cette fiche Anime-Sama.');
  const slug = animeUrl.pathname.match(/\/catalogue\/([^/]+)/i)?.[1] || query.trim();
  return {
    id: `anime-sama-${slug}`,
    name: metadata.title || query.trim(),
    poster: metadata.poster,
    backdrop: metadata.poster,
    description: metadata.description,
    genres: metadata.genres,
    year: String(new Date().getFullYear()),
    studio: 'Anime-Sama',
    isStudio: false,
    status: 'En cours',
    source: 'anime-sama',
    sourceUrl: animeUrl.toString(),
    importedAt: Date.now(),
    seasons: [...seasons.values()].sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1])),
    updatedAt: Date.now(),
    lastEpisodeAt: Date.now()
  };
}

export async function handleAnimeSamaRequest(request, response, requestUrl = new URL(request.url || '/', 'http://localhost')) {
  try {
    if (guardApiRequest(request, response)) return;
    if (requestUrl.pathname === '/api/anime-sama/search') {
      const query = requestUrl.searchParams.get('q')?.trim();
      if (!query) return sendJson(response, 400, { error: 'Le titre est obligatoire.' });
      const source = process.env.ANIME_SAMA_SOURCE_URL || DEFAULT_SOURCE;
      return sendJson(response, 200, { results: await searchAnime(query, source) });
    }
    if (requestUrl.pathname === '/api/anime-sama/planning') {
      const source = process.env.ANIME_SAMA_SOURCE_URL || DEFAULT_SOURCE;
      const entries = await fetchPlanning(source);
      return sendJson(response, 200, { source, total: entries.length, entries });
    }
    if (requestUrl.pathname === '/api/anime-sama/catalogue') {
      const source = process.env.ANIME_SAMA_SOURCE_URL || DEFAULT_SOURCE;
      const results = await fetchCatalogue(source);
      return sendJson(response, 200, { source, total: results.length, results });
    }
    if (requestUrl.pathname === '/api/anime-sama/import') {
      if (!isAdminRequest(request)) return sendJson(response, 401, { error: 'Session administrateur requise pour importer.' });
      const query = requestUrl.searchParams.get('q')?.trim();
      const sourceUrl = requestUrl.searchParams.get('url')?.trim();
      if (!query && !sourceUrl) return sendJson(response, 400, { error: 'Le titre ou l’URL Anime-Sama est obligatoire.' });
      const item = await importAnime(query || '', sourceUrl);
      return sendJson(response, 200, { item });
    }
    return sendJson(response, 404, { error: 'Route Anime-Sama introuvable.' });
  } catch (error) {
    console.error('[anime-sama-api]', error);
    return sendJson(response, 502, { error: error.message || 'Import Anime-Sama impossible.' });
  }
}

export function animeSamaApiPlugin() {
  return {
    name: 'mozilanim-anime-sama-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url || '/', 'http://localhost');
        if (!requestUrl.pathname.startsWith('/api/anime-sama/')) return next();
        return handleAnimeSamaRequest(request, response, requestUrl);
      });
    }
  };
}