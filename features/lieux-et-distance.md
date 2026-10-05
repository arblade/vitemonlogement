# Lieux repères et distance (aéroport, gare, hôpital…)

**Statut : fait le 05/10/2026 (develop).** Cas signalé par un utilisateur : « une maison à moins de 30 min de l'aéroport de Rennes ».
Avant, ce lieu n'était pas reconnu (`places` vide), la contrainte restait un souhait jamais confirmé, et la recherche
restait centrée sur la ville (rayon de 5 km) alors que l'aéroport est à ~7 km.

## Ce que fait l'app
1. **Lecture de la demande** (`ai.ts`) : un lieu repère (aéroport, gare, hôpital, campus, centre commercial…) devient un
   lieu avec ses contraintes `maxKm` (distance à vol d'oiseau) et/ou `maxMinutes` (durée de trajet, voiture par défaut,
   ou le moyen dit explicitement), et `centered`.
2. **Deux sens, tranchés par le LLM d'après la formulation** :
   - `centered: false` — « **à Rennes**, à moins de 30 min de l'aéroport » : double contrainte, la ville reste un critère ;
   - `centered: true` — « **autour de** l'aéroport de Rennes » : la recherche se centre sur le lieu, la ville n'est plus
     un critère (le lieu la remplace).
3. **Géocodage** (`lib/geocode.ts`, `geocodeLandmark`) : index `poi` de l'IGN (nom seul : ajouter la ville à la requête
   le fait échouer) → adresse précise IGN → **Nominatim** (OpenStreetMap) en dernier recours. Garde-fous : chaque mot du
   nom demandé doit se retrouver dans le nom, la catégorie ou la commune du résultat ; quartiers, lieux-dits et parkings
   écartés (« Sud Gare » n'est pas la gare) ; Nominatim n'est cru que pour de vrais équipements (aérodrome, gare,
   hôpital, université, école, mairie, centre commercial, stade…), jamais un arrêt de bus, et la ville recherchée doit
   figurer dans l'adresse. Introuvable → null, le lieu reste sans coordonnées (rien ne bloque la recherche).
4. **Zone lue chez Le Bon Coin** (`housing-search.ts`, `searchZone`) : centrée → cercle autour du lieu (sa distance, sinon
   le rayon demandé) ; double contrainte → **le plus petit des deux cercles** (tout logement qui respecte les deux est
   dans chacun d'eux), l'autre contrainte étant vérifiée annonce par annonce. Plafond 200 km, comme le rayon.
5. **Vérification par annonce** (`lib/distance.ts`, critère `distance-<lieu>` ajouté par `withPlaceChecks`) :
   - distance : ligne droite, qui ne peut que sous-estimer le trajet → « trop loin » est sûr ;
   - durée : **estimée** (détour ×1,3, vitesses moyennes voiture 45, transports 25, vélo 15, marche 4,5 km/h), tranchée
     seulement hors de la zone d'incertitude (confirmé sous 80 % de la durée demandée, refusé au-delà de 125 %), sinon
     « À vérifier » ;
   - position approximative (quartier, commune) : marge de 2 km ; sans position : « À vérifier » ;
   - recalculé quand la position est lue dans la description (`analyzeListings`) ; **jamais envoyé au LLM**.

## Compléments du 05/10 au soir (essais réels de l'API IGN)
- **Grands aéroports** (`lib/airports.ts`, consultée avant l'IGN, sans appel réseau) : l'index des lieux de l'IGN se trompe
  sur les cas les plus courants. « Aéroport de Lyon » → **Lyon-Bron** (aviation d'affaires), alors que tout le monde entend
  Saint-Exupéry, à ~17 km, qui n'y existe que comme « lieu-dit habité » (catégorie écartée) ; « aéroport de Paris » →
  **Le Bourget** en premier, à égalité de score avec Roissy et Orly ; « aéroport Nantes » (sans « de ») → rien. Table de
  16 aéroports (coordonnées et communes de l'IGN) : noms propres (Roissy, CDG, Orly, Saint-Exupéry, Mérignac, Blagnac…),
  villes desservies, et « l'aéroport » tout court = celui de la ville recherchée. **« Aéroport de Paris » reste ambigu :
  rien n'est placé** (le lieu s'affiche « adresse introuvable », le critère reste « À vérifier ») plutôt que Le Bourget.
- **Ville vide** (`routes/housing/anchor.ts`, `placeCriteria`) : quand le LLM ne comprend aucune ville (2 fois sur 3 sur la
  demande signalée), la ville vient du lieu repère (ville desservie par l'aéroport, sinon commune du lieu) et la recherche
  est centrée dessus, au lieu d'échouer avec « Indiquez une ville ».
- **Ville citée seulement dans le nom du lieu** (« …de l'aéroport de Rennes ») : ce n'est pas une contrainte de ville. Si le
  LLM ne met pas `centered`, le code le fait (`cityOnlyNamesPlace`) : la recherche couvre ~17 km autour de l'aéroport
  (30 min en voiture) au lieu de 5 km autour du centre de Rennes (sans Bruz, Chavagne…). « À Rennes, à moins de 30 min de
  l'aéroport » garde la double contrainte. Le prompt d'interprétation le dit aussi.
- Mesures IGN (05/10) : bien placés par l'index des lieux : aéroports de Rennes, Nantes (avec « de »), Toulouse, Nice,
  Lille, Strasbourg, Montpellier, Brest, Marseille ; gare de Nantes. Filtre utile non utilisé : `category=aérodrome` +
  `depcode`. « CHU Brest » ne trouve que des stations de tram (Nominatim prend le relais en production).

## Choix
- Nominatim seulement en secours : politique d'usage (1 requête/s, User-Agent) et résultats moins fiables sur les gares ;
  l'IGN suffit pour la plupart des lieux. Volume négligeable (une requête au plus par lieu et par recherche).
- Les annonces dont le critère est « Ne correspond pas » restent affichées (comme pour les autres critères), avec le
  score réduit ; elles ne sont pas masquées.

## Limites connues, à faire
- **Durées réelles** : la clé Google (`travel.ts`) permettrait de trancher les « À vérifier » ; non branché (coût).
- **Format d'URL Le Bon Coin non vérifié en réel** pour un centre hors de la commune (nom et code postal de la ville
  gardés, coordonnées et rayon du lieu) : à contrôler avec `pnpm test:prod` (payant, sur demande du propriétaire).
- Plusieurs lieux repères : le plus serré fixe la zone ; au plus 3 lieux par demande.
- « Près d'un aéroport » sans nom précis (sans lieu cité) n'est pas géré.
- Pas de capture d'écran : seul un libellé de pastille de critère change (composant existant, vérifié sans débordement
  ni zone tactile < 32 px, mobile puis desktop, par le test navigateur).

## Tests
`lib/distance.test.ts`, `lib/geocode.test.ts` (lieux repères), `lib/airports.test.ts`, `routes/housing/anchor.test.ts`, `routes/housing/lieux-et-distance.test.ts` (extraction,
zone, critères, jamais de LLM, bout en bout « autour de », « à Lille et à moins de » et ville vide), `e2e/app.e2e.mjs` (pastille de
proximité, mobile puis desktop). Essais réels (IGN et Nominatim, sans clé) du 05/10 : aéroport de Rennes, aéroport Nantes
Atlantique, gare Lille Flandres, gare de Rennes, CHU de Rennes (via Nominatim) tous bien placés.
