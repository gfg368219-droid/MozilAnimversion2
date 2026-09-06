---
name: Parsing Anime-Sama
description: Contrainte de parsing des fiches Anime-Sama lors de l’import des saisons.
---

Les fiches Anime-Sama contiennent parfois des exemples `panneauAnime(...)` dans des commentaires JavaScript. Ils ressemblent aux liens actifs et peuvent créer de fausses saisons avec quelques épisodes.

**Why:** une fiche peut afficher des saisons inexistantes dans Mozilanim si le parseur lit les exemples commentés comme du contenu actif.

**How to apply:** nettoyer les commentaires HTML et JavaScript avant d’extraire les appels `panneauAnime`, puis ne parser que les liens actifs et leurs scripts d’épisodes disponibles.