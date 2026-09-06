---
name: Parsing Anime-Sama
description: Contrainte de parsing des fiches Anime-Sama lors de l’import des saisons.
---

Les fiches Anime-Sama contiennent parfois des exemples `panneauAnime(...)` dans des commentaires JavaScript. Ils ressemblent aux liens actifs et peuvent créer de fausses saisons avec quelques épisodes. À l’inverse, une fiche peut ne déclarer que `vostfr` alors que les chemins frères `vf`, `vkr` ou `va` existent réellement.

**Why:** une fiche peut afficher des saisons inexistantes dans Mozilanim si le parseur lit les exemples commentés comme du contenu actif.

**How to apply:** nettoyer les commentaires HTML et JavaScript avant d’extraire les appels `panneauAnime`, puis sonder les suffixes de versions connus pour chaque saison et ne conserver que les pages et scripts d’épisodes qui répondent réellement.