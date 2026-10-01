# Étude : brancher SeLoger et PAP en plus de Le Bon Coin (01/10/2026)

Aucune étude antérieure sur les autres sites n'a été retrouvée dans le dépôt. Retenus : **SeLoger** (le plus gros
portail d'agences) et **PAP** (particuliers seulement, sans frais d'agence). Écartés pour cette étude : Bien'ici et
Logic-Immo (acteurs Apify moins utilisés), à garder en réserve (Bien'ici surtout, voir la fin).

## Méthode
19 runs Apify réels (≈ 0,58 $), même demande que pour Le Bon Coin : « T1 ou T2 à Lille, 700 € max », puis
« T2 à Rennes, 800 € max » et des comptages de volume (Lille, Rennes, Nantes, Paris). Données comparées champ par champ à
ce que l'app utilise déjà (`normalize` dans `apify.ts`).

## Acteurs Apify disponibles

| Site | Acteur | Utilisation (30 j) | Entrée | Coût mesuré (10 annonces complètes) |
|---|---|---|---|---|
| Le Bon Coin (actuel) | `clearpath/leboncoin-api` | — | champs ou URL | **0,024 $** (0,009 départ + 0,0015/annonce) |
| SeLoger | `silentflow/seloger-scraper-ppr` ✅ | 14 utilisateurs, 472 runs, 0 échec | URL de recherche SeLoger | **0,038 $** (0,004 départ + 0,0034/annonce ; 0,0014 sans le détail) |
| SeLoger | `abotapi/seloger-france-scraper` | 20 utilisateurs | ville en clair + filtres | 0,09 $ ; a rendu 4 annonces sur 179 à Rennes → écarté |
| SeLoger | `azzouzana/seloger-mass-products-…` | 58 utilisateurs | URL | refuse les URL testées → écarté |
| PAP | `clearpath/pap-scraper` ✅ (même éditeur que l'acteur Le Bon Coin) | 13 utilisateurs, 276 runs, 1 échec | champs structurés | **0,045 $** (0,005 départ + 0,004/annonce) |

## SeLoger

**Recherche.** L'acteur prend une URL `https://www.seloger.com/classified-search?distributionTypes=Rent&estateTypes=Apartment,House&locations=AD08FR23619&numberOfRoomsMin=1&numberOfRoomsMax=2&priceMax=700`.
Vérifié en réel : type de bien, pièces min/max et prix max sont **respectés** (10/10).

**Obstacle n° 1 : le code de lieu.** `AD08FR23619` (Lille), `AD08FR14157` (Rennes) sont des identifiants internes
SeLoger, ni INSEE ni code postal. L'autocomplétion publique de SeLoger (`autocomplete.svc.groupe-seloger.com`, accessible)
ne renvoie que l'ancien code (`ci=590350`), que le site n'accepte plus. Solution : résoudre une fois par ville avec
`abotapi` (il journalise « Lille → AD08FR23619 »), puis garder la correspondance en base, définitivement.

**Obstacle n° 2 : les colocations.** Lille, T1-T2 ≤ 700 € : **27 annonces sur 30 sont des chambres en colocation**,
presque toutes d'un même acteur (Spacest), typées « Appartement ». Lille T2 ≤ 900 € : 9/10 logements entiers. Rennes T2
≤ 800 € : 3 colocations sur 4. Le titre, **généré par SeLoger**, est fiable : « Colocation à louer » / « Appartement à
louer » / « Studio à louer » / « Maison à louer ». On peut écarter à la lecture, sans IA. Mais sur les petits budgets il
faut lire 3 fois plus d'annonces pour en garder autant (lecture sans détail à 0,0014 $, puis détail des retenues).

**Données (avec détail).** Excellentes et plus structurées que Le Bon Coin : prix, surface, pièces, ville, code postal,
quartier, coordonnées, description complète (700 à 3 300 car.), 6 à 29 photos, et des booléens prêts à l'emploi :
`isFurnished`, `hasElevator`, `hasParking`, `hasGarage`, `hasBalcony`, `hasTerrace`, `hasGarden`, `hasCellar`.
Toutes les annonces vues viennent d'agences (`isPro`). Sans le détail (`deepScrape: false`), plus de coordonnées ni de
description : inutilisable seul.
Précision des coordonnées non indiquée : 33 sur 40 ont 13 à 15 décimales (point), 6 en ont 4 ou 5 (quartier
probable). À traiter comme « quartier » faute de mieux, ou déduire de la longueur.

## PAP

**Recherche.** Entrée structurée, la plus proche de notre modèle : `product: "location"`, `locations: ["Lille (59)"]`
(ou un code postal), `strictLocation`, `propertyTypes: ["appartement", "maison"]`, `nbPiecesMin/Max`, `priceMin/Max`,
`surfaceMin/Max`, `tags` (ascenseur, balcon-terrasse, garage-parking, animaux-admis…). Pas de code à résoudre.

**Fuites de filtre.** Avec « appartement, maison, 1 à 2 pièces », PAP renvoie quand même **3 colocations sur 10**
(5 à 7 pièces) ; elles sont typées `propertyType: "colocation"` : on les écarte à la lecture. Sans `strictLocation`,
« Lille (59) » couvre l'agglomération (Roubaix, Croix, Lambersart…), ce qui est plutôt bien pour l'utilisateur.

**Volume : faible.** Total des locations PAP (tous prix, toutes tailles) : Rennes 27, Lille 42, Nantes 79 ;
Paris T1-T2 ≤ 1 300 € : 100. « T2 à Rennes ≤ 800 € » : **0 annonce**. PAP enrichit la liste, il ne peut pas la remplir.

**Données.** Prix, pièces, chambres, type, ville et code postal (dans le titre « Lambersart (59130) »), coordonnées
(5 à 6 décimales), description (200 à 2 700 car.), 4 à 12 photos, classe énergie et GES. La **surface n'est que dans
le texte** « Appartement / 2 pièces / 1 chambre / 44 m² » (facile à extraire). 1 annonce sur 10 sans détail (ni
description ni coordonnées). Particuliers uniquement. **L'acteur renvoie toujours les téléphones** (5/10) : à ne
jamais enregistrer.

## Location uniquement, jamais d'achat (vérifié)
Les 106 annonces récupérées sont toutes des locations : loyers de 330 à 1 450 €, aucun prix de vente.

| Source | Demandé à la recherche | Vérifié à la lecture (annonce écartée sinon) |
|---|---|---|
| Le Bon Coin (actuel) | catégorie 10 « Locations » | URL `/locations/` ou `/colocations/` (`isHousingListingUrl`) |
| PAP | `product: "location"` (ni `vente` ni `vacances`) | champ `product === "location"` (21/22) et URL `pap.fr/annonces/` |
| SeLoger | `distributionTypes=Rent` dans l'URL | champ `transactionType === "Rent"` (70/70) |

Le même principe que pour Le Bon Coin : **double verrou**, à la requête puis à la lecture. Une annonce dont le champ
manque ou vaut autre chose est écartée, et un test le vérifie pour chaque source.
Cas trouvé chez PAP : 1 annonce `product: "acceslogement"`, un logement social renvoyé vers acceslogement.fr
(sans description ni coordonnées, attribution sous conditions) : écartée par ce verrou. La location saisonnière
(`vacances` chez PAP) est exclue de la même façon.

## Complémentarité
Sur ces échantillons, **aucun doublon** avec Le Bon Coin (prix et surface comparés ; 31 annonces Le Bon Coin, 40
SeLoger, 10 PAP à Lille). Échantillon petit : une déduplication (prix, surface, position) reste nécessaire.

## Ce qu'il faut changer dans l'app

1. **Source par annonce** : champ `source` (`leboncoin` / `seloger` / `pap`) en base et dans l'API, pastille sur la
   carte et la fiche, « Voir l'annonce sur SeLoger ». `isHousingListingUrl` accepte les domaines des trois sites.
2. **Un `normalize` par source** vers le même `Listing` (correspondances ci-dessus) ; filet « logement entier » à la
   lecture : titre SeLoger « Colocation… », `propertyType` PAP `colocation`, parkings et terrains.
3. **Requêtes** : PAP depuis les critères (direct) ; SeLoger via l'URL `classified-search`, avec la table ville → code
   SeLoger (résolution au premier usage, ≈ 0,09 $ une fois par ville).
4. **Répartition** : lancer les sources en parallèle, chacune avec son plafond ; garder 5 annonces au total
   (ou 5 par source à décider) ; dédoublonner.
5. **Critères « hybrides »** : les booléens SeLoger (meublé, ascenseur, parking…) et les `tags` PAP se branchent sur
   `evaluateStructured` comme les attributs Le Bon Coin.
6. **Confidentialité** : ne jamais stocker `phones` (PAP) ni `contactPhone` (SeLoger).

## Coût par recherche (5 annonces retenues)
Le Bon Coin seul ≈ 0,024 $ d'Apify. Avec SeLoger (10 annonces avec détail) : + 0,038 $. Avec PAP : + 0,045 $
(0,005 $ seulement quand PAP n'a rien). Soit **≈ 0,11 $ par recherche au lieu de 0,024 $** (mesuré en réel), plus
l'analyse IA des annonces en plus. Le plafond `APIFY_MAX_CHARGE_USD` (0,10 $) est par run : à garder par source.

## Recommandation
- **PAP d'abord** : branchement simple (entrée structurée, même éditeur, pas de code de lieu), données propres,
  annonces de particuliers sans frais d'agence, absentes de nos résultats Le Bon Coin. Faible volume : en complément.
- **SeLoger ensuite** : le plus de stock d'agences et les données les plus riches, mais deux chantiers (codes de
  lieu, colocations sur petits budgets) et un coût d'environ 1,6 × celui de Le Bon Coin.
- À évaluer avant SeLoger : **Bien'ici** (agrège les agences, 7 acteurs Apify dont `solidcode/bienici-com-scraper`),
  qui pourrait éviter le problème des codes de lieu.

## Branchement réalisé (01/10/2026)
Les deux sources sont branchées, en plus de Le Bon Coin.

- **Lancement** : à la recherche ciblée, Le Bon Coin, SeLoger et PAP partent en parallèle (`sources.ts`). La phase
  élargie ne relance que Le Bon Coin. Une source qui ne démarre pas ou échoue est journalisée et ignorée : la recherche
  aboutit avec les autres. La recherche attend que toutes les sources aient fini avant de lire les résultats.
- **Ville** : PAP et SeLoger seulement si la ville est une commune reconnue sans ambiguïté (sinon Le Bon Coin seul).
  Code de lieu SeLoger résolu au premier usage (run `abotapi`, ≈ 0,09 $ de démarrage, 7 à 45 s ; le « coût nul »
  mesuré d'abord venait d'un plafond trop bas qui interrompait le run), vérifié par le département, puis gardé dans
  la table `seloger_locations`.
- **Location uniquement** : requête (`product: "location"`, `distributionTypes=Rent`) puis lecture (`product`,
  `transactionType`, chemin d'URL `/annonce/location/` ou `/annonces/locations/` pour SeLoger). Tests : une vente
  glissée dans les résultats de chaque source est écartée ; chaque verrou retiré fait échouer un test.
- **Logements entiers** : PAP `propertyType` appartement ou maison ; SeLoger sans titre « Colocation… » ; puis la
  vérification IA « logement entier » commune à toutes les sources (elle a écarté en réel 4 chambres de coliving
  SeLoger à Rennes, non titrées « Colocation »).
- **Mélange** : une annonce de chaque site à tour de rôle, doublons d'un site à l'autre retirés (loyer, surface à
  1 m², position à 300 m ou même nombre de pièces). Jamais à l'intérieur d'un même site.
- **Affichage** : source sur chaque carte (« 01 · PAP »), « Voir sur SeLoger », favoris compris ; appels PAP et
  SeLoger visibles dans le suivi `?debug=1`. Champ `source` en base (`housing_listings`) et dans l'API.
- **Confidentialité** : téléphones et contacts renvoyés par les acteurs jamais enregistrés (testé).
- **Réglage** : `LISTING_SOURCES` (ex. `leboncoin,pap`) coupe une source sans redéployer de code.

Vérifié en réel (≈ 0,39 $) : « T1 ou T2 à Lille, 700 € max » → 3 Le Bon Coin, 3 SeLoger, 3 PAP ; « T2 à Rennes,
800 € max » → Le Bon Coin et SeLoger (PAP n'a rien), 4 colivings SeLoger écartés par l'IA ; « 30 à 45 m² à Nantes,
900 € max » → les trois sources, surfaces respectées. Cas limite : un studio privé en résidence de coliving (Ecla, Lille)
est gardé, l'IA le juge logement entier.
