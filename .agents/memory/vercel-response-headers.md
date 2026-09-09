---
name: Headers de réponse Vercel
description: Compatibilité des handlers Node/Vercel avec les headers de la requête pour la compression HTTP.
---

Les handlers API ne doivent pas supposer que la réponse expose toujours la requête d’origine via `response.req`. Pour toute négociation dépendant de `Accept-Encoding` ou d’un autre header entrant, rendre la requête explicitement disponible au writer de réponse.

**Why:** Le runtime local et le runtime Vercel peuvent présenter des objets `response` différents ; le catalogue pouvait donc rester non compressé malgré un client compatible gzip.

**How to apply:** Conserver un chemin de secours explicite entre `request.headers` et le writer partagé, sans exposer de secrets ni modifier les headers de cache métier.