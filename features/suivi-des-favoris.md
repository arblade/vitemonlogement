# Suivi des favoris (statuts et note)

**Statut :** réflexion uniquement, rien de codé, mis au backlog.
**Source :** conversation du 30/09/2026.

> **⚠️ Étape de réflexion.** Les choix ci-dessous sont des pistes à rediscuter avant implémentation. Les règles d'envoi de mail qui en découlent (seuil, sélection) sont dans [alerte-mail.md](alerte-mail.md) et ne font pas partie de cette feature.

## Problème
Avec un simple like, la liste de favoris devient au bout de quelques jours un tas d'annonces sans ordre : on ne sait plus lesquelles ont été contactées ou visitées. Le but est de passer d'un « moteur de recherche » à un « suivi de recherche », sans alourdir l'interface.

## Piste retenue
Le bouton cœur ne change pas : un tap = liké (état par défaut). Une fois liké, l'annonce peut passer par trois états :

| État | Sens |
|---|---|
| **Liké** | Ça m'intéresse (défaut au tap sur le cœur) |
| **Contacté** | J'ai écrit ou appelé |
| **Visite** | Visite prévue ou faite |

**Écarté = déliker.** Pas de quatrième état : retirer le cœur suffit.

## Interface envisagée
- Carte du logement : le cœur reste un simple tap. Une fois liké, un petit badge d'état à côté du cœur ; un tap dessus ouvre un mini-menu (les trois états + « Retirer des favoris »).
- Liste des favoris : même badge cliquable, avec éventuellement un filtre par état en haut.
- **Note libre** (un seul champ texte, sans structure) sur la fiche du logement, pas sur la carte, pour ne pas la surcharger.

## Données (à confirmer)
- Table `favorites` existante : ajouter une colonne `status` (liké / contacté / visite) et un champ `note`. Les favoris sont déjà en base, liés à l'utilisateur (voir [comptes-multi-utilisateurs.md](comptes-multi-utilisateurs.md)).
- Le travail exact (migration, routes `/api/favorites`, UI) n'a pas été chiffré : à regarder dans le code au moment de l'implémentation.

## Point d'attention
Délikker remet l'annonce dans l'état neutre : elle pourrait réapparaître dans les recherches ou les mails. Les mails se basent uniquement sur « déjà envoyé ou non » (voir alerte-mail.md) ; pour les recherches, il reste à décider si l'on garde la mémoire des annonces délikées.

## Hors périmètre (plus tard)
- Notes par critère, comparateur côte à côte.
- Partage de la liste avec un colocataire ou conjoint (probable première évolution après le MVP).
- Rappels de relance automatiques.
