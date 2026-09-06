import { URL } from 'node:url';

const DEFAULT_SOURCE = 'https://anime-sama.to';
const SOURCE_HOSTS = new Set(['anime-sama.to', 'anime-sama.org', 'anime-sama.tv', 'anime-sama.fr']);
const REQUEST_TIMEOUT_MS = 25_000;

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

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/javascript,text/javascript,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; MozilanimImporter/1.0)'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Anime-Sama a répondu HTTP ${response.status} pour ${url}.`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
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

async function searchAnime(query, source) {
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
  const title = textOnly(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s*\|.*$/, '')
    .trim();
  const poster = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)/i)?.[1] || '';
  const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] || '';
  const genres = [...html.matchAll(/<span[^>]*class=["'][^"']*genre-tag[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => textOnly(match[1]))
    .filter((genre) => genre && genre !== '…');
  const links = [...html.matchAll(/panneauAnime\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/gi)]
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

async function parseVersion(source, basePath, seasonLabel, versionPath) {
  const pageUrl = new URL(`${basePath.replace(/\/+$/, '')}/${versionPath.replace(/^\/+/, '')}/`, source);
  const html = await fetchText(pageUrl);
  const scriptMatch = html.match(/<script[^>]+src=['"]([^'"]*episodes\.js[^'"]*)['"]/i);
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

async function importAnime(query, directUrl) {
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
  const parsedLinks = metadata.links.length ? metadata.links : [{ label: 'Saison 1', path: 'saison1/vostfr' }];
  const versions = await Promise.all(parsedLinks.map(async (link) => {
    try {
      return await parseVersion(source, animeUrl.pathname, link.label, link.path);
    } catch (error) {
      console.warn(`[anime-sama-api] Version ignorée (${link.path}): ${error.message}`);
      return null;
    }
  }));
  const seasons = new Map();
  for (const entry of versions.filter(Boolean)) {
    const seasonId = `saison-${entry.seasonNumber}`;
    const saved = seasons.get(seasonId) || { id: seasonId, name: entry.seasonLabel, sourceUrl: new URL(entry.version.sourceUrl).origin + animeUrl.pathname, versions: [] };
    if (!saved.versions.some((version) => version.name === entry.version.name)) saved.versions.push(entry.version);
    seasons.set(seasonId, saved);
  }
  if (!seasons.size) throw new Error('Aucun épisode ni lecteur exploitable n’a été trouvé.');
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
    seasons: [...seasons.values()].sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]))
  };
}

export function animeSamaApiPlugin() {
  return {
    name: 'mozilanim-anime-sama-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url || '/', 'http://localhost');
        if (!requestUrl.pathname.startsWith('/api/anime-sama/')) return next();
        try {
          if (requestUrl.pathname === '/api/anime-sama/search') {
            const query = requestUrl.searchParams.get('q')?.trim();
            if (!query) return sendJson(response, 400, { error: 'Le titre est obligatoire.' });
            const source = process.env.ANIME_SAMA_SOURCE_URL || DEFAULT_SOURCE;
            return sendJson(response, 200, { results: await searchAnime(query, source) });
          }
          if (requestUrl.pathname === '/api/anime-sama/import') {
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
      });
    }
  };
}