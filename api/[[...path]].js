import { URL } from 'node:url';
import { handleApiRequest } from '../server/api-handler.js';
import { handleAnimeSamaRequest } from '../server/anime-sama-api.js';

export default async function handler(request, response) {
  const requestUrl = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`);
  if (requestUrl.pathname.startsWith('/api/anime-sama/')) {
    return handleAnimeSamaRequest(request, response, requestUrl);
  }
  return handleApiRequest(request, response, requestUrl);
}