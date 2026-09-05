import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createApiHandler } from './api.js';

const root = path.resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT || 5000);
const api = createApiHandler();
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

async function serveStatic(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.end('Method Not Allowed');
    return;
  }
  const requestPath = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  const candidate = path.resolve(root, `.${requestPath}`);
  if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) {
    response.statusCode = 400;
    response.end('Bad Request');
    return;
  }
  let filePath = candidate;
  try {
    if ((await fsp.stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (!path.extname(requestPath)) filePath = path.join(root, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    response.statusCode = 404;
    response.end('Not Found');
    return;
  }
  const stat = await fsp.stat(filePath);
  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypes[path.extname(filePath)] || 'application/octet-stream');
  response.setHeader('Content-Length', stat.size);
  if (request.method === 'HEAD') return response.end();
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    if (await api(request, response)) return;
    await serveStatic(request, response);
  } catch (error) {
    console.error('[server]', error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.end('Internal Server Error');
    }
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Mozilanim server listening on port ${port}`);
});