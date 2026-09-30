# Contacter l'annonceur

**Statut :** implémenté le 30/09/2026 sur `develop` (front seul).

## Demande
Dans chaque fiche de logement, une simple ligne avec les infos pour contacter le vendeur (pas d'encart).

## Implémenté
- Une ligne `ListingContact` (`artifacts/logiscope/src/components/listing-contact.tsx`) dans la fiche détaillée, après les repères essentiels : « Contacter le vendeur · via leboncoin.fr » et un bouton « Écrire » qui ouvre l'annonce.

## Choix
- L'acteur Apify est lancé avec `includeSeller:false` et `includePhone:false` : on n'a ni nom ni téléphone de l'annonceur, donc la ligne renvoie vers la messagerie du site source. Les activer (surcoût, données personnelles) permettrait d'afficher ces infos dans la ligne.
- Une première version avec encart, message prérempli et copie dans le presse-papiers a été retirée à la demande : trop lourde.

## Reste à faire
- Afficher le nom et le téléphone du vendeur si l'on décide d'activer `includeSeller` / `includePhone`.
