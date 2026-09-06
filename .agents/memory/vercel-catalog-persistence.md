---
name: Vercel catalog persistence
description: Persistence and background import constraints for the shared anime catalog.
---

The shared catalog and import jobs use a local JSON file during development and Vercel KV / Upstash Redis when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are configured. Vercel cron drives the import worker after the browser is closed.

**Why:** Vercel serverless instances do not provide durable writable local storage, so a deployed catalog cannot rely on the development file fallback.

**How to apply:** Keep catalog writes and job state behind the storage adapter; configure KV before treating a Vercel deployment as production-ready.