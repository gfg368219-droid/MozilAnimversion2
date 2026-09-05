---
name: Deployment npm lockfile
description: Constraint for deploying Node projects built in Replit
---

Les lockfiles npm générés dans Replit peuvent contenir des URLs `package-firewall.replit.local` inaccessibles au builder de déploiement. Le lockfile de production doit référencer `https://registry.npmjs.org/` directement.

**Why:** Le builder externe peut échouer avec `ENOTFOUND` avant même le build de l’application, alors que l’installation et le build locaux réussissent.

**How to apply:** Après un import ou une régénération de dépendances, vérifier les champs `resolved` du lockfile et les régénérer avec le registre npm public si une URL interne apparaît.