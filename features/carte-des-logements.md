# Carte des logements (style Airbnb) — étude de faisabilité

Étude du 30/09/2026. **Verdict : jouable.** L'API renvoie des coordonnées pour chaque annonce, avec un champ qui dit si elles sont exactes ou approximatives.

## Preuve de concept (faite, branche `develop`)
- **Où** : encart « Où se trouve le logement » dans la fiche d'une annonce qui a des coordonnées.
  - Adresse exacte (`streetNumber`) ou rue (`street`, point placé dans la rue) : un point, et les trajets vers les lieux de vie.
  - Quartier (`district`) ou commune (`city`) : un **cercle** (600 m pour un quartier, 1,5 km pour une commune, d'après les écarts mesurés dans l'étude) avec la maison au centre, et les lieux de vie **sans trajet, sans ligne ni distance** (ils seraient faux).
- **Carte** : MapLibre GL + fond **OpenFreeMap** (style « positron », tuiles vectorielles OpenStreetMap, gratuit, sans clé ni plafond, usage commercial autorisé). Chargée à l'ouverture de la fiche seulement (≈ 280 ko compressés). Pastille ronde noire « maison » (sans prix) pour le logement, pastilles blanches à icône rose pour les lieux de vie. Gestes « deux doigts » sur mobile (la fiche défile normalement), crédit OpenStreetMap replié en « i ». Sans WebGL : message, la liste des lieux reste.
- **Écarté** : CARTO (les tuiles renvoient désormais un filigrane « API KEY REQUIRED »), tuiles OSM officielles (politique d'usage), Esri (compte requis en production).
- **Lieux de vie** : l'interprétation de la demande (1er appel LLM) extrait jusqu'à 3 lieux cités par une adresse ou un nom d'établissement (travail, école…), avec le moyen de transport mentionné (transports par défaut). Géocodés une fois par la Géoplateforme IGN (adresse, sinon lieu nommé ; une simple commune est refusée) et enregistrés dans les critères de la recherche en base. Un géocodeur en panne ne bloque jamais la recherche.
- **Trajets** (adresse exacte ou rue seulement) : Google Routes (`computeRoutes`), annonce → lieu, durée + distance + tracé réel (polyline). Transports : arrivée mardi 9 h (heure de Paris) ; voiture : sans trafic (tarif le plus bas). Calculés à l'ouverture de la fiche, gardés en base (table `travel_routes`, « pas d'itinéraire » compris), plafond de 150 vrais appels Google par jour (`GOOGLE_ROUTES_PER_DAY`). **Sans `GOOGLE_MAPS_API_KEY`, rien n'est demandé ni affiché** en durée : la carte montre les deux points reliés en pointillés et la distance à vol d'oiseau.
- **Base** : colonnes `lat`, `lng`, `geo_precision` sur `housing_listings` (migration 0003). Seules les nouvelles recherches ou les rafraîchissements ont des coordonnées.

## Pour activer les temps de trajet
Créer une clé Google Cloud avec l'**API Routes** activée (et restreinte à cette API), puis la poser dans la variable `GOOGLE_MAPS_API_KEY` du service Render. Aucun redéploiement de code nécessaire.

## Reste à faire
- Carte de la **liste** de résultats (toutes les annonces, pastilles de prix, zones approximatives en cercle).
- Vie privée : numéro de rue des particuliers affiché tel quel (à décider).
- Critère « à moins de 30 min du travail » (filtre / score), voir [criteres-de-trajet](criteres-de-trajet.md).
- Non vérifié en réel : réponse de Google (clé absente), extraction des lieux par le LLM (testée avec un faux LLM).

## Méthode
4 appels de l'acteur Apify `clearpath~leboncoin-api` (le même que l'appli), 10 annonces chacun, réponse brute complète (`clean=false`, aucun champ filtré) :
Rennes, Rennes ≤ 650 €, Rennes « meublé », Quimper. 40 annonces reçues, **27 uniques**. Coût total : **0,036 $** (0,009 $ par appel). L'échantillon est petit : les proportions sont indicatives.

## Ce que renvoie l'API (`location`)
- **Coordonnées** : `lat`, `lng` (et la même chose en GeoJSON, `feature`).
- **Précision** : `type` (= `origin_type`) vaut `streetNumber` (adresse exacte), `street` (rue sans numéro), `district` (quartier) ou `city` (commune). `source` vaut `address` ou `city`. `is_shape` est `true` quand le point représente une **zone** (quartier ou ville) et non une adresse.
- **Contexte** : `city`, `zipcode`, `department_name`, `region_name` et, pour les quartiers, `district` (ex. « Villejean »).
- **Autres indices** : `street_view_url` n'existe que pour les adresses exactes (et pointe sur les mêmes coordonnées) ; les `attributes` contiennent aussi des `district_*`.
- Aujourd'hui notre code jette tout cela : `apify.ts` ne garde que le nom de la ville (l. 151-152).

## Résultats sur les 27 annonces
| Précision | Nombre | Part |
|---|---|---|
| Numéro de rue exact (`streetNumber`) | 5 | 18 % |
| Rue sans numéro (`street`) | 5 | 18 % |
| Quartier (`district`) | 11 | 40 % |
| Commune (`city`) | 6 | 22 % |

- **La précision suit le type de vendeur** : les 17 annonces de **professionnels** sont toutes en quartier ou commune ; les 10 annonces de **particuliers** sont toutes en rue ou numéro de rue. (Hypothèse non confirmée : les agences envoient des flux, `district_resolution_type = integration_flux`.) Comme les pros dominent, **environ 60 % des points seront des zones**.
- **Les points approximatifs ne sont pas fixes** : 3 annonces « Rennes commune » donnent 3 points distincts, à 120–208 m l'un de l'autre et 450–545 m de la mairie ; dans un même quartier (Quimper centre-ville) les points s'écartent de 340 à 870 m. Ils ne se superposent donc pas, mais il ne faut **jamais les afficher comme une position exacte**.
- **Les points précis sont fiables** : 4 points vérifiés sur 4 (géocodage inverse adresse.data.gouv.fr) tombent à 5–12 m d'une vraie adresse, avec le bon code postal (les autres vérifications ont échoué pour cause de réseau, pas de résultat).

## Proposition d'affichage
- Annonce précise : pastille de prix (« 600 € ») sur la carte, comme Airbnb.
- Annonce approximative : cercle doux autour du point, avec la mention « Localisation approximative (quartier Villejean) ». Rayon à calibrer (environ 400 m pour un quartier, plus pour une commune).
- Sur mobile : bouton « Carte » qui bascule liste ↔ carte ; toucher une pastille met la carte de l'annonce en évidence.

## Ce qu'il faudrait faire
1. `apify.ts` : conserver `lat`, `lng`, `type`, `is_shape`, `district` au lieu de la ville seule.
2. Base : colonnes `lat`, `lng`, `location_precision`, `district` sur `housing_listings` (migration), puis spec OpenAPI, schémas zod et client régénérés.
3. Front : bibliothèque de carte (MapLibre GL JS ou Leaflet) avec un fond clair et neutre ; pastilles et cercles ; bascule liste/carte ; tests (composant + scénario navigateur mobile).
4. Aucun coût Apify en plus : les coordonnées sont déjà dans la réponse actuelle.

## Points à décider
- **Fond de carte** : choisir un fournisseur de tuiles (gratuit ou avec clé) et vérifier ses conditions d'usage avant de s'engager.
- **Nombre de résultats** : l'appli garde 5 annonces par recherche (`APIFY_RESULT_LIMIT`) ; une carte avec 5 points est pauvre.
- **Vie privée** : pour un particulier, l'API donne le numéro de rue. À voir si on l'affiche tel quel ou arrondi à la rue.
- Non testé : comportement sur des recherches plus larges (rayon), sur la vente, et sur d'autres régions.

L'échantillon brut n'est pas versionné (il reste dans l'environnement de la session).
