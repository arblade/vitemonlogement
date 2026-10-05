# Type de bien : maison ou appartement

**Statut : fait le 05/10/2026 (develop).** Cas signalé : « Une maison à moins de 30 min de voiture de l'aéroport de Rennes,
moins de 1000 € de loyer, un DPE de minimum D, 3 chambres ou plus, un terrain de 1500 m² » ne renvoyait que des appartements.

## Cause
Aucun critère « type de bien » n'existait : la requête Le Bon Coin demandait toujours `real_estate_type=1,2` (maison **ou**
appartement), le type n'était qu'un mot-clé du texte (perdu dès qu'un équipement comme « jardin » passait avant lui, absent
pour « pavillon » ou « villa »), et ni le LLM d'analyse (qui ne traite que les critères à vérifier, et dont la réponse n'a
pas de case « type de bien »), ni Jev ne comparaient le type de l'annonce à la demande. Un critère « contredit » ne masque
d'ailleurs jamais une annonce (il retire 15 points de score).

## Ce qui est fait
- **Critère `propertyType`** (`house`, `apartment` ou `null`) extrait de la demande par le LLM d'interprétation
  (maison, pavillon, villa → maison ; appartement, studio → appartement ; un simple « T3 » ou « 3 chambres » ne suffit pas).
  Valeur inattendue → `null`. Gardé dans les critères de la recherche (JSON : pas de migration).
- **Requête Le Bon Coin** (`property-type.ts`) : maison → `real_estate_type=1,5`, appartement → `2,5`, sans préférence → `1,2`
  comme avant. La catégorie 5 (« Autre ») est gardée pour ne pas perdre un logement atypique (chalet, péniche…).
  Le type n'est plus un mot-clé du texte (« maison » ferait perdre pavillons, villas, longères) ; studio, duplex, loft et les
  équipements restent des mots-clés comme avant. PAP et SeLoger (désactivés) reçoivent aussi le type.
- **Filtre à la lecture** (`matchesPropertyType`), sans LLM ni coût : une annonce qui se déclare clairement de l'autre type
  est écartée, **sauf si son titre dit le contraire** (« Maison de campagne » rangée en « Appartement » est gardée ; pour
  un appartement, un « T3 » seul ne prouve rien). Type absent ou « Autre » : gardée.
- **Affichage** : ligne « Type de bien » (Maison, Appartement, ou Maison ou appartement) dans « Votre demande ».
- Les recherches déjà enregistrées n'ont pas de type : elles se comportent comme avant.

## Valeurs de `real_estate_type` (Le Bon Coin)
1 Maison, 2 Appartement, 3 Terrain, 4 Parking, 5 Autre. Dans ~75 annonces réelles examinées on n'a vu que 1, 2, 4 et 5 ;
3 vient de l'étude du 01/10 (non revu). Les annonces de catégorie 5 vues : une chambre étudiante, un espace de bureaux.

## Essai réel du 05/10 (1 interprétation OpenAI + 1 run Apify, quelques centimes)
- Interprétation : `propertyType: "house"`, Rennes, ≤ 1000 €, ≥ 3 pièces, souhaits « DPE minimum D », « terrain de 1500 m2 »,
  « moins de 30 min de voiture de l'aéroport de Rennes ». Requête : `real_estate_type=1,5&rooms=3-max&price=min-1000`.
- Le Bon Coin a renvoyé **10 annonces : 9 maisons (type 1) et 1 « Autre » (bureaux), aucun appartement.** Le critère de type
  est donc bien pris en compte par le site.
- Le nombre est faible : peu de maisons à moins de 1000 € dans un rayon de 5 km autour de Rennes.

## Constats de l'essai, non traités ici
1. **Demandes prises pour des offres. Corrigé le 05/10** (`offer.ts`, `proposesHousing`) : « Demande » (« Je recherche un bien à
   louer pour ma famille ») et « Recherche maison à louer – Rennes / Pacé / Betton » étaient gardées, car leur texte contient
   « à louer », lu comme une offre (« quoi que dise la suite ») : l'exception ne couvrait que « recherche à louer » collés.
   Désormais, « à louer » ne vaut pas offre quand il complète un verbe de recherche de la même phrase (« Recherche maison à
   louer »), sauf si ce qui est cherché est une personne (« Cherche locataire pour mon appartement à louer » reste une offre),
   ni quand la recherche vient après ou dans une autre phrase. « un bien » compte comme un logement cherché. Rejoué sur les
   10 annonces réelles de l'essai : les deux demandes sont écartées, rien d'autre ne change.
2. **Annonces non logements en « Autre »** (bureaux, chambre) : écartées ensuite par l'analyse (`offer` non habitable / chambre,
   avec citation), au prix d'une lecture IA ; « Location domaine » (20 pièces, 350 €) et « Location maison à la chambre » passent.
3. **« À moins de 30 min de l'aéroport »** n'est pas un lieu de vie reconnu (`places` vide) : c'est un souhait lu dans le
   texte (jamais confirmé), et le rayon reste de 5 km autour du centre de Rennes alors que l'aéroport est à ~7 km.
4. **« 3 chambres ou plus » devenait « au moins 3 pièces ». Corrigé le 05/10** (voir ci-dessous).

## Chambres et DPE : critères à part, vérifiés sur les champs du site (05/10)
- **Interprétation** : deux nouveaux champs, `minBedrooms` (chambres, distinct des pièces : « 3 chambres ou plus » → 3 chambres,
  pièces à `null`) et `minEnergyClass` (« DPE minimum D » → `D`, c'est-à-dire A à D). Un souhait que ces critères expriment déjà
  est retiré de la liste des souhaits (pas de doublon). Valeur incompréhensible (« trois », « Z », 0) → ignorée.
- **Requête Le Bon Coin** : le filtre de pièces vaut au moins N (« N chambres » suppose N pièces au minimum, jamais plus : un
  filtre à N+1 perdrait pour toujours une annonce qui compte mal ses pièces). Aucun filtre de DPE demandé au site (non vérifié).
- **Lecture, sans IA ni coût** : l'annonce déclare ses chambres (`bedrooms`, « 3 ch. ») et sa classe (`energy_rate`, A à G). Elle
  est **écartée seulement si ce champ contredit clairement la demande** (2 chambres pour 3 demandées, DPE F pour « D minimum »),
  comme le prix, la surface et les pièces déclarés. **Jamais** sur une lecture de texte, **jamais** quand le champ manque ou n'est
  pas lisible (« N », « vierge » = inconnu, annonce gardée). Ces champs sont peu remplis (chambres : 6 annonces sur 59 de nos
  échantillons) : la plupart des annonces restent « à vérifier » et gardées.
- Deux critères s'affichent sur les cartes (« Au moins 3 chambres », « DPE D ou mieux ») avec leur statut, et deux lignes dans
  « Votre demande » (« Chambres min. », « DPE minimum »). Les critères « à vérifier » restent lus dans le texte par le LLM (score
  seulement, comme avant).
- **Rejoué sur les 10 annonces réelles de l'essai** : « Maison t3 » (2 chambres, DPE F) et « Maison 3 pièces 59 m² » (2 chambres),
  qui passaient parce que 3 pièces ne font pas 3 chambres, sont écartées. Restent : « Location domaine » (champs absents),
  « Location maison à la chambre » (4 chambres déclarées, mais location à la chambre) et « Espace de bureaux » : à écarter par
  la dernière passe du LLM (type d'offre « chambre » / « non habitable », avec citation), pas par ces champs.

### Garde contre « terrain de 1500 m² » pris pour une surface habitable
Un essai réel a montré le LLM lisant « un terrain de 1500 m2 » comme `minArea: 1500` (surface du logement) : la requête aurait
contenu `square=1500-max`, soit aucun résultat. Prompt renforcé (la surface est celle du logement, jamais d'un terrain ou jardin)
**et** garde déterministe (`landAreaClause`) : si le nombre est qualifié de terrain, jardin, parcelle… dans la demande et pas de
logement, la surface est annulée et le groupe « terrain de 1500 m2 » devient un souhait (une seule fois).

### Constat de l'essai réel : ville vide
Sur 3 interprétations réelles de la même demande, **2 ont renvoyé `location: ""`** : le LLM voit « l'aéroport de Rennes » comme un
lieu et non comme la ville de la recherche. La recherche échoue alors avec « Indiquez une ville ou un département dans votre
description » (`pipeline.ts`). Petit échantillon, mais cela rejoint le point 2 (aéroport) : à traiter avec lui.

## Tests
`type-de-bien.test.ts` (requête, `declaredType`, `matchesPropertyType`, lecture, de bout en bout avec faux LLM et faux
Apify : maison demandée, valeur inattendue du LLM) ; `chambres-dpe.test.ts` (champs chambres et DPE, filtre de pièces large, écartement sur champ seulement, souhaits sans doublon, garde terrain, de bout en bout) ; `offer.test.ts` (demandes « … à louer », offres qui gardent « à louer ») ; `search-detail.test.tsx` (ligne « Type de bien ») ; `e2e/app.e2e.mjs`
(« Votre demande » dit « Appartement »). Vérifié en cassant volontairement le filtre et la requête : les tests échouent.
