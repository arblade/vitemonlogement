# Bilan financier (01/10/2026)

Mesures réelles (runs Apify facturés, tokens OpenAI comptés sur de vrais appels) ; tarifs vérifiés le 01/10/2026.
1 $ ≈ 0,85 €.

## Ce que coûte une recherche

| Poste | Le Bon Coin seul (prod actuelle) | 3 sources (branche `develop`) |
|---|---|---|
| Apify Le Bon Coin, recherche ciblée | 0,024 $ | 0,024 $ |
| Apify Le Bon Coin, recherche élargie (si la demande contient un souhait : balcon, parking…) | 0 à 0,024 $ | 0 à 0,024 $ |
| Apify SeLoger (10 annonces avec détail) | — | 0,038 $ |
| Apify PAP (10 annonces ; 0,005 $ s'il n'y a rien) | — | 0,005 à 0,045 $ |
| OpenAI gpt-5-mini : interprétation (≈ 0,002 $) + analyse de 5 annonces (≈ 0,012 $) | 0,014 à 0,04 $ | 0,014 à 0,04 $ |
| **Total par recherche** | **0,04 à 0,09 $** | **0,12 à 0,17 $** (≈ 0,10 à 0,15 €) |
| **Pour 10 recherches** | 0,4 à 0,9 $ | **1,2 à 1,7 $ (≈ 1 à 1,45 €)** |

- « Chercher d'autres annonces » relance une recherche complète : même coût.
- OpenAI : 0,25 $ / million de tokens en entrée, 2 $ en sortie. Mesuré : ≈ 540 + 870 tokens pour
  l'interprétation, ≈ 2 400 + 5 600 par lot de 5 annonces (le modèle « réfléchit » : la sortie domine). Une annonce
  déjà analysée n'est jamais repayée (cache). Plus cher quand des annonces sont écartées (chambres) et remplacées.
- Gratuits : géocodage IGN, fond de carte OpenFreeMap, code de lieu SeLoger (run sans annonce, 0 $ mesuré).

## Coûts fixes et services à plafond gratuit

| Service | Offre | Coût |
|---|---|---|
| Render (serveur web, Starter 512 Mo) | payant | **7 $/mois** |
| Neon (Postgres) | offre non vérifiée d'ici (probablement gratuite) | 0 $ ? |
| Apify | **offre gratuite : 5 $ d'usage par mois, plafond strict** | 0 $, mais les recherches échouent au-delà |
| Google Routes (trajets, si `GOOGLE_MAPS_API_KEY` est posée) | 10 000 appels gratuits/mois (Essentials) ; plafond app 300/jour ≈ 9 000/mois | 0 $ si Essentials ; jusqu'à ≈ 40 $/mois si Google facture en Pro (5 000 gratuits) |
| OpenAI | paiement à l'usage, **aucun plafond côté app hormis les quotas de requêtes** | voir ci-dessus |

## Par mois, selon l'usage (Render compris)

| Recherches | Le Bon Coin seul | 3 sources | dont Apify (3 sources) |
|---|---|---|---|
| 3 par jour (90/mois) | ≈ 12 $ | ≈ 20 $ | ≈ 11 $ |
| 10 par jour (300/mois) | ≈ 22 $ | ≈ 50 $ | ≈ 36 $ |
| 30 par jour (900/mois) | ≈ 52 $ | ≈ 140 $ | ≈ 110 $ |

Apify gratuit (5 $/mois) couvre ≈ 40 recherches à 3 sources, ou ≈ 100 à 200 avec Le Bon Coin seul. Au-delà : offre
Starter, 29 $/mois, qui est un crédit d'usage prépayé (non reporté), puis paiement à l'usage.

## État du compte Apify aujourd'hui
Cycle du 14/09 au 13/10 : **2,10 $ consommés sur 5 $** (dont 1,35 $ aujourd'hui, surtout les enquêtes et tests réels).
Reste 2,90 $ : ≈ 22 recherches à 3 sources, ou ≈ 60 à 120 avec Le Bon Coin seul, d'ici le 13/10. Ensuite, toute
recherche échoue (« La recherche n'a pas pu aboutir ») jusqu'au cycle suivant.

## Pire cas autorisé aujourd'hui par l'app
Plafond global `QUOTA_GLOBAL_PER_DAY` = 300 actions coûteuses par jour (et 30 par heure et par compte, 40 par IP) :
300 × 0,17 $ ≈ **51 $ par jour**. En pratique Apify gratuit bloque à 5 $ ; **OpenAI, lui, n'a pas de plafond** :
≈ 12 $/jour au pire (≈ 360 $/mois) si quelqu'un enchaîne les recherches.

## Recommandations
1. **Plafond OpenAI** : budget mensuel dans la console OpenAI (Limits → budget du projet), par exemple 10 $.
2. **Baisser les quotas de l'app** (variables Render, sans code) : `QUOTA_GLOBAL_PER_DAY=30`,
   `QUOTA_COOKIE_PER_HOUR=10`. Pire cas ≈ 5 $/jour.
3. **Sources** : tant qu'Apify est en gratuit, mettre `LISTING_SOURCES=leboncoin` sur Render (ou passer Apify en
   Starter 29 $/mois). Option code : 5 annonces par source au lieu de 10 → 3 sources ≈ 0,07 $ d'Apify par recherche.
4. **Google** : alerte de budget dans la console Google Cloud ; `GOOGLE_ROUTES_PER_DAY=160` reste sous les 5 000
   gratuits même en tarif Pro.
5. Option code : un **budget quotidien en dollars** dans l'app (coût de chaque run compté en base, recherches
   refusées au-delà de X $/jour), plus fiable que des quotas en nombre de requêtes.
