# Annonces disparues de Le Bon Coin (20/10/2026)

Besoin : ne plus afficher une annonce qui n'est plus en ligne (supprimée, louée, expirée), **sans appel payant de plus**
(vérifier chaque annonce une à une coûterait trop cher en Apify).

## Principe : l'absence dans la tête de liste
Les résultats Le Bon Coin arrivent triés de la plus récemment mise à jour à la plus ancienne. Un passage de lecture (veille,
recherche, « Étendre ») lit le haut de cette liste jusqu'à l'annonce la plus ancienne lue (`oldest`). Dans cette plage, **toute
annonce en ligne qui correspond à la recherche est là**. Une annonce déjà connue, mise à jour après `oldest` et **absente** du
passage, n'est donc plus en ligne.

- Chaque annonce lue est marquée « vue » par le passage (`seen_pass_at`), même si les filtres l'écartent.
- En fin de passage, `detectGone` (store.ts) compte une absence (`missed_passes`) pour chaque annonce attendue et manquante ;
  à la **2e absence de suite** (`GONE_AFTER_PASSES`, 2 par défaut) elle est jugée disparue (`gone_at`) et **n'est plus
  affichée** (liste, compte des nouvelles, e-mail de la veille). Une annonce revue repart de zéro, et une annonce jugée disparue
  qui revient est rétablie.
- Plage : « du bas de la lecture vers le haut » ; si la lecture va jusqu'à **la fin de la liste**, toutes les annonces connues
  sont vérifiées, même les plus anciennes ; pour « Étendre » (une page plus ancienne), la plage est bornée en haut aussi.
- Garde-fous : seulement l'acteur à URL (résultats triés), seulement Le Bon Coin, annonces masquées ignorées ; si **aucune** des
  3 annonces attendues (ou plus) n'est revenue, la lecture est jugée suspecte (site modifié, blocage) et rien n'est enregistré ;
  une panne de la détection ne casse jamais un passage.
- **Favoris** : le favori reste, avec un badge « Plus disponible » (`GET /api/favorites` renvoie `gone`, d'après la recherche
  d'où vient le favori).

## Limite à connaître (et son réglage)
La veille ne lit que ce qui est nouveau depuis le passage précédent (curseur) : une annonce déjà vue est ensuite **hors de la
plage lue**, donc non vérifiée. Sans réglage, seules les annonces à la limite de la lecture (et celles des recherches courtes,
lues jusqu'à la fin) sont contrôlées : la détection est **faible** en veille.

`VERIFY_DAYS` (0 par défaut, variable d'environnement Render, sans déploiement) fait relire plus loin à chaque passage : les N
derniers jours de la liste. Coût : 0,001 $ par annonce lue en plus, soit ≈ les annonces mises à jour pendant ces N jours
(recherche très active comme Lille : ≈ 60 par jour, soit ≈ 0,06 $ par jour et par jour relu, par passage ; recherche calme :
quelques centimes par mois). Plafond existant de 3 pages (105 annonces) par passage. La relève n'est jamais « partielle » du
seul fait de cette relecture. **Recommandation : essayer `VERIFY_DAYS=2` et regarder la consommation Apify.**

Limites restantes : une annonce disparue d'une recherche ponctuelle jamais relue n'est pas détectée ; une annonce remontée
pendant la lecture d'un passage de plusieurs pages peut manquer une fois (d'où les 2 passages de suite).

## Tests
`disparition.test.ts` (règle, plage, fin de liste, « Étendre », garde-fou, deux passages de veille réels avec faux Apify,
`VERIFY_DAYS`), `accounts.test.ts` (drapeau sur les favoris), `likes.test.tsx` (badge), `e2e` (favori « Plus disponible » en
mobile puis desktop). Migration `0012_annonces_disparues` (3 colonnes sur `housing_listings`).
