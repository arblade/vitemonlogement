# Bilan financier détaillé (01/10/2026)

Sources : facturation réelle lue sur chaque run Apify (`chargedEventCounts`), tokens OpenAI comptés sur de vrais
appels, tarifs publics vérifiés le 01/10/2026, configuration Render lue sur le service. 1 $ ≈ 0,85 €.
« prod » = branche `main` (Le Bon Coin seul) ; « develop » = 3 sources (Le Bon Coin, SeLoger, PAP), non déployé.

## 1. Les services et leur tarif unitaire

| Service | Rôle | Offre actuelle | Tarif unitaire |
|---|---|---|---|
| Apify — Le Bon Coin (`clearpath/leboncoin-api`) | lire les annonces | Apify gratuit | **0,009 $ par run** (démarrage) + **0,00149 $ par annonce** |
| Apify — SeLoger (`silentflow/seloger-scraper-ppr`) | lire les annonces | Apify gratuit | 0,004 $ par run + 0,0034 $ par annonce complète (facturé) |
| Apify — PAP (`clearpath/pap-scraper`) | lire les annonces | Apify gratuit | 0,005 $ par run + 0,00399 $ par annonce + 0,00001 $ par ligne |
| Apify — code de ville SeLoger (`abotapi`) | 1 fois par ville | Apify gratuit | 0 $ mesuré (run sans annonce) |
| OpenAI `gpt-5-mini` | lire la demande, analyser les annonces | paiement à l'usage | 0,25 $ / million de tokens en entrée, 2 $ / million en sortie |
| Google Routes (Compute Routes, Essentials) | temps de trajet dans la fiche | si `GOOGLE_MAPS_API_KEY` est posée | 10 000 appels gratuits / mois, puis 5 $ / 1 000. Nos appels restent en Essentials (le tarif Pro ne vise que le trafic temps réel, l'optimisation ou 11+ étapes) |
| IGN Géoplateforme | géocoder les lieux cités | gratuit, sans clé | 0 $ |
| OpenFreeMap | fond de carte | gratuit, sans clé | 0 $ |
| Render | héberger l'app | service web Starter (0,5 CPU, 512 Mo), Francfort, 1 instance | **7 $ / mois** |
| Neon | base Postgres | non vérifiable d'ici | 0 $ si offre gratuite |

Le démarrage d'un run Apify est facturé « un par Go de mémoire, minimum un » : nos runs tournent à 128–256 Mo, donc
un seul démarrage par run.

## 2. Ce que déclenche une recherche, étape par étape

| Étape | Service | Quand | Coût |
|---|---|---|---|
| 1. Lire la demande | OpenAI, 1 appel | toujours | ≈ 540 tokens entrée + 650 à 870 sortie = **0,0016 à 0,0019 $** |
| 2. Géocoder les lieux cités (travail, école…) | IGN | si la demande en cite | 0 $ |
| 3. Le Bon Coin, recherche ciblée | Apify, 1 run de 10 annonces | toujours | 0,009 + 10 × 0,00149 = **0,0239 $** |
| 4. SeLoger | Apify, 1 run de 10 annonces | develop, ville reconnue | 0,004 + 10 × 0,0034 = **0,038 $** |
| 4 bis. Code de ville SeLoger | Apify, 1 run sans annonce | 1re recherche de la ville | 0 $ |
| 5. PAP | Apify, 1 run de 10 annonces | develop, ville reconnue | 0,005 + 10 × 0,0040 = **0,045 $** ; **0,005 $** si PAP n'a rien |
| 6. Suivi des runs, lecture des résultats | Apify | toujours | 0 $ |
| 7. Analyser les 5 annonces retenues | OpenAI, 1 appel par lot de 5 | toujours | ≈ 2 400 tokens entrée + 5 600 sortie = **0,0118 $** |
| 7 bis. Lot de remplacement | OpenAI | si des annonces sont écartées (chambres, contradictions) | **+ 0,0118 $** par lot |
| 8. Le Bon Coin, recherche élargie | Apify, 1 run de 10 annonces | demande avec souhait (balcon, parking, meublé…) et moins de 40 annonces retenues : presque toujours dans ce cas | **+ 0,0239 $** |
| 9. Analyser les annonces de la recherche élargie | OpenAI | nouvelles annonces retenues | 0 à 0,0118 $ |

Une annonce déjà analysée (même adresse, même texte) n'est jamais repayée à OpenAI, quelle que soit la recherche.

## 3. Autres actions payantes de l'interface

| Action | Ce qu'elle déclenche | Coût |
|---|---|---|
| Nouvelle recherche, « Modifier ma demande » | tout le tableau 2 | voir § 4 |
| « Chercher d'autres annonces » | tout le tableau 2, sauf les annonces déjà analysées | ≈ même coût qu'une recherche |
| Ouvrir une fiche avec carte et lieux cités | Google Routes : par lieu, 1 appel à pied si ≤ 2 km, sinon 3 (vélo, transports, voiture) ; jusqu'à 3 lieux | 0 à 12 appels la 1re fois, 0 ensuite (cache) ; **0 $** sous 10 000 / mois (plafond app : 300 / jour ≈ 9 000 / mois) |
| Consulter, trier, favoris, comparer, se connecter | rien de payant | 0 $ |

## 4. Total par recherche

| Recherche | Le Bon Coin seul (prod) | 3 sources (develop) |
|---|---|---|
| Sans souhait | 0,0239 + 0,0016 + 0,0118 = **0,037 $** | 0,0239 + 0,038 + 0,045 + 0,0016 + 0,0118 = **0,120 $** |
| Sans souhait, PAP vide | — | **0,080 $** |
| Avec souhait (recherche élargie) | **0,061 $** | **0,144 $** |
| Avec souhait + un lot IA de remplacement | **0,073 $** | **0,156 $** |
| **10 recherches** | **0,37 à 0,73 $ (≈ 0,31 à 0,62 €)** | **0,80 à 1,56 $ (≈ 0,68 à 1,33 €)** |
| 100 recherches | 3,7 à 7,3 $ | 8 à 15,6 $ |

Répartition d'une recherche 3 sources sans souhait (0,120 $) : PAP 38 %, SeLoger 32 %, Le Bon Coin 20 %, OpenAI 11 %.
Dans le run Le Bon Coin seul (0,0239 $), le démarrage pèse 38 % (0,009 $), les annonces 62 % (0,0149 $). Le tarif
« ≈ 1 € pour 1 000 annonces » (1,49 $) ne compte que les annonces : avec les démarrages, 1 000 annonces lues par runs
de 10 coûtent 2,39 $.

## 5. Coûts fixes mensuels

| Poste | Coût |
|---|---|
| Render, service web Starter | 7 $ |
| Neon | 0 $ si offre gratuite (à vérifier dans la console Neon) |
| Apify, offre gratuite | 0 $ ; inclut 5 $ d'usage, **plafond strict** : au-delà, les runs sont refusés |
| Apify Starter (si nécessaire) | 29 $, crédit d'usage prépayé non reporté ; au-delà, paiement à l'usage |
| OpenAI, Google | pas d'abonnement |

## 6. Par mois, selon l'usage (Render compris, Apify payé à l'usage)

| Recherches | Le Bon Coin seul | 3 sources | Apify seul (3 sources) |
|---|---|---|---|
| 3 / jour (90) | 7 + 3,3 à 6,6 = **10 à 14 $** | 7 + 7 à 14 = **14 à 21 $** | 6 à 12 $ |
| 10 / jour (300) | **18 à 29 $** | **31 à 54 $** | 20 à 39 $ |
| 30 / jour (900) | **40 à 73 $** | **79 à 147 $** | 60 à 118 $ |

Apify gratuit (5 $ / mois) couvre ≈ 70 à 150 recherches Le Bon Coin seul, ou ≈ 35 à 60 à 3 sources.

## 7. Dépensé à ce jour

| Poste | Montant |
|---|---|
| Apify, cycle du 14/09 au 13/10 | **2,16 $ sur 5 $** (29/09 : 0,32 $ ; 30/09 : 0,43 $ ; 01/10 : 1,41 $, surtout enquêtes et tests réels) |
| OpenAI | non lisible d'ici (il faut une clé d'administration) : à voir dans la console OpenAI |
| Render | 7 $ / mois au prorata depuis le 30/09 |

Reste Apify jusqu'au 13/10 : 2,84 $ ≈ 40 à 75 recherches en prod, ≈ 20 à 35 à 3 sources. Ensuite les recherches
échouent jusqu'au 14/10.

## 8. Plafonds en place et pire cas

| Garde-fou | Valeur | Effet |
|---|---|---|
| `QUOTA_GLOBAL_PER_DAY` | 300 actions coûteuses / jour | au pire 300 × 0,156 $ ≈ **47 $ / jour** à 3 sources (22 $ Le Bon Coin seul) |
| `QUOTA_COOKIE_PER_HOUR` / `RATE_LIMIT_IP_PER_HOUR` | 30 / compte / heure, 40 / IP / heure | un compte seul : ≈ 4,7 $ / heure au pire |
| `APIFY_MAX_CHARGE_USD` | 0,10 $ par run | un run ne peut pas déraper |
| Apify gratuit | 5 $ / mois | coupe Apify, donc le gros des coûts |
| `GOOGLE_ROUTES_PER_DAY` | 300 / jour | reste dans les 10 000 gratuits |
| OpenAI | **aucun plafond** | au pire ≈ 300 × 0,04 $ ≈ 12 $ / jour, ≈ 360 $ / mois |

## 9. À faire pour ne pas être surpris
1. Budget mensuel dans la console OpenAI (par exemple 10 $).
2. `QUOTA_GLOBAL_PER_DAY=30`, `QUOTA_COOKIE_PER_HOUR=10` sur Render : pire cas ≈ 5 $ / jour.
3. Avant de déployer les 3 sources : `LISTING_SOURCES=leboncoin` tant qu'Apify est gratuit, ou passer en Starter.
4. Vérifier l'offre Neon dans sa console.
5. Économies possibles : voir `reduction-des-couts.md` (≈ 0,05 à 0,07 $ par recherche à 3 sources).
