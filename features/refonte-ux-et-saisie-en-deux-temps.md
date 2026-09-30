# Refonte UX / design et saisie en deux temps

**Statut :** audit terminé ; phase 1 (quick wins front) implémentée le 30/09/2026 sur `develop` ; phases 2 à 4 non codées.

## Phase 1 réalisée
- Annonces consultées : elles ne sont plus repoussées en bas avant le tri, elles restent grisées à leur place.
- Bloc technique « Requêtes envoyées à Leboncoin » (JSON Apify) masqué, visible avec `?debug=1`.
- Bloc promotionnel « Le tri est fait » supprimé ; bandeau de la page résultats et titres réduits ; « Affiner votre recherche » compacté.
- Vocabulaire : « Refresh » → « Chercher d'autres annonces », « J'aime / annonces aimées » → « Favoris ».
- Style : une seule police (DM Sans ; Instrument Serif et Space Mono retirées), aucun texte sous 12 px (52 occurrences de 8 à 11 px), 14 couleurs principales passées en jetons de thème (`ink`, `lime`, `line`, `sage`…). Il reste environ 190 occurrences de couleurs en dur moins fréquentes.
- Refonte visuelle « moderne, épurée » (30/09/2026) : thème clair neutre, police Inter, une seule couleur d'accent (émeraude), boutons noirs, suppression des bandeaux sombres, du grain et des italiques serif. Accueil centré avec grand champ de saisie arrondi (bouton « Rechercher » intégré, exemples en pastilles). Toutes les couleurs en dur ont été converties vers la nouvelle palette ; les jetons de thème (`ink`, `stone`, `line`, `sage`, `lime` = accent…) restent les points d'entrée.
- Non fait de cette phase : accueil orienté bénéfice et bloc avant/après (phase 2), groupes « Correspond / Pistes proches » (phase 2).
 Doc complet : « Vite mon logement — Audit UX et plan de refonte ».
**Source :** conversation « Design et UX de l'app » (30/09/2026)

## Demande
Une app simple dont le concept se comprend dès l'accueil, pour des utilisateurs non techniques : cartes de logements à la fois simples et assez détaillées pour savoir sur quoi cliquer, fiche détaillée riche mais non surchargée, menus et workflow repensés (le design actuel, issu de Replit, est jugé insuffisant). Réflexion sur la saisie : un seul champ suffit-il ? Questions optionnelles générées par l'IA, et validation des critères statiques (ex. 400–800 €/mois = loyer) avant lancement.

## Diagnostic (d'après la lecture du code, pas d'un usage réel)
- Accueil : le concept ne se lit pas, la page ressemble à un moteur de recherche de plus.
- Saisie : la ville n'est vérifiée qu'après lancement, d'où des recherches « échouées » ; aucune correction possible de ce que l'IA a compris.
- Résultats : bandeau géant, JSON Apify visible, plusieurs blocs avant la première annonce.
- Carte : une douzaine de blocs, prix et localisation pesant autant que le reste.
- Tri : les annonces vues sont repoussées en bas avant tout tri ; vocabulaire de développeur (« Refresh »).
- Fiche : modale sans URL propre, bouton Leboncoin tout en bas.
- Style : trois polices, 52 usages de textes de 9 à 11 px, environ 150 couleurs en dur.

## Nouveau parcours en 4 écrans
1. **Décrire** (accueil) : un champ libre, concept expliqué autour (titre orienté bénéfice, bloc avant/après, trois étapes, historique réduit).
2. **Vérifier** (optionnel) : critères chiffrés pré-remplis et modifiables, souhaits flous en puces « Indispensable / Si possible », au plus 3 questions IA toujours ignorables, erreurs (ville manquante) signalées tout de suite.
3. **Choisir** (résultats) : bandeau de critères compact, filtres rapides, cartes à six blocs, groupes « Correspond à votre recherche » et « Pistes proches », un seul tri sur toute la liste.
4. **Décider** (fiche) : page dédiée avec URL propre, verdict « 4 critères sur 5 confirmés », preuves repliées, bouton « Voir l'annonce » collé en bas sur mobile.

## Menus et identité
- Desktop : Mes recherches, Favoris, bouton plein « Nouvelle recherche ». Mobile : barre d'onglets en bas.
- Une seule police, 16 px minimum pour le texte, variables de couleur à la place des valeurs en dur, tableau de vocabulaire (ex. « Refresh » → « Chercher d'autres annonces »).

## Impacts techniques de la saisie en deux temps
- `POST /housing/interpret` existe côté API mais le front ne l'appelle pas encore ; à étendre (chambres, type de bien, charges comprises, meublé, importance des souhaits, `questions[]`).
- `POST /housing/searches` accepte des critères validés ; le pipeline n'interprète que si la ville est vide.
- **Quotas :** interprétation et création comptent chacune, donc 2 unités par recherche au lieu d'une.
- Prérequis : corriger les écarts d'interprétation du rapport du 29/09 (chambres lues comme pièces, « charges comprises » perdu, type de bien non transmis, limite de huit souhaits).

## Plan en 4 phases (livrables séparément)
1. Nettoyage et quick wins, front seul (taille S, 1 à 2 jours).
2. Carte, fiche, bandeau de critères (M, 3 à 4 jours).
3. Saisie en deux temps (L, 4 à 6 jours).
4. Suite produit : comptes, alerte e-mail, localisation/carte (à chiffrer). Voir [comptes-multi-utilisateurs](comptes-multi-utilisateurs.md), [alerte-mail](alerte-mail.md), [criteres-de-trajet](criteres-de-trajet.md).

## Décisions à trancher
1. Souhait « Indispensable » contredit : écarter ou reléguer (recommandation : reléguer).
2. Page « Vérifier » : toujours ou seulement s'il manque une info (recommandation : toujours, avec option pour la sauter).
3. Quotas : ne plus compter l'interprétation, ou relever les plafonds.
4. Score chiffré : le retirer de l'affichage au profit de « 4 critères sur 5 » (recommandation : oui).
5. Fiche en page dédiée plutôt qu'en modale (recommandation : oui).

## Limites
Constats issus du code, pas de captures ni d'usage réel ; schémas en texte ; tailles estimées ; filtre de type de bien dépendant de l'acteur Apify (non vérifié) ; chaîne OpenAI + Apify jamais testée de bout en bout.
