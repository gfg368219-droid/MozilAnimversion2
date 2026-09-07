const buckets = new Map();
const automatedBlocks = new Map();
const WINDOW_MS = 60_000;
const AUTOMATION_BLOCK_MS = 120_000;

const automatedUserAgent = /(?:curl|wget|python|requests|scrapy|aiohttp|httpclient|phantom|selenium|playwright|puppeteer|headless|爬虫|bot\b|crawler)/i;

function clientAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(request.headers['x-real-ip'] || '').trim() || 'unknown';
}

function limitFor(pathname, method) {
  if (pathname === '/api/admin/session') return 12;
  if (method === 'GET' && pathname.startsWith('/api/import-jobs/')) return 120;
  if (pathname.includes('/anime-sama/import') || pathname.startsWith('/api/import-jobs')) return 30;
  return 120;
}

function reject(response, status, message, retryAfter) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (retryAfter) response.setHeader('Retry-After', String(retryAfter));
  response.end(JSON.stringify({ error: message }));
  return true;
}

export function guardApiRequest(request, response) {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  if (pathname === '/api/import-jobs/worker') return false;

  const address = clientAddress(request);
  const now = Date.now();
  const blockedUntil = automatedBlocks.get(address) || 0;
  if (blockedUntil > now) {
    return reject(
      response,
      429,
      'Adresse IP temporairement limitée pour activité automatisée.',
      Math.max(1, Math.ceil((blockedUntil - now) / 1000))
    );
  }
  if (blockedUntil) automatedBlocks.delete(address);

  const key = `${address}:${pathname === '/api/admin/session' ? 'admin' : 'api'}`;
  const previous = buckets.get(key);
  const bucket = previous && now - previous.startedAt < WINDOW_MS
    ? previous
    : { startedAt: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 2000 || automatedBlocks.size > 2000) {
    for (const [bucketKey, value] of buckets) {
      if (now - value.startedAt >= WINDOW_MS) buckets.delete(bucketKey);
    }
    for (const [blockedAddress, expiresAt] of automatedBlocks) {
      if (expiresAt <= now) automatedBlocks.delete(blockedAddress);
    }
  }

  const userAgent = String(request.headers['user-agent'] || '');
  const sensitiveRequest = request.method !== 'GET'
    || pathname === '/api/admin/session'
    || pathname.includes('/api/import-jobs')
    || pathname.includes('/api/anime-sama/import');
  if (sensitiveRequest && (!userAgent || automatedUserAgent.test(userAgent))) {
    automatedBlocks.set(address, now + AUTOMATION_BLOCK_MS);
    return reject(response, 429, 'Requête automatisée refusée pendant 2 minutes.', 120);
  }
  if (bucket.count > limitFor(pathname, request.method)) {
    return reject(response, 429, 'Trop de requêtes. Réessayez plus tard.', 60);
  }
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return false;
}