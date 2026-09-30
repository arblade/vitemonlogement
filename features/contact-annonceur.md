> **Retiré le 30/09/2026.** Le bouton « Écrire » ne faisait qu'ouvrir l'annonce Le Bon Coin : le bloc (et le message proposé) est supprimé. À la place, un bouton « Voir l'annonce » est fixé dans la barre du haut de la fiche, visible pendant tout le défilement.

# Contacter l'annonceur

**Statut :** implémenté le 30/09/2026 sur `develop` (front seul).

## Demande
Dans chaque fiche de logement, une simple ligne avec les infos pour contacter le vendeur (pas d'encart).

## Implémenté
- Une ligne `ListingContact` (`artifacts/logiscope/src/components/listing-contact.tsx`) dans la fiche détaillée, après les repères essentiels : « Contacter le vendeur · via leboncoin.fr » et un bouton « Écrire » qui ouvre l'annonce.
- Sous la ligne, « Proposer un message » (replié par défaut) : un message type modifiable (disponibilité, une question par critère « non précisé », proposition de visite) avec un bouton « Copier le message ».

## Choix
- L'acteur Apify est lancé avec `includeSeller:false` et `includePhone:false` : on n'a ni nom ni téléphone de l'annonceur, donc la ligne renvoie vers la messagerie du site source. Les activer (surcoût, données personnelles) permettrait d'afficher ces infos dans la ligne.
- Une première version avec un grand encart toujours affiché a été jugée trop lourde ; le message n'est donc visible qu'à la demande.

## Reste à faire
- Afficher le nom et le téléphone du vendeur si l'on décide d'activer `includeSeller` / `includePhone`.
