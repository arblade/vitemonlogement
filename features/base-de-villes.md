# Base de villes pré-intégrée

**Statut :** partie serveur implémentée (30/09/2026) ; autocomplétion front en attente de la saisie en deux temps.

## Implémenté
- `artifacts/api-server/src/data/communes.json` : 34 969 communes (code INSEE, nom, codes postaux, département, population, centre), 2 Mo, régénérable avec `pnpm --filter @workspace/api-server run data:communes`.
- `src/lib/places.ts` : `suggestPlaces` (recherche floue en mémoire, insensible aux accents, à la casse et à « st »), `resolvePlace` (rattachement exact, département ou code postal pour les homonymes), `canonicalLocation`.
- `GET /api/places/suggest?q=&limit=` (session requise, sans quota coûteux).
- `interpret()` remplace la ville du LLM par le nom officiel quand elle est reconnue sans ambiguïté ; les cas ambigus, « Paris 12e » ou « Paris 12e, Vincennes » restent inchangés.
- Écart avec la fiche : un fichier embarqué dans le build plutôt qu'une table `communes` (pas de migration, même comportement sur Postgres et PGlite).

## Reste à faire
- Champ d'autocomplétion dans le formulaire : le front n'a qu'un texte libre, cela vient avec l'écran « Vérifier » de la [refonte UX](refonte-ux-et-saisie-en-deux-temps.md).
- Repose de la question quand la ville est ambiguë (`resolvePlace` renvoie déjà les candidats).
- Remplacer le test « la ville contient la chaîne » (`criteria.ts`) par un test sur les coordonnées.

**Source :** conversation « Feature géographique pour logement » (30/09/2026)

## Demande
Intégrer à l'app une base de villes pour faciliter la saisie (pas de typo) et aider le LLM à rattacher correctement la ville de l'utilisateur.

## Base recommandée
Communes issues de l'API Découpage administratif (`geo.api.gouv.fr`) ou du paquet `@etalab/decoupage-administratif` : code INSEE, nom, codes postaux, département, centre (lat/lon), population, soit environ 35 000 communes. Sans contours, quelques Mo au total (480 Ko pour une seule région ; les contours pèsent 34 Mo pour une région, donc à éviter).

Alternative plus riche : « Communes et villes de France » (data.gouv.fr, 62 champs, millésime 2026), licence non vérifiée. Codes postaux : base La Poste (hexasmal).

## Où la mettre
Table `communes` alimentée par un script de seed (Postgres en prod, SQLite en local), avec nom normalisé sans accents ni casse. `pg_trgm` n'existe pas en SQLite : recherche floue **en mémoire** côté serveur (35 000 lignes tiennent sans problème), avec Fuse.js ou une distance de Levenshtein.

## Usage
1. **Autocomplétion** dans le formulaire via `GET /api/places/suggest?q=`, triée par population (« Saint-Aubin » ne tombe pas au hasard).
2. **Résolution après le LLM** : la chaîne `location` est rattachée à un code INSEE, avec le département pour lever les homonymes ; si ambigu, l'appli repose la question.
3. **Gain annexe** : les coordonnées de la commune servent au calcul de trajet et remplacent le test actuel « la ville contient la chaîne » (`ai.ts`, ligne 157), plus fragile.

## Cas particulier
Paris, Lyon et Marseille ont un code commune global et des codes d'arrondissement distincts.

## Ordre proposé
C'est la première étape : autonome et utile tout de suite, avant [criteres-de-trajet](criteres-de-trajet.md).

## Non vérifié
Licence exacte de la base de villes.

## Sources
- [API Découpage administratif](https://guides.data.gouv.fr/guides/reutiliser-des-donnees/utiliser-les-api-geographiques/utiliser-lapi-decoupage-administratif)
- [Communes et villes de France](https://www.data.gouv.fr/fr/datasets/6745d9ae4524d845d2138193/)
- [Base officielle des codes postaux](https://www.data.gouv.fr/datasets/base-officielle-des-codes-postaux/discussions)
