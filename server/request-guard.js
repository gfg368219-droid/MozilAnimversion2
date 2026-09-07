const buckets = new Map();
const WINDOW_MS = 60_000;

const automatedUserAgent = /(?:curl|wget|python|requests|scrapy|aiohttp|httpclient|phantom|selenium|playwright|puppeteer|headless|爬虫|bot\b|crawler)/i;

function clientAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(request.headers['x-real-ip'] || '').trim() || 'unknown';
}

function limitFor(pathname) {
  if (pathname === '/api/admin/session') return 12;
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
  const key = `${address}:${pathname === '/api/admin/session' ? 'admin' : 'api'}`;
  const previous = buckets.get(key);
  const bucket = previous && now - previous.startedAt < WINDOW_MS
    ? previous
    : { startedAt: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 2000) {
    for (const [bucketKey, value] of buckets) {
      if (now - value.startedAt >= WINDOW_MS) buckets.delete(bucketKey);
    }
  }

  const userAgent = String(request.headers['user-agent'] || '');
  const sensitiveRequest = request.method !== 'GET'
    || pathname === '/api/admin/session'
    || pathname.includes('/api/import-jobs')
    || pathname.includes('/api/anime-sama/import');
  if (sensitiveRequest && (!userAgent || automatedUserAgent.test(userAgent))) {
    return reject(response, 403, 'Requête automatisée refusée.');
  }
  if (bucket.count > limitFor(pathname)) {
    return reject(response, 429, 'Trop de requêtes. Réessayez plus tard.', 60);
  }
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return false;
}