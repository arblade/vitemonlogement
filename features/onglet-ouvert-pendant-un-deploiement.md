# « L'application a rencontré une erreur » en cliquant sur « Carte » (05/10/2026)

**Signalé** : depuis la page de résultats, le bouton « Carte » affiche l'écran d'erreur.

## Diagnostic
- Journaux Render : aucune erreur applicative, `/api/transit/lines` répond 200. Le serveur n'est pas en cause.
- **Cause : un onglet resté ouvert pendant un déploiement.** Le front est découpé en fichiers à nom unique (`results-map-canvas-CUi1YzLS.js`…),
  chargés à la demande (la carte, la fiche). Chaque déploiement remplace ces fichiers (5 le 05/10, dont un à 18:38). Un onglet
  ouvert avant garde l'ancienne version de l'appli et réclame, au clic sur « Carte », un fichier qui n'existe plus.
- **Ce qui aggravait** : le serveur répondait à ce fichier introuvable par la page d'accueil, en **HTTP 200 `text/html`**
  (vérifié sur la production : un ancien nom de fichier renvoie 200 text/html ; le fichier actuel est bien servi en
  `text/javascript`). Le navigateur ne peut pas charger du HTML comme module : le chargement échoue, l'`ErrorBoundary` s'affiche.
- Non prouvé pour ce cas précis (pas de trace côté navigateur), mais tout concorde ; le même clic sur la version à jour fonctionne
  (scénario navigateur, avec le vrai fond de carte).

## Corrections
1. **Serveur** (`app.ts`) : un fichier introuvable (`/assets/…` ou tout chemin avec extension) répond **404** avec un texte, plus la
   page d'accueil. Les routes de l'appli (`/searches/12`, `/favoris`…) retombent toujours sur l'accueil.
2. **Front** (`lib/stale-build.ts`, `main.tsx`) : sur l'événement Vite `vite:preloadError` (fichier à la demande introuvable),
   la page se **recharge une fois** pour récupérer la version en ligne. Pas de boucle : au-delà d'une relance en 30 s, l'erreur s'affiche.
   Stockage indisponible : pas de relance (on ne peut pas garantir l'absence de boucle).
3. **Écran d'erreur** (`error-boundary.tsx`) : en français (« L'application a rencontré une erreur »), avec « Recharger la page » en bouton
   principal et « Réessayer ».

L'onglet déjà ouvert avec l'ancienne version ne bénéficie pas de la correction (il ne la contient pas) : **recharger la page une fois**
(Ctrl+Maj+R) suffit. À partir de la version corrigée, ce cas se règle tout seul à chaque déploiement.

## Tests
`routes/fichiers-statiques.test.ts` (ancien fichier → 404 et pas de HTML, fichier actuel servi, routes de l'appli sur l'accueil, API intacte),
`lib/stale-build.test.ts` (une relance, pas de boucle, nouvelle version plus tard, stockage indisponible), `e2e/app.e2e.mjs` (ancien
fichier de la carte servi en HTML : la page se recharge une fois et la carte s'ouvre ; si ça persiste : erreur en français, deux boutons, pas
de boucle). Vérifié en retirant chaque correction : le test correspondant échoue.
