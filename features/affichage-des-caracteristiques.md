# Étude : afficher les caractéristiques d'un logement (01/10/2026)

Constat : sur la fiche, les caractéristiques sont une colonne de lignes grises toutes pareilles, chacune avec une
coche (même « Ascenseur · Non »), en jargon de base de données (« Chambres · 1 ch. », « Classe énergie · D »).
Les critères sont de grands blocs verts avec trois lignes chacun. Sur la carte, deux titres (« Vos critères »,
« Autres caractéristiques »), un rang « 01 · Le Bon Coin », un lien et un pied de carte répétaient la même chose.
Captures : `maquettes/carte-avant-mobile.png`, `maquettes/fiche-avant-mobile.png`.

## Ce que fait Airbnb (et pourquoi ça marche)
- **Carte de résultat minimale** : photo, une ligne de type et lieu, une ligne de chiffres, le prix. Aucun
  équipement, aucun titre de rubrique.
- **En tête de fiche, une phrase de chiffres sans icônes** : « 2 voyageurs · 1 chambre · 1 lit · 1 salle de bain ».
  Lue en une seconde ; des icônes n'y ajouteraient rien.
- **« Ce que propose ce logement »** : liste **icône au trait + libellé court**, sur 2 colonnes en grand écran,
  1 sur mobile, **sans fond ni cadre** par ligne (le blanc sépare). 10 éléments, puis « Afficher les N
  équipements » qui ouvre la liste complète **groupée par thème** (Salle de bain, Cuisine, Extérieur…).
- **Ce qui manque est barré**, regroupé à la fin (« Non inclus ») : jamais une coche à côté d'un « Non ».
- **Une seule couleur d'accent**, réservée aux actions ; le reste en noir et gris.

Principes d'ergonomie derrière : une icône seule est ambiguë, elle n'aide qu'avec son libellé (repère pour
balayer la liste, pas pour remplacer le mot) ; regrouper par thème (5 à 7 éléments par groupe) réduit l'effort de
lecture ; parler la langue de l'utilisateur (« 3e étage », « Sans ascenseur ») plutôt que celle des données.

## Recommandation
**Une liste à icônes, groupée, pas des blocs.** Les blocs (tuiles) conviennent à 3 ou 4 chiffres clés (prix,
surface, pièces, lieu : on les garde) ; au-delà, une grille de tuiles devient un damier où tout pèse le même poids.

### Carte de résultat (fait, sur `develop`)
- Une seule rangée de pastilles, **sans titre** : vos critères d'abord (coche verte = satisfait, tiret rouge =
  non satisfait, point d'interrogation en pointillés = non précisé ; le statut est lu aux lecteurs d'écran et
  au survol), puis les autres caractéristiques en gris neutre avec leur icône ; 6 au plus, puis « +N ».
- Caractéristiques en mots simples : « Sans ascenseur », « 3e étage », « 1 chambre », « DPE D », « GES B »,
  « Non meublé », « Charges 60 € ».
- Retirés : « 01 · Le Bon Coin », « Vos critères · N », « Autres caractéristiques », « Détails, sources et
  preuves », le pied « N critères · N autres caractéristiques dans le détail ». « Déjà consultée » devient une
  petite étiquette, seulement quand c'est le cas.
- Boutons : **« Fiche complète »** (principal, plein), **« Voir sur Le Bon Coin »** et **« Comparer »**
  (secondaires, bordés). Mobile : principal sur toute la largeur, les deux autres côte à côte dessous ;
  desktop : les trois alignés. Toucher la carte ouvre toujours la fiche.
- Captures : `maquettes/carte-apres-mobile.png`, `maquettes/carte-apres-desktop.png`.

### Fiche complète (proposition, à valider) — `maquettes/maquette-fiche-mobile.png`, `-desktop.png`
1. **En-tête** : prix en grand, puis une ligne « 42 m² · 2 pièces · 1 chambre · 3e étage » (à la place des
   4 tuiles en majuscules).
2. **Vos critères** avec un résumé « 2 sur 3 satisfaits », en **liste compacte** dans un seul cadre : pastille
   de statut, critère, preuve en une ligne grise (« « balcon plein sud » (description) »), statut à droite.
   Le vert reste réservé au critère satisfait.
3. **Ce que propose ce logement**, groupé : *Le logement* (chambres, salle de bain, étage, cuisine, cave…),
   *Énergie et charges* (DPE et GES en **échelle A→G** où la lettre du logement ressort, en noir : pas de
   vert, réservé aux critères ; chauffage, charges), *Absent* (barré : « Ascenseur »). Icône au trait + texte,
   sans fond, 1 colonne sur mobile, 2 en desktop. Plus de 8 éléments : « Afficher les N caractéristiques ».
   Ce qui est déjà un critère n'est pas répété.
4. La provenance (annonce ou description) passe en petite ligne grise sous l'élément, seulement quand elle
   apporte quelque chose (citation), au lieu d'une étiquette sur chaque ligne.

Effort estimé : ≈ ½ journée (fiche + tests front et e2e), en réutilisant `featureText` et `featureIcon`
(`listing-facts.ts`), déjà partagés par la carte. Les groupes se déduisent du libellé (comme les icônes).

Sources : pages d'annonce Airbnb (« Ce que propose ce logement », liste complète des équipements),
[analyse du design system Airbnb](https://getdesign.md/design-md/airbnb/preview.html),
[exemples Baymard : listes Airbnb](https://baymard.com/ecommerce-design-examples/37-product-list-category/11330-airbnb).
