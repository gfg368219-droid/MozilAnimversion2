---
name: Private GitHub import
description: Reliable way to import private repository contents through the Replit GitHub connection
---

Pour un dépôt GitHub privé, l’accès authentifié à l’API fonctionne, mais les endpoints `tarball`/`zipball` peuvent être refusés par le proxy. Récupérer l’arborescence puis les blobs via l’API Contents permet d’importer les fichiers sans exposer de credentials.

**Why:** Le clonage Git HTTPS et le téléchargement d’archive peuvent échouer même lorsqu’une connexion GitHub Replit valide peut lire le dépôt.

**How to apply:** Vérifier le dépôt avec l’API authentifiée, télécharger chaque fichier de l’arborescence vers un dossier temporaire, valider la copie, puis remplacer le contenu du projet.