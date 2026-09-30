# Contacter l'annonceur

**Statut :** implémenté le 30/09/2026 sur `develop` (front seul).

## Demande
Un encart « contacter la personne » disponible dans chaque fiche de logement.

## Implémenté
- Encart `ListingContact` (`artifacts/logiscope/src/components/listing-contact.tsx`) dans la fiche détaillée, après les repères essentiels.
- Bouton « Contacter » en haut de la fiche, qui fait défiler jusqu'à l'encart.
- Message prêt à envoyer, modifiable : disponibilité, une question par critère « non précisé » (5 max), proposition de visite.
- « Copier le message » et « Écrire sur leboncoin.fr » (ouvre l'annonce dans un nouvel onglet).

## Choix
- L'acteur Apify est lancé avec `includeSeller:false` et `includePhone:false` : ni nom ni téléphone de l'annonceur. On ne les active pas (surcoût, données personnelles) ; la messagerie reste sur le site de l'annonce, il n'existe pas de lien direct vers sa messagerie.

## Reste à faire
- Bouton « Contacter » directement sur la carte de la liste (non demandé).
- Envoi de message depuis l'app : impossible sans accès à la messagerie du site source.
