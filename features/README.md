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
| Carte des logements (style Airbnb) | Preuve de concept faite : carte dans la fiche (point si adresse exacte ou rue, cercle si quartier ou commune), lieux de vie extraits de la demande, trajet Google si clé ; carte de la liste de résultats à faire | [carte-des-logements.md](carte-des-logements.md) |

La carte est sur `develop` ; le reste est aussi sur `main`.

## Tests (à lancer à chaque fois : voir `CLAUDE.md`)
- `pnpm test` : serveur (`node:test`, 94 + 4 `todo` connus) et front (Vitest, 97).
- `pnpm test:e2e` : scénario navigateur mobile puis desktop (12).
- `pnpm test:prod` : vrais Apify/OpenAI, sur demande explicite seulement (non validé : crédit OpenAI épuisé lors du dernier essai).
| Logements entiers seulement (parkings, colocations) | Corrigé le 01/10 après signalement : recherche Le Bon Coin limitée aux appartements et maisons avec fourchette de pièces, parkings écartés, chambres et colocations écartées par l'analyse IA (citation exigée) ; recherche par département à corriger | [enquete-parkings-colocations.md](enquete-parkings-colocations.md) |
| Autres sources d'annonces (SeLoger, PAP) | Branchées le 01/10 : Le Bon Coin, SeLoger et PAP en parallèle, location uniquement (double verrou testé), annonces alternées et dédoublonnées, source affichée ; ≈ 0,11 $ d'Apify par recherche au lieu de 0,024 $ | [sources-seloger-pap.md](sources-seloger-pap.md) |
| Bilan financier | Fait le 01/10 : ≈ 0,12 à 0,17 $ par recherche à 3 sources (0,04 à 0,09 $ avec Le Bon Coin seul), Render 7 $/mois ; Apify en offre gratuite plafonnée à 5 $/mois ; OpenAI sans plafond | [bilan-financier.md](bilan-financier.md) |
| Réduction des coûts | Appliqué le 01/10 (develop) : acteur Le Bon Coin `fatihtahta`, recherche élargie supprimée, SeLoger 6 et PAP 4 annonces → ≈ 0,055 $ d'Apify par recherche à 3 sources au lieu de 0,107 à 0,131 $ ; réglage OpenAI à faire | [reduction-des-couts.md](reduction-des-couts.md) |
| Alternatives à Apify | Étude faite le 01/10 (tarifs publics, sans essai réel) : Stream Estate (ex-Melo, données agrégées et dédoublonnées, ≈ 0,08 € par recherche ou 99 €/mois) en plan B ; API de scraping (Scrape.do, Bright Data, Zyte, Scrapfly, ScrapingBee) pas moins chères qu'Apify optimisé et beaucoup plus de maintenance | [scrapers-hors-apify.md](scrapers-hors-apify.md) |
