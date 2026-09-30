# Règles de travail — Vite mon logement

## Tests : à chaque feature, à chaque demande
- **Toute nouvelle fonctionnalité ou correction s'accompagne de nouveaux tests** (sauf si vraiment non pertinent, à justifier), au bon niveau :
  - API / base / logique serveur → `artifacts/api-server/src/**/*.test.ts` (`node:test`, base PGlite en mémoire) ;
  - composants et pages React → `artifacts/logiscope/src/**/*.test.tsx` (Vitest + Testing Library, réseau simulé via `src/test/fixtures.ts`) ;
  - parcours utilisateur réel → `e2e/app.e2e.mjs` (Playwright, **mobile puis desktop**).
- **Les tests sont lancés à chaque fois, avant de conclure** : `pnpm test` (serveur + front), `pnpm test:e2e` (navigateur), `pnpm run typecheck`. On rapporte les résultats tels quels, échecs compris.
- **Exception : simple réglage visuel** (couleur, gris, espacement, une classe CSS) sans changement de comportement : on ne relance pas toute la suite. Aucun nouveau test, et on fusionne sur `main` sur demande sans repasser `pnpm test` ni `pnpm test:e2e`.
- Quand un bug est corrigé, le test qui l'aurait attrapé est ajouté. Un test doit échouer si le comportement est cassé (vérifier au besoin en cassant volontairement le code).
- Changement touchant la base : vérifier aussi sur un vrai Postgres (`DATABASE_URL=postgres://… node --import tsx --test <fichier>`), car PGlite et `pg` diffèrent (ex. `bigint` renvoyé en chaîne).

## Aucun appel payant dans les tests
- `pnpm test` neutralise Apify, OpenAI et `DATABASE_URL` (`artifacts/api-server/src/test/offline.ts`) : un test sans mock échoue au lieu de coûter de l'argent. `pnpm test:e2e` n'utilise aucun service externe.
- `pnpm test:prod` (vraies clés, ~0,02 € par lancement) **uniquement sur demande explicite** du propriétaire.

## Front : mobile d'abord
- L'usage principal est sur mobile : vérifier chaque changement d'interface en **mobile (390 px) puis desktop (1280 px)**, avec captures. Le test e2e de mise en page contrôle l'absence de défilement horizontal et des zones tactiles ≥ 32 px.
- Textes ≥ 12 px ; couleurs via les jetons du thème (`ink`, `stone`, `line`, `sage`, `brand`, `ok-*`…) ; vert réservé à « critère satisfait ».

## Branches et déploiement
- On pousse sur **`develop`** (ne déclenche pas de déploiement). **`main` déclenche un redéploiement Render** : fusion sur demande explicite, et seulement si tous les tests passent.
- Le suivi des features (faites / à faire) est dans `features/README.md`.
