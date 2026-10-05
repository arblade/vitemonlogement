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
1. **Demandes prises pour des offres.** « Demande » (« Je recherche un bien à louer pour ma famille »), « Recherche maison à
   louer – Rennes / Pacé / Betton » ont été gardées : leur texte contient « à louer », ce que `isSeekerAd` (`offer.ts`) lit
   comme une offre (« quoi que dise la suite »), alors que Le Bon Coin les range en `offer`. « Recherche petite maison »
   (sans « à louer ») est bien écartée.
2. **Annonces non logements en « Autre »** (bureaux, chambre) : écartées ensuite par l'analyse (`offer` non habitable / chambre,
   avec citation), au prix d'une lecture IA ; « Location domaine » (20 pièces, 350 €) et « Location maison à la chambre » passent.
3. **« À moins de 30 min de l'aéroport »** n'est pas un lieu de vie reconnu (`places` vide) : c'est un souhait lu dans le
   texte (jamais confirmé), et le rayon reste de 5 km autour du centre de Rennes alors que l'aéroport est à ~7 km.
4. **« 3 chambres ou plus »** devient « au moins 3 pièces » : une maison de 2 chambres + séjour (3 pièces) passe.

## Tests
`type-de-bien.test.ts` (requête, `declaredType`, `matchesPropertyType`, lecture, de bout en bout avec faux LLM et faux
Apify : maison demandée, valeur inattendue du LLM) ; `search-detail.test.tsx` (ligne « Type de bien ») ; `e2e/app.e2e.mjs`
(« Votre demande » dit « Appartement »). Vérifié en cassant volontairement le filtre et la requête : les tests échouent.
