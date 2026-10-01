# Bilan financier (01/10/2026)

Mesures réelles (runs Apify facturés, tokens OpenAI comptés sur de vrais appels) ; tarifs vérifiés le 01/10/2026.
1 $ ≈ 0,85 €.

## Ce que coûte une recherche, ligne par ligne

Facturation réelle lue sur les runs (`chargedEventCounts`), offre Apify gratuite. Une recherche lit 10 annonces par
source et en montre 5.

### Apify

| Source | Démarrage (par run, fixe) | Par annonce | 10 annonces | Pour 1 000 annonces |
|---|---|---|---|---|
| Le Bon Coin (`clearpath`) | 0,009 $ | 0,00149 $ | 0,009 + 0,0149 = **0,0239 $** | 1,49 $ d'annonces + 0,90 $ de démarrages = 2,39 $ |
| SeLoger (`silentflow`, annonce complète) | 0,004 $ | 0,0034 $ | 0,004 + 0,034 = **0,038 $** | 3,80 $ |
| PAP (`clearpath`) | 0,005 $ | 0,004 $ | 0,005 + 0,040 = **0,045 $** (0,005 $ si PAP n'a rien) | 4,50 $ |
| Code de ville SeLoger (`abotapi`, 1re recherche d'une ville) | 0 $ mesuré | — | 0 $ | — |

Le tarif « ≈ 1 € pour 1 000 annonces » de Le Bon Coin (1,49 $) est juste, mais **chaque run paie aussi 0,009 $ de
démarrage, l'équivalent de 6 annonces**. Avec 10 annonces par run, le démarrage fait 38 % du prix, et une annonce
revient en réalité à 0,0024 $. Le Bon Coin est interrogé une 2e fois (recherche élargie) quand la demande contient
un souhait (balcon, parking…) : un 2e démarrage et 10 annonces de plus.
Offres Apify payantes : l'annonce Le Bon Coin descend à 0,00129 $ (Scale) et 0,00099 $ (Business) ; Starter
(29 $/mois) garde 0,00149 $.

### OpenAI (gpt-5-mini : 0,25 $ / million de tokens en entrée, 2 $ en sortie)

| Appel | Tokens (mesurés) | Coût |
|---|---|---|
| Interprétation de la demande | ≈ 540 entrée + 650 à 870 sortie | ≈ 0,0016 à 0,0019 $ |
| Analyse d'un lot de 5 annonces | ≈ 2 400 entrée + 5 600 sortie (dont la « réflexion » du modèle) | ≈ 0,0118 $ |
| Lot supplémentaire, si des annonces sont écartées (chambres) et remplacées | idem | + 0,0118 $ par lot |

### Total par recherche

| Recherche | Le Bon Coin seul (prod) | 3 sources (`develop`) |
|---|---|---|
| Sans souhait (« T2 à Rennes, 800 € max ») | 0,0239 + 0,0016 + 0,0118 = **0,037 $** | 0,0239 + 0,038 + 0,045 + 0,0134 = **0,120 $** |
| Avec souhait (« … avec balcon ») | + 0,0239 = **0,061 $** | **0,144 $** |
| Avec un lot IA de plus (annonces écartées) | 0,073 $ | 0,156 $ |
| **Pour 10 recherches** | **0,37 à 0,73 $** (≈ 0,3 à 0,6 €) | **1,20 à 1,56 $** (≈ 1,0 à 1,3 €) |
| Pour 1 000 recherches | 37 à 73 $ | 120 à 156 $ |

- « Chercher d'autres annonces » relance une recherche complète : même coût.
- Une annonce déjà analysée n'est jamais repayée à OpenAI (cache).
- Gratuits : géocodage IGN, fond de carte OpenFreeMap.

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
