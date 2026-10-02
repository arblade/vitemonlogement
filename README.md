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
pnpm test                                           # serveur (node:test) + front (Vitest), sans réseau ni secret
pnpm test:e2e                                       # navigateur (Playwright), mobile puis desktop, sans service externe
pnpm --filter @workspace/api-server test:veille     # simulation de la veille quotidienne sur 10 jours (≈ 20 s)
pnpm test:prod                                      # vrais Apify/OpenAI (≈ 0,02 €), sur demande seulement
pnpm --filter @workspace/db run generate            # nouvelle migration après un changement de schéma
pnpm --filter @workspace/api-spec run codegen       # après un changement de openapi.yaml
pnpm --filter @workspace/api-server mail:test --preview <dossier>   # e-mails d'exemple en HTML, sans envoi
pnpm --filter @workspace/api-server mail:test vous@exemple.fr        # e-mail d'essai (RESEND_API_KEY requise)
```

Règles de travail (tests à chaque changement, mobile d'abord, branches) : `CLAUDE.md`. Suivi des fonctionnalités :
`features/README.md`.

Développement : `PORT=8080 pnpm --filter @workspace/api-server run dev` (API, base locale PGlite dans `.data/`) et
`PORT=5173 pnpm --filter @workspace/logiscope run dev` (front ; `/api` est relayé vers `API_PROXY_TARGET`, défaut `http://localhost:8080`).
Toutes les variables d'environnement sont décrites dans `.env.example`.

## Fonctionnement

- **Déploiement** : Render (`render.yaml`), un seul service web (API, worker et front compilé) ; un push sur `main` redéploie, `develop` non.
- **Base de données** : Postgres en production (`DATABASE_URL`, Neon), PGlite (un vrai Postgres embarqué) en local et dans les tests. Un seul schéma Drizzle ; les migrations s'appliquent au démarrage du serveur. La migration de base est idempotente : elle adopte les tables déjà créées avant Drizzle.
- **Worker** : une boucle dans le processus de l'API (toutes les 3 s) fait avancer les recherches (interprétation, run Apify, analyse IA), lance les relèves de veille et envoie les e-mails, même sans navigateur ouvert. Les verrous sont des baux en base (`lock_owner`, `lock_until`) : un redémarrage ou une seconde instance ne double jamais le travail, et un bail expiré permet la reprise. Une étape en échec est retentée 3 fois, puis la recherche passe en échec.
- **Cache d'analyse** : une annonce déjà analysée n'est plus envoyée au LLM (table `listing_analyses`, clé = URL de l'annonce + version d'analyse). Seuls les critères jamais posés le sont. **Après toute modification du prompt ou du modèle d'analyse, incrémenter `ANALYSIS_VERSION`** (`routes/housing/ai.ts`) : les annonces seront ré-analysées à la prochaine recherche qui les rencontre.
- **Comptes** : inscription sur invitation (lien `/?invite=CODE`, le code est `APP_PASSWORD`), puis connexion par e-mail et mot de passe (scrypt) ; session par cookie signé httpOnly (`SESSION_SECRET`), 30 jours. « Mot de passe oublié ? » envoie un lien signé, valable 1 heure et à usage unique (rien n'est stocké : la signature couvre l'empreinte du mot de passe). Chaque recherche, veille et favori appartient à un compte ; la recherche d'un autre compte répond 404. Sans `APP_PASSWORD`, l'API métier répond 503 en production (et un compte local unique est utilisé en développement). Secours : `user:reset-password <email> <mot-de-passe>`.
- **Quotas** sur les actions coûteuses (création, rafraîchissement, interprétation, analyse) : par IP et par heure (40), par session et par heure (30), global par jour (300), réglables par variables d'environnement. Sur Render, `TRUST_PROXY=1` permet de lire l'IP réelle du client (`X-Forwarded-For`), sinon tous les visiteurs partageraient celle du proxy. Les compteurs sont en base.
- **Apify** : jamais appelé depuis le navigateur ; seul Le Bon Coin est interrogé (SeLoger et PAP branchés mais désactivés, `ACTIVE_EXTRA_SOURCES` dans `sources.ts`) ; recherche ponctuelle : les 15 annonces les plus récentes (`ONE_SHOT_LIMIT`) ; veille quotidienne : Le Bon Coin lu page par page (35 annonces), 4 jours en arrière et 3 pages au plus (`LIVE_SEARCH_DAYS`, `READ_MAX_PAGES`) ; l'IA analyse les 20 premières (`FIRST_ANALYSIS`), les autres 20 par 20 quand elles s'affichent.
- **Veille quotidienne** (une par compte) : le worker relit Le Bon Coin aux heures choisies (8 h et 18 h par défaut, heure de Paris), de la page 1 jusqu'au curseur (la mise à jour la plus récente déjà lue), sans relire les pages des relèves précédentes ; débit observé par créneau pour lire juste ce qu'il faut ; relèves étalées de 0 à 5 minutes (`WATCH_SPREAD_SECONDS`) ; pause après 7 jours sans visite. Détails : `features/suivi-quotidien.md`.
- **E-mails** (Resend, `RESEND_API_KEY`) : récapitulatif à chaque relève qui trouve du nouveau, veille en pause, mot de passe oublié, alerte d'exploitation (`ALERT_EMAIL`). File d'envoi en base (`mail_outbox`), reprises, jamais deux fois le même e-mail ; désinscription en un clic. Sans clé, rien ne part (journaux seulement). Mise en service : `features/alerte-mail.md`.
- **Carte et trajets** : position des annonces (adresse, rue, ou voie lue dans la description et géocodée par l'IGN) ; temps de trajet vers les lieux cités dans la demande si `GOOGLE_MAPS_API_KEY` est posée (plafond quotidien `GOOGLE_ROUTES_PER_DAY`).
- **Navigateur** : les favoris sont en base, par compte ; seules les annonces déjà consultées (grisées) sont gardées dans le navigateur (`localStorage`).
