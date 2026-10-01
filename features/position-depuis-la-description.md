# Étude : placer sur la carte les annonces d'agences sans adresse (01/10/2026)

Question : beaucoup d'annonces n'ont ni adresse exacte ni rue sur Le Bon Coin (donc absentes de la carte des
résultats). Peut-on retrouver une position à partir de la **description** (rue, quartier, repère), et quelles API en
ligne aideraient ? Étude **mesurée** sur 300 annonces réelles (Lille, Rennes, Nantes, Lyon, Bordeaux, 60 chacune,
acteur `fatihtahta`, 0,3 $), IA gpt-5-mini (0,16 $), géocodeurs et API ADEME réels. Aucun code de l'app modifié.

## 1. Le constat

| Précision donnée par Le Bon Coin | Annonces | Qui publie |
|---|---|---|
| Adresse exacte (`streetNumber`) | 65 (22 %) | 52 particuliers, 13 agences |
| Rue (`street`) | 23 (8 %) | 20 particuliers, 3 agences |
| **Quartier (`district`)** | **199 (66 %)** | **100 % agences** |
| **Commune (`city`)** | **13 (4 %)** | **100 % agences** |

**71 % des annonces n'ont pas de position précise, et ce sont toutes des annonces d'agences** : aucun particulier
n'est dans ce cas. Seules 29 % apparaissent aujourd'hui sur la carte des résultats. Leur description est longue
(médiane 1 126 caractères) : une agence masque l'adresse dans le champ de position, pas toujours dans le texte.

## 2. Ce que disent les descriptions (212 annonces sans position précise)

Lecture par l'IA avec **citation exacte vérifiée** dans le texte (même principe que le tri des chambres) :

| Ce que le texte donne | Annonces | Exemples réels |
|---|---|---|
| **Voie + numéro** (adresse exacte) | 36 (17 %) | « 21 quai des Salinières », « Adresse : 31 rue de Lajaunie, 33100 Bordeaux », « 11 rue du Capitaine Ferber » |
| **Voie seule** | 81 (38 %) | « rue Lavoisier, en plein cœur du quartier Vauban », « rue de Marquillies à Lille » |
| Repère seulement (métro, gare, place, parc) | 68 (32 %) | « à deux pas de la place de la Victoire », « TRAM B (arrêt St Nicolas) » |
| Rien d'exploitable | 25 (12 %) | |

Donc **55 % citent une voie** (adresse du bien), que Le Bon Coin n'a pas retenue. Le quartier, lui, est déjà fourni
par Le Bon Coin dans 94 % des cas (il ne se lit presque jamais en plus dans le texte).

Pièges rencontrés et traités :
- **Adresse de l'agence ou du syndic** en pied d'annonce : 12 contextes suspects relus à la main, 0 vraie confusion
  (l'adresse citée était bien celle du bien) ; la consigne à l'IA l'exclut.
- **« À proximité de la rue X »** : classé « repère », pas « voie du logement ».
- **Rues homonymes** (« Quai du Rhône » existe à Lyon 1er et 9e, « Square Léon Bourgeois » à deux endroits à
  Rennes) : traité par le code postal de l'annonce et un seuil de score (§ 3).

## 3. Méthode : lire le texte, puis géocoder gratuitement

1. L'IA extrait `rue`, `numéro`, `résidence`, `repère` et la citation justificative (comme `validOffer`).
2. **Géocodage IGN Géoplateforme** (`data.geopf.fr/geocodage`, celui déjà utilisé par l'app pour les lieux de vie,
   `lib/geocode.ts`) : requête « numéro + rue, ville » **filtrée par le code postal de l'annonce**.
3. **Règle d'acceptation** : score IGN ≥ 0,7 ; sinon repli sans filtre postal accepté seulement si le résultat est
   dans le même code postal que l'annonce et de score ≥ 0,9 ; sinon on ne place pas.

**Précision mesurée** sur les 40 annonces (parmi les 300) dont la vraie position est connue et dont le texte cite une
voie (on cache la position, on la retrouve par le texte, on compare) :

| | Annonces | Erreur médiane | Sous 100 m | Sous 300 m | Pire |
|---|---|---|---|---|---|
| Voie **avec numéro** dans le texte | 13 | **8 m** | 11 / 13 | 12 / 13 | 2 212 m (avant la règle du code postal) |
| Voie **sans numéro** | 23 | **61 m** | 19 / 23 | 23 / 23 | 273 m |
| **Total accepté** (règle finale) | **35 / 40** | **31 m** | 30 / 35 | **35 / 35** | **273 m** |

5 annonces sur 40 refusées par la règle (rues ambiguës, score bas) : mieux vaut ne pas placer que placer faux.
Sans le code postal, 2 erreurs de 2,2 et 2,3 km (rues homonymes) : c'est lui qui les corrige.

**Gain** sur les 212 annonces d'agences : **96 gagnent une position** (32 à l'adresse exacte, 64 à la rue), soit
45 %. Sur les 300 annonces : **88 placées → 184 placées (29 % → 61 %)**.

## 4. Les repères seuls (métro, gare, place) : à ne pas utiliser

86 repères testés avec trois géocodeurs, erreur mesurée sur ceux dont la vraie position est connue :

| Géocodeur | Repères trouvés | Erreur médiane | Un quart au-delà de | Pire |
|---|---|---|---|---|
| IGN adresses | 65 / 86 | 496 m | 1 225 m | 6,5 km |
| IGN points d'intérêt | 52 / 86 | 666 m | 1 094 m | 2,9 km |
| OpenStreetMap (Nominatim) | 46 / 86 | 456 m | 692 m | **104 km** |

« À deux pas de la place de la Victoire » donne environ 500 m d'erreur : à peine mieux que le point « quartier » que
Le Bon Coin fournit déjà, et inutilisable pour des trajets. À écarter ; un cercle de zone n'apporterait rien de plus.

## 5. Autre piste : retrouver l'adresse par le diagnostic énergétique (ADEME)

L'ADEME publie en libre accès (`data.ademe.fr`, dataset `dpe03existant`, sans clé) tous les diagnostics de
performance énergétique **avec l'adresse, les coordonnées, la surface habitable, l'étage, les classes énergie et GES et
trois dates**. Les annonces d'agences donnent la surface, les deux classes (201 / 212) et souvent la **date de
réalisation du diagnostic** (82 / 212, dans le texte légal). Appariement : même code postal + surface (±0,06 m²) +
classes + date.

- **Avec la date** : sur 83 annonces testées, **46 ont 1 à 3 candidats** (42 candidat unique). Contre-vérification
  indépendante sur les 23 déjà placées par le texte : **16 retombent sur la même adresse (≤ 150 m, souvent 0 m)**, mais
  **4 résultats « uniques » sont faux** (2,7 à 3,8 km : un autre logement coïncide par hasard). Gain propre : 23
  annonces sans adresse dans le texte, dont ~19 plausibles.
- **Sans la date** : inutilisable. Surface exacte lue dans le texte pour seulement 64 annonces, dont 47 avec 4 candidats
  ou plus ; les « uniques » sont à 2 km de la vérité.

Verdict : **utile en complément, pas en principal** (~ +9 % d'annonces placées, avec un risque d'erreur d'environ
1 sur 6) ; à n'utiliser que pour une adresse « probable », et recoupée avec le point « quartier » (rejeter au-delà de
2 km). À garder pour une seconde étape.

## 6. Les API en ligne

| Service | Gratuit ? | Limite | Adapté ? |
|---|---|---|---|
| **IGN Géoplateforme** (base adresse nationale) | oui, sans clé | 50 appels / s / IP | **Oui, le meilleur pour la France** ; déjà dans l'app |
| Photon (komoot) | oui (démo publique) | best effort | repli possible, sans garantie |
| Nominatim (OpenStreetMap) | oui | 1 appel / s, pas de traitement en masse | non en production ; résultats aberrants sur les repères |
| ADEME (diagnostics) | oui, sans clé | non précisée | pour l'appariement du § 5 |
| Google Geocoding | 200 $ de crédit / mois | 5 $ / 1 000 | inutile : l'IGN fait mieux sur les adresses françaises |
| Mapbox | 100 000 / mois | 0,75 $ / 1 000 | idem ; conditions de stockage à vérifier |
| HERE | 250 000 / mois | ~0,83 $ / 1 000 | idem (c'est lui qui alimente déjà Le Bon Coin) |
| OpenCage, LocationIQ, Geoapify | quotas quotidiens gratuits | | idem |

Aucun service payant n'est nécessaire : l'IGN couvre le besoin, gratuitement.

## 7. Coût et mise en œuvre

- **Coût** : extraction de 292 annonces = 0,161 $ ≈ **0,0006 $ par annonce** ; géocodage et ADEME gratuits. Dans l'app,
  l'extraction se glisserait **dans l'appel d'analyse IA existant** (un champ « adresse » de plus, comme `offer`) et ne
  concernerait que les annonces sans position précise : coût marginal de l'ordre de **0,002 à 0,003 $ par recherche**,
  et jamais repayé grâce au cache d'analyse.
- **Changements** : (1) champ « adresse » dans l'analyse IA, avec citation vérifiée ; `ANALYSIS_VERSION` + 1 ;
  (2) géocodage IGN avec code postal de l'annonce et règle d'acceptation du § 3 (`lib/geocode.ts`) ; (3) position
  enregistrée comme `streetNumber` ou `street`, avec une origine « lue dans la description » ; (4) la fiche et la
  carte disent « Adresse lue dans la description de l'annonce » (distincte de « indiquée par l'annonce ») ; (5) tests
  sur les vraies annonces de l'étude (échantillon d'adresses, homonymes, adresse d'agence refusée, citation inventée
  refusée) ; vérification sur de vraies recherches.
- **Effet** : la carte des résultats passe d'environ 3 annonces sur 10 à 6 sur 10 ; les trajets Google deviennent
  possibles pour ces annonces.

## 8. Limites de l'étude
- 300 annonces, 5 villes, une seule journée. La précision (§ 3) est mesurée sur 40 annonces à position connue, surtout
  de particuliers ; pour les agences, elle est recoupée par l'ADEME (16 / 23 identiques) et par le point « quartier ».
- L'agence a choisi de ne pas publier l'adresse dans le champ de position : la lire dans son propre texte reste son
  contenu public, mais elle doit être présentée comme **lue dans la description**, pas comme certaine.
- Les annonces qui ne citent aucune voie (45 % des agences) restent sans position.

Sources : [IGN, API Adresse transférée à la Géoplateforme](https://www.data.gouv.fr/posts/lapi-adresse-de-la-base-adresse-nationale-est-transferee-a-lign-10),
[politique d'usage de Nominatim](https://operations.osmfoundation.org/policies/nominatim/),
[Google Geocoding, facturation](https://developers.google.com/maps/documentation/geocoding/usage-limits),
[OpenCage, tarifs](https://opencagedata.com/pricing), [comparatif des tarifs de géocodage 2026](https://csv2geo.com/blog/geocoding-api-pricing-compared-real-cost-2026),
données ADEME : `data.ademe.fr/data-fair/api/v1/datasets/dpe03existant`.
