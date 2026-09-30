---
name: Schéma de l’acteur Apify Leboncoin
description: Source fiable pour vérifier les paramètres d’entrée de l’acteur Clearpath.
---

Le schéma d’entrée de la version publiée de l’acteur fait autorité lorsque sa documentation narrative et son tableau de paramètres se contredisent.

**Why:** Le tableau public décrit `query`, tandis que le schéma du build publié expose `searchQuery`. Se fier seulement au tableau peut produire une recherche incorrecte ou sans filtre.

**How to apply:** Avant toute modification des paramètres envoyés à cet acteur, consulter le schéma d’entrée de son build public actuel. Cette lecture n’exécute pas l’acteur et n’engendre pas d’appel de recherche facturable.