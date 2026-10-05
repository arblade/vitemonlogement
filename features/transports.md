# Transports en commun sur les cartes et station la plus proche

Étude et premier développement du 05/10/2026, branche **`transport`** (partie de `develop`). Prolonge
[carte-des-logements](carte-des-logements.md) et [criteres-de-trajet](criteres-de-trajet.md). **Verdict : les trois
demandes sont faisables sans Google et sans coût**, avec des données OpenStreetMap.

## Demande
1. Fond de carte : les petites icônes grises des stations (métro, tram, bus, gare).
2. Pour chaque annonce : le temps à pied jusqu'à l'arrêt de tram ou de métro le plus proche (« 10 min à pied »).
   Le bus viendra plus tard.
3. Sur chaque carte, en option : les lignes de tram et de métro, quand il y en a.

## Sources de données examinées
| Source | Ce qu'elle donne | Coût / limites | Verdict |
|---|---|---|---|
| **Tuiles OpenFreeMap** (déjà notre fond, schéma OpenMapTiles) | couche `poi` : stations `railway` (`subway`, `tram_stop`, `station`, `halt`) et arrêts `bus` ; couche `transportation` : voies `transit` (`subway`, `tram`, `light_rail`), tunnels compris | gratuit, sans clé, déjà chargé. Voies de métro/tram et arrêts de tram **seulement à partir du zoom 14** ; pas de nom ni de couleur de ligne | **Retenu** pour 1 et 3 |
| **OpenStreetMap via Overpass** (relations `route=subway|tram|light_rail`) | 337 lignes en France, leurs arrêts, nom (`ref`) et couleur officielle (`colour`) | gratuit, licence ODbL (citer OpenStreetMap). Serveurs publics lents ou saturés (504) : **pas en direct**, une fois pour fabriquer un fichier | **Retenu** pour 2 (fichier embarqué) |
| GTFS (transport.data.gouv.fr) | horaires et arrêts officiels, réseau par réseau | gratuit, mais des centaines de jeux à intégrer et suivre | Plus tard, si l'OSM manque de précision |
| Google Places / Routes | arrêt le plus proche, vrai trajet à pied | payant (Routes : 5 $ / 1 000 au-delà de 10 000 par mois) | Écarté (demande) |
| Itinéraire piéton gratuit (OpenRouteService, Valhalla FOSSGIS) | vrai temps de marche | ORS : clé gratuite, 2 000 trajets/jour ; FOSSGIS : usage modéré seulement | Option future pour affiner |

## Ce qui est fait (branche `transport`)
### 1. Stations grises sur le fond de carte
- Couches ajoutées au style OpenFreeMap après son chargement (`map-transit.ts`), sur la fiche et sur la carte des
  résultats : icônes rondes grises (métro « M », tram, gare) dès le zoom 13, nom de la station en gris au zoom 15 ;
  arrêts de bus plus petits et plus clairs à partir du zoom 15 (ils sont très nombreux).
- Aucune requête en plus : tout est déjà dans les tuiles. Si la source des tuiles manque (autre fournisseur), rien
  n'est ajouté et la carte reste utilisable.

### 2. Station de métro ou de tram la plus proche, à pied
- **Base** : `artifacts/api-server/src/data/stations.json`, fabriquée par `pnpm --filter @workspace/api-server run
  data:stations` (Overpass ; `OVERPASS_URL` pour changer de serveur). Seuls les arrêts **desservis par une ligne** de
  métro ou de tram sont gardés (pas de trains touristiques ni d'arrêts abandonnés) ; quais et arrêts d'une même station
  (même nom, à moins de 300 m) fusionnés ; chaque station garde ses lignes et leurs couleurs. Comme `communes.json` :
  en mémoire, pas de table ni de migration, aucun appel au moment de la recherche.
- **Calcul** (`src/lib/stations.ts`) : à l'envoi de chaque annonce au navigateur, station la plus proche à vol
  d'oiseau ; marche **estimée** = distance × 1,3 (les rues ne sont pas droites) à 4,8 km/h (80 m/min). Au-delà de
  1,85 km (≈ 30 min estimées), aucune station n'est annoncée.
- **Seulement pour une position précise** (adresse exacte ou rue, y compris lue dans la description). Depuis un
  quartier ou une commune, le point peut être à 900 m du vrai logement : un « 10 min à pied » serait faux.
- **Affichage** : sur la carte d'annonce, « 12 min à pied · Métro Gambetta [M1] » (lignes dans leurs couleurs) ; dans
  la fiche, la même ligne avec « 720 m à vol d'oiseau ; temps de marche estimé, sans itinéraire » et la station repérée
  sur la carte.
- API : champ `nearestStop` de `HousingListing` (nom, position, distance, minutes, lignes).

### 3. Lignes de tram et de métro, en option
- Interrupteur « Lignes tram · métro » en bas à gauche de chaque carte (fiche et carte des résultats), éteint par
  défaut, choix mémorisé sur l'appareil. Allumé : voies de métro en bleu, de tram en violet, tunnels en tirets, et une
  légende.
- Les tuiles n'ont ces voies qu'à partir du zoom 14 : dans la fiche, allumer les lignes sur une carte plus éloignée
  la rapproche au zoom 14 (la carte des résultats ne bouge pas, les logements sortiraient du cadre) ; si l'on dézoome ensuite, la légende dit « Zoomez pour voir les lignes ».

## Limites et suites possibles
- **Marche estimée, pas calculée** : en ville, l'erreur est de l'ordre de ± 2 à 3 min ; elle peut être plus forte
  avec une coupure (voie ferrée, fleuve, rocade). Affinage possible : calculer la vraie marche vers les 2 ou 3 stations
  les plus proches avec OpenRouteService (clé gratuite, 2 000 par jour) et la garder en base, comme les trajets Google.
- **Annonces d'agence placées au quartier** (≈ 60 % des annonces) : pas de station annoncée. Possible : « métro dans
  le quartier » si une station est dans le cercle, sans temps de marche.
- **Couleurs des lignes sur la carte** : les tuiles ne les ont pas. Possible : servir les tracés des lignes (relations
  OSM, avec couleur et nom) depuis notre serveur pour la zone affichée, ce qui donnerait aussi les lignes en dessous du
  zoom 14.
- **Bus** : les arrêts sont déjà sur le fond de carte ; pour « arrêt de bus le plus proche », il faudrait une base
  beaucoup plus grosse (des dizaines de milliers d'arrêts) et filtrer les lignes peu fréquentes.
- **Fraîcheur** : la base est figée au moment de sa fabrication (05/10/2026) ; à relancer quand une ligne ouvre.
- Critère « à moins de N min d'un métro » (filtre, score) : pas fait.

## Tests
- Serveur : `src/lib/stations.test.ts` (lignes, marche estimée, plus proche, plafond, base réelle : Lille, Bordeaux,
  Paris, campagne) ; `map.test.ts` (l'API renvoie la station pour l'adresse exacte, rien pour une commune).
- Front : `map-transit.test.ts` (couches, filtres, visibilité, style sans source ou sans police), `listing-map.test.tsx`
  (station dans la fiche, interrupteur et légende, invitation à zoomer), `search-detail.test.tsx` (ligne sur la carte).
- Navigateur (`e2e/app.e2e.mjs`, mobile puis desktop) : station sur la carte d'annonce et dans la fiche, couches
  transport posées, interrupteur des lignes sur la fiche et sur la carte des résultats.

## Captures
`maquettes/transport-*` (mobile 390 px et desktop 1280 px, vrai fond OpenFreeMap) : `carte-annonce` (ligne « 10 min à
pied · Métro Rihour M1 »), `fiche-station` (stations grises, repère Rihour), `fiche-lignes` (lignes allumées, métro
souterrain en tirets). La carte des résultats en desktop n'a pas pu être capturée dans l'environnement de test (rendu
WebGL logiciel trop lent) ; le test navigateur la vérifie en mobile et en desktop.

Données © les contributeurs d'OpenStreetMap, licence ODbL (déjà crédité sur la carte).
