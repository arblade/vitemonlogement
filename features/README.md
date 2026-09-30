# Features — Vite mon logement

Résumés des études de features menées le 30/09/2026. Un fichier par feature.

| Feature | Statut | Fichier |
|---|---|---|
| Alerte mail | Non commencée (il faut un domaine d'envoi et un compte Resend) ; piste de sélection par score en réflexion, non retenue | [alerte-mail.md](alerte-mail.md) |
| Comptes multi-utilisateurs | Implémenté (inscription sur invitation, favoris en base) | [comptes-multi-utilisateurs.md](comptes-multi-utilisateurs.md) |
| Critères de trajet (transport / voiture) | Temps et tracé de trajet vers les lieux cités affichés dans la fiche (code prêt, actif dès que `GOOGLE_MAPS_API_KEY` est posée) ; filtre « moins de 30 min » pas encore fait | [criteres-de-trajet.md](criteres-de-trajet.md) |
| Base de villes pré-intégrée | Serveur implémenté ; autocomplétion front à faire | [base-de-villes.md](base-de-villes.md) |
| Refonte UX et saisie en deux temps | Phase 1 + refonte visuelle (style Airbnb, icônes, mobile) faites ; phases 2 à 4 à faire | [refonte-ux-et-saisie-en-deux-temps.md](refonte-ux-et-saisie-en-deux-temps.md) |
| Contacter l'annonceur | Implémenté (une ligne dans la fiche) | [contact-annonceur.md](contact-annonceur.md) |
| Suivi des favoris (statuts liké / contacté / visite, note) | Réflexion seulement, au backlog | [suivi-des-favoris.md](suivi-des-favoris.md) |
| Carte des logements (style Airbnb) | Preuve de concept faite : carte dans la fiche (point si adresse exacte ou rue, cercle si quartier ou commune), lieux de vie extraits de la demande, trajet Google si clé ; carte de la liste de résultats à faire | [carte-des-logements.md](carte-des-logements.md) |

La carte est sur `develop` ; le reste est aussi sur `main`.

## Tests (à lancer à chaque fois : voir `CLAUDE.md`)
- `pnpm test` : serveur (`node:test`, 85 + 4 `todo` connus) et front (Vitest, 101).
- `pnpm test:e2e` : scénario navigateur mobile puis desktop (12).
- `pnpm test:prod` : vrais Apify/OpenAI, sur demande explicite seulement (non validé : crédit OpenAI épuisé lors du dernier essai).
