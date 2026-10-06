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

## Choix
- Nominatim seulement en secours : politique d'usage (1 requête/s, User-Agent) et résultats moins fiables sur les gares ;
  l'IGN suffit pour la plupart des lieux. Volume négligeable (une requête au plus par lieu et par recherche).
- Les annonces dont le critère est « Ne correspond pas » restent affichées (comme pour les autres critères), avec le
  score réduit ; elles ne sont pas masquées.

## Essai réel du 06/10 (`pnpm test:prod`, ≈ 0,05 € au total) : deux défauts trouvés et corrigés
Le premier essai (zone centrée sur l'aéroport) a ramené des annonces de Rennes centre : Le Bon Coin ne lisait que la commune.
Lectures directes de l'acteur (10 annonces, plafond 0,02 $) :
- **Format de l'URL** : `locations=Nom_CP__lat_lng_rayonVille_rayonChoisi`, **deux nombres** à la fin. L'app n'en envoyait
  qu'un : le **rayon était ignoré** (seule la commune ressortait, même à 30 km) et les **villes à trait d'union**
  (Aix-en-Provence, Saint-Étienne, Saint-Jacques-de-la-Lande…) **ne renvoyaient aucune annonce**. Avec deux nombres : Rennes à
  30 km ramène Le Rheu, Orgères, Janzé ; Aix-en-Provence ramène Fuveau, Ventabren…
- **Conséquence pour toutes les recherches** : le rayon (5 km par défaut) est désormais honoré, donc les communes voisines
  entrent dans les résultats, comme prévu à l'origine ; et les villes à trait d'union fonctionnent.
- **Zone centrée hors de la commune** : le nom envoyé est celui de la commune la plus proche du centre (`nearestCommune`).
  Essai final : « autour de l'aéroport de Rennes, à moins de 5 km » → 14 annonces à Bruz, Rennes, Orgères, Le Rheu ; les
  annonces à position précise sont à 5,3–6,2 km de l'aéroport (positions floues d'environ 1 km), et non autour du centre de Rennes.

## Limites connues, à faire
- **Durées réelles** : la clé Google (`travel.ts`) permettrait de trancher les « À vérifier » ; non branché (coût).
- Plusieurs lieux repères : le plus serré fixe la zone ; au plus 3 lieux par demande.
- « Près d'un aéroport » sans nom précis (sans lieu cité) n'est pas géré.
- Pas de capture d'écran : seul un libellé de pastille de critère change (composant existant, vérifié sans débordement
  ni zone tactile < 32 px, mobile puis desktop, par le test navigateur).

## Tests
`lib/distance.test.ts`, `lib/geocode.test.ts` (lieux repères), `routes/housing/lieux-et-distance.test.ts` (extraction,
zone, critères, jamais de LLM, bout en bout « autour de » et « à Lille et à moins de »), `e2e/app.e2e.mjs` (pastille de
proximité, mobile puis desktop). Essais réels (IGN et Nominatim, sans clé) du 05/10 : aéroport de Rennes, aéroport Nantes
Atlantique, gare Lille Flandres, gare de Rennes, CHU de Rennes (via Nominatim) tous bien placés.
