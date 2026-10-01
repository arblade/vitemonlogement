# Features — Vite mon logement

Résumés des études de features menées le 30/09/2026. Un fichier par feature.

| Feature | Statut | Fichier |
|---|---|---|
| Alerte mail | Non commencée (il faut un domaine d'envoi et un compte Resend) ; piste de sélection par score en réflexion, non retenue | [alerte-mail.md](alerte-mail.md) |
| Comptes multi-utilisateurs | Implémenté (inscription sur invitation, favoris en base) | [comptes-multi-utilisateurs.md](comptes-multi-utilisateurs.md) |
| Critères de trajet (transport / voiture) | Temps et tracé de trajet vers les lieux cités affichés dans la fiche (code prêt, actif dès que `GOOGLE_MAPS_API_KEY` est posée) ; filtre « moins de 30 min » pas encore fait | [criteres-de-trajet.md](criteres-de-trajet.md) |
| Base de villes pré-intégrée | Serveur implémenté ; autocomplétion front à faire | [base-de-villes.md](base-de-villes.md) |
| Refonte UX et saisie en deux temps | Phase 1 + refonte visuelle (style Airbnb, icônes, mobile) faites ; phases 2 à 4 à faire | [refonte-ux-et-saisie-en-deux-temps.md](refonte-ux-et-saisie-en-deux-temps.md) |
| Contacter l'annonceur | Retiré le 30/09 (le bouton « Écrire » menait juste à Le Bon Coin) ; remplacé par « Voir l'annonce », toujours visible en haut de la fiche | [contact-annonceur.md](contact-annonceur.md) |
| Suivi des favoris (statuts liké / contacté / visite, note) | Réflexion seulement, au backlog | [suivi-des-favoris.md](suivi-des-favoris.md) |
| Carte des logements (style Airbnb) | Fiche : carte (point si adresse exacte ou rue, cercle si quartier ou commune), lieux de vie extraits de la demande, trajet Google si clé. Liste : bouton « Voir la carte » (fait le 01/10), pastilles de prix des seuls logements à position précise, un clic ouvre la fiche | [carte-des-logements.md](carte-des-logements.md) |

La carte est sur `develop` ; le reste est aussi sur `main`.

## Tests (à lancer à chaque fois : voir `CLAUDE.md`)
- `pnpm test` : serveur (`node:test`, 94 + 4 `todo` connus) et front (Vitest, 97).
- `pnpm test:e2e` : scénario navigateur mobile puis desktop (12).
- `pnpm test:prod` : vrais Apify/OpenAI, sur demande explicite seulement (non validé : crédit OpenAI épuisé lors du dernier essai).
| Logements entiers seulement (parkings, colocations) | Corrigé le 01/10 après signalement : recherche Le Bon Coin limitée aux appartements et maisons avec fourchette de pièces, parkings écartés, chambres et colocations écartées par l'analyse IA (citation exigée) ; recherche par département à corriger | [enquete-parkings-colocations.md](enquete-parkings-colocations.md) |
| Autres sources d'annonces (SeLoger, PAP) | Branchées et testées le 01/10, mais **désactivées en dur** (`ACTIVE_EXTRA_SOURCES = []` dans `sources.ts`) : trop cher pour l'instant, seul Le Bon Coin est interrogé ; location uniquement (double verrou testé), annonces alternées et dédoublonnées, source affichée | [sources-seloger-pap.md](sources-seloger-pap.md) |
| Bilan financier | Fait le 01/10 : ≈ 0,12 à 0,17 $ par recherche à 3 sources (0,04 à 0,09 $ avec Le Bon Coin seul), Render 7 $/mois ; Apify en offre gratuite plafonnée à 5 $/mois ; OpenAI sans plafond | [bilan-financier.md](bilan-financier.md) |
| Réduction des coûts | Appliqué le 01/10 (develop) : acteur Le Bon Coin `fatihtahta`, recherche élargie supprimée, SeLoger 6 et PAP 4 annonces, réflexion OpenAI « faible » → ≈ 0,055 $ d'Apify + ≈ 0,007 à 0,02 $ d'OpenAI par recherche à 3 sources (0,12 à 0,17 $ avant) | [reduction-des-couts.md](reduction-des-couts.md) |
| Alternatives à Apify | Étude faite le 01/10 (tarifs publics, sans essai réel) : Stream Estate (ex-Melo, données agrégées et dédoublonnées, ≈ 0,08 € par recherche ou 99 €/mois) en plan B ; API de scraping (Scrape.do, Bright Data, Zyte, Scrapfly, ScrapingBee) pas moins chères qu'Apify optimisé et beaucoup plus de maintenance | [scrapers-hors-apify.md](scrapers-hors-apify.md) |
| Position depuis la description (agences) | **Implémenté le 01/10** : la voie citée dans la description (lue par l'IA, citation vérifiée) est géocodée par l'IGN (code postal, score ≥ 0,7) pour les annonces placées au quartier ou à la commune ; la fiche dit « adresse lue dans la description » ; étude : 45 % de ces annonces placées, erreur médiane 31 m ; piste ADEME non faite | [position-depuis-la-description.md](position-depuis-la-description.md) |
| Affichage des caractéristiques | **Carte allégée le 01/10** : critères et caractéristiques en une rangée de pastilles sans titres (mots simples, icônes), « Fiche complète » en bouton principal, « Voir sur … » et « Comparer » en secondaire ; plus de rang · site ni « Détails, sources et preuves ». **Fiche : proposition à valider** (liste à icônes groupée façon Airbnb, critères compacts, échelle DPE) | [affichage-des-caracteristiques.md](affichage-des-caracteristiques.md) |
