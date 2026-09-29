# Logiscope — évaluation ponctuelle de 10 demandes de location

Date : 29 septembre 2026. Ce rapport est une photographie du comportement actuel, **pas une suite lancée automatiquement**.

## Méthode et portée

- Dix textes ont été passés **réellement** à `POST /api/housing/interpret`, qui appelle `interpret()` et le modèle `gpt-5-mini` de l'application. Les sorties ci-dessous sont celles obtenues lors de cette exécution, pas des réponses imaginées. Ces dix appels IA consomment des crédits.
- Les requêtes Apify présentées ont été **calculées hors ligne**, directement avec `focusedSearchTerm()` et `actorRequest()` du code, dans la configuration de développement (`candidateLimit=10`, `maxTotalChargeUsd=0.10`, `timeout=120`). **Aucun acteur Apify n'a été lancé** et aucune annonce n'a été récupérée ou analysée par l'IA durant cette évaluation.
- `S` désigne les critères structurés que l'application cherchera dans les données de l'annonce ; `H` désigne les critères hybrides (champ parfois présent, sinon lecture du texte) ; `D` désigne les souhaits à vérifier dans la description. Cette classification est celle **retenue par le code après l'appel IA**, pas simplement un jugement libre du modèle.
- Dans toutes les requêtes simulées : `category:"10"` (locations), `adLimit:10`, `mode:"standard"`, `includeSeller:false`, `includePhone:false`, `shippable:false`. Le rayon vaut 5 km sauf dans le cas 7. Aucun des dix appels IA n'a fourni de valeur `keywords`.

## Résultats par situation

### 1. Une demande très simple

> Je cherche un appartement à Rennes à louer, 900 € maximum par mois.

- **Interprétation** — S : Rennes ; loyer ≤ 900 €. H : aucun. D : aucun. Aucune surface ou nombre de pièces inventé.
- **Requête ciblée calculée** — `{"category":"10","location":"Rennes","radius":5,"price_max_filter":900,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. Pas de `searchQuery` ; **un seul passage**.
- **Observation** — « appartement » n'est pas transmis en filtre de type de logement.

### 2. T2 meublé avec ascenseur

> Je voudrais louer un T2 meublé à Lyon 7e, au moins 40 m², 1 200 € maximum charges comprises, avec ascenseur.

- **Interprétation** — S : Lyon 7e ; loyer ≤ 1 200 € ; surface ≥ 40 m² ; ≥ 2 pièces. H : meublé (`furnished`) ; ascenseur (`elevator`). D : aucun.
- **Requête ciblée** — `{"searchQuery":"ascenseur","category":"10","location":"Lyon 7e","radius":5,"price_max_filter":1200,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. Si le premier passage est insuffisant, même requête **sans `searchQuery`** pour le passage élargi.
- **Observations** — « charges comprises » est perdu dans les vérifications ; la surface et le nombre de pièces ne figurent pas dans la requête à l'acteur et sont vérifiés après récupération. Le terme « meublé » n'est pas choisi comme mot-clé ciblé : la fonction de sélection du terme renvoie même `null` si « meublé » est le seul souhait.

### 3. Une famille et plusieurs préférences

> Famille avec deux enfants : maison à louer près de Nantes, budget 1 600 € maximum, 3 chambres, jardin, garage, calme et proche d’une école.

- **Interprétation** — S : Nantes ; loyer ≤ 1 600 € ; **≥ 3 pièces**. H : garage (`parking`). D : jardin ; calme ; proche d'une école.
- **Requête ciblée** — `{"searchQuery":"jardin","category":"10","location":"Nantes","radius":5,"price_max_filter":1600,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. Passage élargi éventuel sans `searchQuery`.
- **Écart important** — La personne demande **trois chambres**, pas trois pièces. Un T3 de deux chambres satisfait à tort le minimum de trois pièces. « Maison » n'est pas envoyé à l'acteur ; « près de Nantes » retombe sur le rayon par défaut de 5 km.

### 4. Étudiant en langage familier

> Salut ! Je cherche un studio sur Lille, 650 balles maxi, pas trop loin de la fac à vélo. J’ai un chat, il faudrait qu’il soit accepté.

- **Interprétation** — S : Lille ; loyer ≤ 650 € ; ≥ 1 pièce. H : aucun. D : pas trop loin de la fac à vélo ; chat accepté.
- **Requête ciblée** — `{"category":"10","location":"Lille","radius":5,"price_max_filter":650,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. **Un seul passage**.
- **Observation** — Le langage familier et « 650 balles » sont bien compris. En revanche « studio » n'est pas envoyé comme `searchQuery` ; « chat accepté » doit rester inconnu si l'annonce ne le précise pas.

### 5. Travail de nuit et stationnement sécurisé

> Je travaille de nuit : à Toulouse je veux louer un logement à 1 100 € maximum, calme pendant la journée, volets occultants, rue peu passante et parking sécurisé.

- **Interprétation** — S : Toulouse ; loyer ≤ 1 100 €. H : **parking sécurisé** (`parking`). D : calme pendant la journée ; volets occultants ; rue peu passante.
- **Requête ciblée** — `{"searchQuery":"parking","category":"10","location":"Toulouse","radius":5,"price_max_filter":1100,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. Passage élargi éventuel sans `searchQuery`.
- **Écart confirmé par une fonction déterministe** — Pour une annonce ne fournissant que `nb_parkings:1`, `evaluateStructured()` retourne `confirmed` pour **« parking sécurisé »**, alors que ce champ prouve seulement l'existence d'une place, pas sa sécurité.

### 6. Exclusions et fourchette de loyer

> À Bordeaux, un appartement entre 850 et 1 100 € par mois, sans rez-de-chaussée, sans vis-à-vis, pas de colocation, et surtout non meublé.

- **Interprétation** — S : Bordeaux ; 850 ≤ loyer ≤ 1 100 €. H : non meublé (`furnished`, avec sens négatif conservé dans le libellé). D : sans rez-de-chaussée ; sans vis-à-vis ; pas de colocation.
- **Requête ciblée** — `{"category":"10","location":"Bordeaux","radius":5,"price_min_filter":850,"price_max_filter":1100,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. **Un seul passage**.
- **Observation** — Les deux bornes du loyer sont correctement appliquées. La catégorie locations exclut déjà la catégorie colocations de l'acteur, mais l'exclusion de colocation reste aussi un souhait à vérifier.

### 7. Rayon explicite et souhait alternatif

> Je cherche une location à moins de 15 km de Montpellier, au moins 35 m², loyer sous 950 €, avec balcon ou terrasse, près d’un arrêt de tram.

- **Interprétation** — S : Montpellier ; rayon 15 km ; loyer ≤ 950 € ; surface ≥ 35 m². H : aucun. D : balcon **ou** terrasse ; proximité du tram.
- **Requête ciblée** — `{"searchQuery":"balcon","category":"10","location":"Montpellier","radius":15,"price_max_filter":950,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. Passage élargi éventuel sans `searchQuery`.
- **Observation** — Le rayon est transmis. Le premier passage privilégie « balcon » et peut manquer ou reléguer les annonces qui n'ont qu'une terrasse, pourtant également acceptée.

### 8. Deux lieux possibles

> Paris 12e ou Vincennes : appartement à louer, 1 500 € maximum, 45 m² minimum, deux chambres, proche d’un parc.

- **Interprétation** — S : **`Paris 12e, Vincennes`** comme une seule chaîne ; loyer ≤ 1 500 € ; surface ≥ 45 m² ; **≥ 2 pièces**. H : aucun. D : proche d'un parc.
- **Requête ciblée** — `{"category":"10","location":"Paris 12e, Vincennes","radius":5,"price_max_filter":1500,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. **Un seul passage**.
- **Écarts importants** — Le code ne produit pas deux recherches géographiques : il remet la chaîne combinée telle quelle à l'acteur ; son interprétation par l'acteur est inconnue sans l'exécuter. « Deux chambres » devient ≥ 2 pièces, ce qui peut laisser passer un T2 d'une seule chambre.

### 9. Demande volontairement très chargée

> Pour Strasbourg, je voudrais louer un appartement de 70 m² minimum pour 1 400 € au plus, avec parking, ascenseur, balcon, cave, fibre, animaux acceptés, peu de bruit, DPE C ou mieux, cuisine séparée, sans vis-à-vis et proche du tram.

- **Interprétation** — S : Strasbourg ; loyer ≤ 1 400 € ; surface ≥ 70 m². H : parking ; ascenseur. D **conservés** : balcon ; cave ; fibre ; animaux acceptés ; peu de bruit ; DPE C ou mieux.
- **Requête ciblée** — `{"searchQuery":"parking","category":"10","location":"Strasbourg","radius":5,"price_max_filter":1400,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. Passage élargi éventuel sans `searchQuery`.
- **Écart important** — Les trois derniers souhaits **cuisine séparée, sans vis-à-vis, proche du tram** disparaissent. `interpret()` garde au maximum huit préférences, sans afficher d'avertissement. Le filtre de 70 m² est appliqué aux annonces après récupération, pas dans l'entrée de l'acteur.

### 10. Une chambre en colocation

> Je cherche une chambre en colocation à Grenoble à 500 € max, avec bail individuel, cuisine partagée et charges incluses.

- **Interprétation** — S : Grenoble ; loyer ≤ 500 €. H : aucun. D : chambre en colocation ; bail individuel ; cuisine partagée ; charges incluses.
- **Requête ciblée** — `{"category":"10","location":"Grenoble","radius":5,"price_max_filter":500,"adLimit":10,"mode":"standard","includeSeller":false,"includePhone":false,"shippable":false}`. **Un seul passage**.
- **Écart important** — La demande est explicitement une colocation, mais la requête reste dans la catégorie **10 (locations)** et ne cherche pas dans la catégorie **11 (colocations)**. Le vrai rappel de la colocation est seulement dans une vérification textuelle ultérieure.

## Appels API : effectués et seulement prévus

**Effectués :** dix `POST /api/housing/interpret` avec `{ "prompt": "..." }`, via l'API du projet et son modèle `gpt-5-mini`. Un test local supplémentaire de `evaluateStructured()` et `matchesKnownBasics()` ne fait aucun appel réseau. **Aucun POST Apify**.

**Calculés mais non effectués :** chacun des dix scénarios prépare d'abord un `POST /v2/actors/clearpath~leboncoin-api/runs?maxItems=10&maxTotalChargeUsd=0.10&timeout=120` avec le corps JSON indiqué ci-dessus. Dans le mode développement actuel, les cas **2, 3, 5, 7 et 9** ont un `searchQuery` et prépareraient aussi un second POST sans ce terme **si le premier passage aboutit** : le seuil de relance est fixé à moins de 40 annonces admises, alors que le mode développement n'en conserve au maximum que 5 par passage. Les cinq autres cas ne préparent pas de second passage. En production, le nombre réel de seconds passages dépendrait des résultats admissibles du premier ; il n'est pas connu ici.

Si une recherche était réellement lancée, l'application consulterait aussi `GET /v2/actor-runs/{runId}` jusqu'à la fin de chaque passage, puis `GET /v2/datasets/{datasetId}/items?format=json&clean=true&limit=10` en développement, avant d'analyser les annonces retenues par lots de cinq avec le LLM. Le nombre de sondages GET et le contenu des annonces ne sont **pas mesurés** dans ce test.

## Propositions d'amélioration du workflow

1. **Priorité haute — Corriger les faux positifs sur les besoins essentiels.** Distinguer `chambres` de `pièces` dès l'interprétation et vérifier explicitement le nombre de chambres dans les annonces plutôt que de supposer qu'il équivaut au nombre de pièces. Découper les souhaits hybrides composés : `parking sécurisé` implique « place présente » **et** « sécurité prouvée par l'annonce » ; le seul champ `nb_parkings` ne doit jamais confirmer les deux. Couvrir ces deux exemples par des tests déterministes.
2. **Priorité haute — Ne plus perdre silencieusement des critères.** Conserver tous les souhaits interprétés, différencier indispensables et préférences si la personne le précise, et signaler explicitement ceux que le système ne sait pas encore vérifier. Un dépassement de huit souhaits ne doit pas écarter les derniers sans avertissement.
3. **Priorité haute — Traiter les lieux alternatifs et la colocation comme de vrais choix de recherche.** Représenter « Paris 12e ou Vincennes » comme deux lieux, puis demander une précision ou planifier des recherches distinctes avec une limite d'appels claire. Détecter la colocation pour utiliser la bonne catégorie **après avoir vérifié son schéma actuel**. Conserver la priorité de la recherche ciblée et la déduplication des résultats.
4. **Priorité moyenne — Rendre le choix du mot-clé fidèle à la demande.** Tests directs de `focusedSearchTerm()` : `["meublé"] → null`, `["sans balcon"] → "balcon"` et `["balcon ou terrasse"] → "balcon"`. Éviter les termes issus de critères négatifs ; traiter les accents correctement ; représenter les alternatives sans en privilégier une arbitrairement. Ne déclencher la recherche élargie que si elle ajoute réellement de la valeur ; en développement, le seuil 40 assure mécaniquement un second appel pour toute requête ciblée aboutie.
5. **Priorité moyenne — Clarifier les limites des filtres.** Ne pas présenter « charges comprises » comme garanti par le seul filtre de prix, et vérifier les frais dans les annonces. La surface, le nombre de pièces et le type de bien ne figurent pas dans les dix requêtes Apify calculées, bien qu'ils soient parfois filtrés après récupération : vérifier le schéma publié de l'acteur avant d'ajouter un champ et, à défaut, ajuster prudemment la sélection des candidats pour ne pas manquer les logements pertinents.
6. **Pour mesurer les progrès — Conserver un jeu de référence ponctuel.** Garder ces dix prompts et quelques annonces fictives contrôlées pour comparer la classification, les deux passages, les critères réellement vérifiés et les faux positifs avant/après une modification. Ce rapport seul ne permet pas d'évaluer le classement final d'annonces réelles, puisque les acteurs n'ont pas été lancés.

**Code consulté :** `artifacts/api-server/src/routes/housing/ai.ts` (`interpret`, `analyze`), `housing-search.ts` (choix du terme et payload Apify), `criteria.ts` (classification et preuve structurée), `apify.ts` (limites, deux passages et analyse), `index.ts` (enchaînement de la recherche). Les sorties IA peuvent varier lors d'une nouvelle exécution.