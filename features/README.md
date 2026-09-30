# Features — Vite mon logement

Résumés des études de features menées le 30/09/2026. Un fichier par feature.

| Feature | Statut | Fichier |
|---|---|---|
| Alerte mail | Non commencée (il faut un domaine d'envoi et un compte Resend) ; piste de sélection par score en réflexion, non retenue | [alerte-mail.md](alerte-mail.md) |
| Comptes multi-utilisateurs | Implémenté (inscription sur invitation, favoris en base) | [comptes-multi-utilisateurs.md](comptes-multi-utilisateurs.md) |
| Critères de trajet (transport / voiture) | Non commencée (en attente d'une clé Google Routes) | [criteres-de-trajet.md](criteres-de-trajet.md) |
| Base de villes pré-intégrée | Serveur implémenté ; autocomplétion front à faire | [base-de-villes.md](base-de-villes.md) |
| Refonte UX et saisie en deux temps | Phase 1 + refonte visuelle (style Airbnb, icônes, mobile) faites ; phases 2 à 4 à faire | [refonte-ux-et-saisie-en-deux-temps.md](refonte-ux-et-saisie-en-deux-temps.md) |
| Contacter l'annonceur | Implémenté (une ligne dans la fiche) | [contact-annonceur.md](contact-annonceur.md) |
| Suivi des favoris (statuts liké / contacté / visite, note) | Réflexion seulement, au backlog | [suivi-des-favoris.md](suivi-des-favoris.md) |
| Carte des logements (style Airbnb) | Étude faite : jouable (coordonnées présentes, précision variable selon le vendeur) ; rien de codé | [carte-des-logements.md](carte-des-logements.md) |

Tout ce qui est codé l'est sur la branche `develop`, pas encore sur `main`.

## Tests (à lancer à chaque fois : voir `CLAUDE.md`)
- `pnpm test` : serveur (`node:test`, 55 + 4 `todo` connus) et front (Vitest, 75).
- `pnpm test:e2e` : scénario navigateur mobile puis desktop (9).
- `pnpm test:prod` : vrais Apify/OpenAI, sur demande explicite seulement (non validé : crédit OpenAI épuisé lors du dernier essai).
