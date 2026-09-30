# Vite mon logement

Application web qui aide à trier rapidement des annonces de location selon des critères libres : prix, surface, localisation, mais aussi tout ce que l'utilisateur veut (« chat accepté », « calme »…). Les annonces viennent de Leboncoin (via Apify) ; l'IA vérifie chaque critère et cite le passage exact de l'annonce qui le prouve. Ce qui n'est pas prouvé reste « à vérifier », jamais « faux ».

## Organisation

| Dossier | Rôle |
| --- | --- |
| `artifacts/logiscope` | Front (React, Vite, Tailwind) |
| `artifacts/api-server` | API Express + worker de recherches |
| `lib/db` | Schéma Drizzle et migrations (`lib/db/drizzle`) |
| `lib/api-spec` | Contrat OpenAPI ; `codegen` génère `api-zod` et `api-client-react` |
| `reports` | Rapports d'évaluation ponctuels |
| `docs` | Notes techniques (schéma de l'acteur Apify) |

## Commandes

```sh
pnpm install
pnpm run typecheck                                  # tous les paquets
pnpm --filter @workspace/api-server run test        # tests (sans réseau ni secret)
pnpm --filter @workspace/db run generate            # nouvelle migration après un changement de schéma
pnpm --filter @workspace/api-spec run codegen       # après un changement de openapi.yaml
```

Développement : `PORT=8080 pnpm --filter @workspace/api-server run dev` (API, base locale PGlite dans `.data/`) et
`PORT=5173 pnpm --filter @workspace/logiscope run dev` (front ; `/api` est relayé vers `API_PROXY_TARGET`, défaut `http://localhost:8080`).
Toutes les variables d'environnement sont décrites dans `.env.example`.

## Fonctionnement

- **Base de données** : Postgres en production (`DATABASE_URL`, Neon), PGlite (un vrai Postgres embarqué) en local et dans les tests. Un seul schéma Drizzle ; les migrations s'appliquent au démarrage du serveur. La migration de base est idempotente : elle adopte les tables déjà créées avant Drizzle.
- **Worker** : une boucle dans le processus de l'API fait avancer les recherches (interprétation, run Apify, analyse IA), même sans navigateur ouvert. Les verrous sont des baux en base (`lock_owner`, `lock_until`) : un redémarrage ou une seconde instance ne double jamais le travail, et un bail expiré permet la reprise. Une étape en échec est retentée 3 fois, puis la recherche passe en échec.
- **Cache d'analyse** : une annonce déjà analysée n'est plus envoyée au LLM (table `listing_analyses`, clé = URL de l'annonce + version d'analyse). Seuls les critères jamais posés le sont. **Après toute modification du prompt ou du modèle d'analyse, incrémenter `ANALYSIS_VERSION`** (`routes/housing/ai.ts`) : les annonces seront ré-analysées à la prochaine recherche qui les rencontre.
- **Accès** : mot de passe partagé (`APP_PASSWORD`), session par cookie signé httpOnly. Sans `APP_PASSWORD`, l'API métier répond 503 en production (et reste ouverte en développement).
- **Quotas** sur les actions coûteuses (création, rafraîchissement, interprétation, analyse) : par IP et par heure (40), par session et par heure (30), global par jour (300), réglables par variables d'environnement. Sur Render, `TRUST_PROXY=1` permet de lire l'IP réelle du client (`X-Forwarded-For`), sinon tous les visiteurs partageraient celle du proxy. Les compteurs sont en base.
- **Apify** : jamais appelé depuis le navigateur ; `APIFY_RESULT_LIMIT` (5 par défaut) borne les annonces conservées par appel, y compris en production.
- Les annonces aimées et consultées sont enregistrées dans le navigateur (`localStorage`), sans compte.
