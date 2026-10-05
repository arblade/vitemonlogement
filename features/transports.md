# Transports en commun sur les cartes et station la plus proche

Étude et premier développement du 05/10/2026, branche **`transport`** (partie de `develop`). Prolonge
[carte-des-logements](carte-des-logements.md) et [criteres-de-trajet](criteres-de-trajet.md). **Verdict : les trois
demandes sont faisables sans Google et sans coût**, avec des données OpenStreetMap.

## Demande
1. Fond de carte : les petites icônes grises des stations (métro, tram, bus, gare).
2. Pour chaque annonce : le temps à pied jusqu'à l'arrêt de tram ou de métro le plus proche (« 10 min à pied »).
3. Sur chaque carte, en option : les lignes de tram et de métro, quand il y en a.
4. (2e demande, 05/10) Lignes dans leurs couleurs officielles, en traits continus ; arrêt de bus le plus proche ; vrai
   temps de marche avec OpenRouteService. Pas de « métro dans le quartier ».

## Sources de données examinées
| Source | Ce qu'elle donne | Coût / limites | Verdict |
|---|---|---|---|
| **Tuiles OpenFreeMap** (déjà notre fond, schéma OpenMapTiles) | couche `poi` : stations `railway` (`subway`, `tram_stop`, `station`, `halt`) et arrêts `bus` ; couche `transportation` : voies `transit` (`subway`, `tram`, `light_rail`), tunnels compris | gratuit, sans clé, déjà chargé. Voies de métro/tram et arrêts de tram **seulement à partir du zoom 14** ; pas de nom ni de couleur de ligne | **Retenu** pour 1 et 3 |
| **OpenStreetMap via Overpass** (relations `route=subway|tram|light_rail`) | 337 relations de lignes en France, leurs arrêts, leurs voies, nom (`ref`) et couleur officielle (`colour`) | gratuit, licence ODbL (citer OpenStreetMap). Serveurs publics lents ou saturés (504) : **pas en direct**, une fois pour fabriquer deux fichiers | **Retenu** pour les stations et les tracés (fichiers embarqués) |
| GTFS (transport.data.gouv.fr) | horaires et arrêts officiels, réseau par réseau | gratuit, mais des centaines de jeux à intégrer et suivre | Plus tard, si l'OSM manque de précision |
| Google Places / Routes | arrêt le plus proche, vrai trajet à pied | payant (Routes : 5 $ / 1 000 au-delà de 10 000 par mois) | Écarté (demande) |
| **OpenRouteService** (matrice à pied) | vrai temps de marche vers plusieurs arrêts en un appel | clé gratuite (plan Standard) : 500 matrices par jour | **Retenu** pour le temps de marche |

## Ce qui est fait (branche `transport`)
### 1. Stations grises sur le fond de carte
- Couches ajoutées au style OpenFreeMap après son chargement (`map-transit.ts`), sur la fiche et sur la carte des
  résultats : icônes rondes grises (métro « M », tram, gare) dès le zoom 13, nom de la station en gris au zoom 15 ;
  arrêts de bus plus petits et plus clairs à partir du zoom 15 (ils sont très nombreux).
- Aucune requête en plus : tout est déjà dans les tuiles. Si la source des tuiles manque (autre fournisseur), les
  stations ne sont pas ajoutées et la carte reste utilisable.

### 2. Accès à pied : station de métro ou de tram, et arrêt de bus les plus proches (2e étape, 05/10)
- **Candidats, sans appel payant** : les 3 stations de métro ou de tram les plus proches (base embarquée
  `stations.json`, 2 212 stations, à moins de 1,85 km) et les 3 arrêts de bus les plus proches (un par nom, à moins de
  800 m), lus **côté serveur dans les tuiles OpenFreeMap** de zoom 14 (les mêmes que le fond de carte, gratuites, sans
  clé ; tuiles gardées en mémoire, une ville ne les demande qu'une fois).
- **Vrai temps de marche : OpenRouteService** (`src/lib/access.ts`) : **une matrice par logement** (logement → les
  6 candidats, profil `foot-walking`), on garde le plus court de chaque sorte (ce peut être une autre station que la
  plus proche à vol d'oiseau). Adresse : `api.heigit.org/openrouteservice/v2/matrix` (l'ancienne
  `api.openrouteservice.org` est coupée depuis le 24/08/2026). Plafond quotidien `ORS_MATRIX_PER_DAY` (450 par défaut,
  sous les 500 matrices gratuites du plan Standard). Au-delà de 30 min à pied, rien n'est annoncé.
- **Quand** : juste après l'analyse IA d'une annonce à position précise (adresse exacte ou rue, y compris lue dans la
  description), 4 à la fois. Résultat gardé dans la table **`walk_access`** (migration 0011), clé = position arrondie à
  ~1 m, partagé entre recherches.
- **Repli** : sans clé ORS, plafond atteint ou ORS en panne, marche **estimée** (vol d'oiseau × 1,3 à 4,8 km/h),
  marquée comme telle et refaite quand ORS revient. Tuiles injoignables : rien n'est gardé, ce sera retenté. Les
  annonces déjà analysées avant ce changement gardent la station estimée, sans bus (pas de rattrapage).
- **Seulement pour une position précise** ; pas de « métro dans le quartier » pour les annonces placées au quartier
  ou à la commune (décidé le 05/10).
- **Affichage** : sur la carte d'annonce, « 9 min à pied · Métro Rihour [M1] » puis « 2 min à pied · Bus Colpin » ;
  « ≈ 12 min à pied » quand la marche est estimée. Dans la fiche, la distance (« 760 m à pied », ou « à vol d'oiseau ;
  temps de marche estimé ») et les deux arrêts repérés sur la carte.
- API : `nearestStop` et `nearestBusStop` de `HousingListing` (nom, position, distance, minutes, lignes, `estimated`).

### 3. Lignes de tram et de métro, en couleurs officielles (2e étape, 05/10)
- **Tracés OpenStreetMap** des lignes (`transit-lines.json`, fabriqué avec les stations par
  `pnpm --filter @workspace/api-server run data:transit`) : voies de chaque relation de ligne, allégées à 4 m près ;
  une entrée par ligne avec son nom (`ref`) et sa **couleur officielle** (`colour`), couleur du mode à défaut.
- **API** `GET /api/transit/lines?west&south&east&north` : les lignes de la zone affichée en GeoJSON (zone bornée à
  ~1,2°, mise en cache un jour par le navigateur). La carte demande la vue élargie d'un tiers de chaque côté, et
  redemande seulement si l'on sort de cette zone.
- **Dessin** : **traits continus** (plus de tirets, même en souterrain), liseré blanc, couleur de la ligne, nom le long
  du trait à partir du zoom 13, métro au-dessus du tram ; **à tous les zooms** (plus de limite au zoom 14).
- Interrupteur « Lignes tram · métro » en bas à gauche de chaque carte (fiche et carte des résultats), éteint par
  défaut, choix mémorisé sur l'appareil. Plus de légende : chaque ligne a sa couleur et son nom.

## Mise en service
- Créer un compte gratuit sur [account.heigit.org](https://account.heigit.org) (OpenRouteService, plan Standard),
  copier la clé, et la poser dans la variable **`ORS_API_KEY`** du service Render. Sans clé, tout fonctionne avec des
  temps estimés (« ≈ »).
- Optionnel : `ORS_MATRIX_PER_DAY` (plafond, 450), `ORS_BASE_URL`, `OPENFREEMAP_URL`.

## Limites et suites possibles
- **Lignes qui partagent des voies** (tronc commun de deux trams) : les traits se superposent, la dernière ligne
  dessinée cache l'autre sur le tronçon commun.
- **Arrêts de bus** : tous les arrêts nommés d'OpenStreetMap, sans savoir si la ligne est fréquente ; pas de numéro de
  ligne (les tuiles ne l'ont pas).
- **Fraîcheur** : stations et tracés figés à leur fabrication (05/10/2026) ; à relancer quand une ligne ouvre.
- Annonces analysées avant ce changement : station estimée, sans bus (un rattrapage en tâche de fond est possible).
- Critère « à moins de N min d'un métro » (filtre, score) : pas fait.

## Tests
- Serveur : `stations.test.ts` (lignes, marche estimée, plus proche, base réelle) ; `transit-lines.test.ts` (zone,
  GeoJSON, couleurs, zone refusée, base réelle : Lille, Paris) ; `access.test.ts` (tuile vectorielle encodée pour le
  test, arrêts de bus dédoublonnés, matrice ORS, repli estimé sans clé / en panne / plafond, cache et nouveau calcul) ;
  `map.test.ts` (l'API renvoie l'estimation, puis la vraie marche et le bus une fois en base, rien pour une commune).
- Front : `map-transit.test.ts` (couches, traits pleins, couleur par ligne, zone demandée, rechargement au
  déplacement, style sans tuiles ou sans police), `listing-map.test.tsx` (métro et bus dans la fiche, « ≈ »,
  interrupteur), `search-detail.test.tsx` (métro puis bus sur la carte d'annonce).
- Navigateur (`e2e/app.e2e.mjs`, mobile puis desktop) : métro et bus sur la carte d'annonce et dans la fiche, repères,
  station estimée pour une annonce non calculée, lignes servies par l'API, interrupteur sur la fiche et sur la carte
  des résultats. Aucun service extérieur (OpenFreeMap et ORS coupés, accès de l'annonce 1 déjà en base).

## Captures
`maquettes/transport-*` (mobile 390 px et desktop 1280 px, vrai fond OpenFreeMap) : `carte-annonce` (ligne « 10 min à
pied · Métro Rihour M1 »), `fiche-station` (stations grises, repère Rihour), `fiche-lignes` (lignes allumées, métro
souterrain en tirets). La carte des résultats en desktop n'a pas pu être capturée dans l'environnement de test (rendu
WebGL logiciel trop lent) ; le test navigateur la vérifie en mobile et en desktop.

Données © les contributeurs d'OpenStreetMap, licence ODbL (déjà crédité sur la carte).
