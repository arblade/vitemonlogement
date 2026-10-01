# Enquête : parkings et colocations dans une recherche « T1 ou T2 » (01/10/2026)

Signalement : un utilisateur cherchant un T1 ou un T2 a reçu des places de parking et des chambres en colocation.

## Méthode
Vrais appels, avec les clés de production : 5 interprétations OpenAI (gpt-5-mini, le modèle de prod), 6 runs Apify,
2 passages d'évaluation sur 59 annonces uniques (Lille, Rennes, Quimper). Coût total ≈ 0,15 $.
La base de prod (Neon) n'est pas accessible depuis cet environnement : la recherche exacte de l'utilisateur n'a pas pu
être relue ; elle a été reproduite avec « T1 ou T2 à Lille, 700 € max ».

## Reproduction (code actuel, requête exacte de la prod)
10 annonces reçues d'Apify → **10 gardées par le filtre** → les 5 premières montrées :
Maison 2 p., T2, studio, **Parking 15 m² Loos**, **Parking 10 m² Lille**. L'analyse IA résume elle-même « Garage/parking
fermé » mais rien ne s'en sert ; score 72 contre 80 pour les vrais logements.

## Causes, par ordre d'impact

1. **Aucun type de bien n'est demandé à Le Bon Coin.** La requête Apify envoie la catégorie « Locations » (10), la ville,
   le rayon et le budget. Or « Locations » contient les parkings et garages. Avec un budget plafonné, ils sont nombreux
   car bon marché : **8 sur 30 (27 %)** à Lille ≤ 700 €, 3 sur 10 dans le premier lot de Rennes.
2. **On ne regarde que 10 annonces et on en garde 5, dans l'ordre d'Apify.** Chaque parking prend la place d'un logement.
3. **Le filtre « au moins N pièces » laisse passer ce qui n'a pas de nombre de pièces** (`matchesKnownBasics`) : tous les
   parkings (`rooms` absent).
4. **« T1 ou T2 » est compris comme « au moins 1 pièce »** (5/5 formulations) : critère qui n'exclut rien. Les critères
   n'ont pas de maximum de pièces ; « appartement », « pour moi seul » sont perdus (mots-clés vides).
5. **Les chambres en colocation sont souvent étiquetées « Appartement ».** Sur 59 annonces : 3 chambres, dont 2 étiquetées
   `Appartement` (« Chambre avec SDB privée - Coliving », 2 pièces ; « T4 métro Clémenceau », 4 pièces : « je loue cette
   chambre meublée dans un appartement de 4 pièces ») et 1 `Autre`. Seul le texte permet de les reconnaître.

Bug annexe : « Studio ou 2 pièces à Lille » crée un critère nommé « souhait exact de l'utilisateur » (le LLM recopie
l'exemple du prompt d'interprétation).

## Ce que les données permettent (et ce qu'elles interdisent)

- **Parkings : signal fiable.** Le Bon Coin étiquette `real_estate_type` : 1 Maison, 2 Appartement, 4 Parking, 5 Autre.
  Les 11 parkings sur 59 annonces sont tous `Parking` ; toutes les habitations ont un nombre de pièces.
- **Filtrer à la source fonctionne.** L'acteur accepte une URL de recherche Le Bon Coin (`searchUrl`).
  `…/recherche?category=10&locations=Lille_59000__50.63297_3.05858_5000&real_estate_type=1,2&rooms=1-2&price=min-700`
  → 10/10 appartements ou maisons de 1 à 2 pièces à Lille, plus aucun parking ni chambre « Autre », **même prix**
  (0,009 $). Sans coordonnées dans `locations`, l'acteur cherche dans toute la France et coûte 0,024 $.
- **Mots-clés interdits pour la colocation.** « parties communes » apparaît dans 9 logements entiers, « colocation » dans un
  T4 entier : une regex écarterait de bonnes annonces.
- **L'IA sait reconnaître une chambre, preuve à l'appui.** Question posée sur les 59 annonces (logement entier / chambre
  dans un logement partagé / non habitable / incertain, avec citation exacte obligatoire) :
  - passage 1 : 59/59 corrects ;
  - passage 2 : 58/59, l'écart étant une « studette » de 9 m² en résidence étudiante, « sanitaires et cuisine
    collectifs » : cas réellement limite ;
  - toutes les citations sont présentes mot pour mot dans l'annonce.
  Échantillon petit (3 chambres) : à surveiller.

## Résolution proposée

1. **Filtrer à la source** (gain principal, sans risque pour les bons logements) : passer par `searchUrl` avec
   `real_estate_type=1,2`, la fourchette de pièces quand l'utilisateur en donne une, la surface et le budget ; coordonnées
   de la ville via le géocodage IGN déjà en place. Repli sur la requête actuelle si l'URL est refusée.
   Ajouter `maxRooms` aux critères (« T1 ou T2 » → 1 à 2 pièces, « T2 » → 2 à 2 ? à décider : ne pas exclure un T3 si
   l'utilisateur a dit « au moins un T2 »).
2. **Filet de sécurité côté serveur** : écarter `real_estate_type = Parking` si une annonce passe quand même.
3. **Chambres et colocations** : ajouter la question « logement entier ou chambre » à l'analyse IA existante, avec
   citation obligatoire et vérifiée. Une annonce classée « chambre » ou « non habitable » est **mise de côté, jamais
   supprimée** : repliée sous « N annonces écartées (chambre en colocation) » avec la phrase qui le prouve. Si la demande
   parle de colocation, rien n'est écarté (et la catégorie Le Bon Coin « Colocations » (11) est utilisée).
4. **Remplir les 5 places avec des logements** : les annonces mises de côté ne comptent pas dans les 5 retenues.
5. Corriger le prompt d'interprétation (critère « souhait exact de l'utilisateur »).

Tests à ajouter : l'échantillon réel (59 annonces anonymisées) comme jeu de non-régression du filtre et de la
construction d'URL ; tests unitaires de `maxRooms`, du filet parking et de la mise de côté.

## Correction appliquée (01/10/2026)
Décisions : points 1 et 2 retenus ; **toujours des logements entiers** (chambres et colocations écartées, quelle que soit
la demande) ; « un T2 » = exactement 2 pièces, « au moins un T2 » = 2 et plus.

- Critères : `maxRooms` ajouté. « T1 ou T2 » → 1 à 2 pièces, « un T2 » → 2 pièces (vérifié en réel). Libellés
  « 1 à 2 pièces », « 2 pièces », « Au moins 2 pièces ». Faux critère « souhait exact de l'utilisateur » filtré.
- Requête : URL de recherche Le Bon Coin (`searchUrl`) avec `real_estate_type=1,2`, `rooms`, `square`, `price`, mot-clé
  (`text`) et `locations=Ville_CP__lat_lng_rayon` tirés de la base des communes (sans réseau). Vérifié en réel :
  `rooms=2-2` → 10 T2/10, `text=balcon` → 10/10, `square=30-45` → 10/10, même prix (0,009 $). Ville non reconnue
  (département, homonyme) : requête par champs d'avant.
- Filet : `real_estate_type` Parking ou Terrain (libellé ou code) écarté à la lecture.
- Analyse IA : question « logement entier / chambre / non habitable » avec citation exacte vérifiée
  (`ANALYSIS_VERSION` 2 : les annonces en cache sont ré-analysées une fois). Une annonce écartée libère sa place :
  les suivantes sont analysées jusqu'à 5. Les annonces écartées sont journalisées (`Listings set aside`).
- Contrôle de bout en bout en réel : « T1 ou T2 à Lille, 700 € max » → 5 studios et T2 à Lille, aucun parking
  (avant : 2 parkings sur 5) ; « Un T2 à Rennes, 800 € max » → 5 T2.

## Autre défaut trouvé (non corrigé)
Recherche par **département** (« dans le Nord ») : l'acteur cherche dans 5 km autour du centre du département et
renvoie **0 annonce** (constaté en réel, comportement antérieur à cette correction). Piste : `locations=d_59` dans
l'URL de recherche, à vérifier en réel.
