# Étude : alternatives à Apify pour récupérer les annonces (01/10/2026)

Question : existe-t-il, hors Apify, de quoi lire les annonces Le Bon Coin, SeLoger et PAP (location, filtres, description,
photos, coordonnées) pour moins cher, au même niveau de service ?
Étude sur documentation et tarifs publics (vérifiés le 01/10/2026) ; **aucun essai réel** : chaque service demande
un compte. 1 $ ≈ 0,85 €.

Référence Apify (mesurée, cf. `bilan-financier.md` et `reduction-des-couts.md`), pour une recherche à 3 sources :
**0,107 $ aujourd'hui**, **0,035 à 0,055 $ après optimisation** ; Le Bon Coin seul : 0,024 $ (0,010 $ avec l'acteur
`fatihtahta`).

## Trois familles

### A. Fournisseur de données immobilières (sans scraping de notre côté) : Stream Estate (ex-Melo)

Melo redirige désormais vers Stream Estate (même offre). Vérifié dans leur spécification d'API (`openapi.json`) :

- **Location** : `transactionType=1` (Rent) ; **types** : `propertyTypes` appartement (0), maison (1), parking (3)… ;
  **pièces** `roomMin`/`roomMax`, **surface** `surfaceMin`/`surfaceMax`, **loyer** `budgetMin`/`budgetMax`,
  **lieu** `includedInseeCodes`, `includedZipcodes`, ou `lat`/`lon`/`radius` ; `furnished`, `publisherTypes`
  (particulier/pro), `includedSites`/`excludedSites` (choix des portails), `expressions` (mots inclus/exclus).
- **Par bien** : pièces, chambres, surface, loyer, meublé, ascenseur, étage, coordonnées (`locations`, précision
  `geoAccuracy` : numéro de rue ou quartier), stations proches, photos dédupliquées.
- **Par annonce source** (`adverts`) : adresse de l'annonce, site (`publisher`), titre, **description**, photos,
  charges, dépôt de garantie, honoraires, date de mise à jour.
- **Dédoublonnage entre portails** fait par eux ; 1 500+ sources (Le Bon Coin, SeLoger, Bien'ici, PAP, Logic-Immo,
  sites d'agences…) ; webhooks temps réel (utile pour l'alerte mail).

| Offre | Prix | Inclus | Au-delà |
|---|---|---|---|
| Paiement à l'usage | 0 € / mois | — | **0,01 € par item** |
| Starter | 99 € / mois | 15 000 items | 0,003 € / item |
| Growth | 399 € / mois | 150 000 items | 0,002 € / item |
| Essai | — | 5 € de crédit offerts | — |

« Item » n'est pas défini dans la documentation : hypothèse, **un bien renvoyé par une recherche** (à confirmer
avec les 5 € d'essai). Une recherche lirait ≈ 8 biens (5 montrés + remplaçants ; déjà dédoublonnés, en location,
sans parking) :

| Usage | À l'usage | Starter (99 €) |
|---|---|---|
| Par recherche | **≈ 0,08 € (0,094 $)** | 99 € fixes, couvrent ≈ 1 875 recherches |
| 100 recherches / mois | 8 € | 99 € |
| 1 000 / mois | 80 € | 99 € |
| 3 000 / mois | 240 € | 99 + 1 125 × 8 × 0,003 = 126 € |

Comparé à Apify optimisé (≈ 0,045 $ d'Apify par recherche à 3 sources) : **plus cher au paiement à l'usage**
(≈ 2 ×), rentable seulement au-delà de ≈ 2 500 recherches par mois avec l'offre Starter. Mais il apporte ce
qu'Apify n'a pas : plus de portails, dédoublonnage fait, pas d'acteurs tiers qui changent ou cassent, alertes par
webhook, pas de code de ville SeLoger ni de verrous anti-colocation à maintenir.

### B. API de scraping génériques (proxys et contournement anti-robots, notre propre code de lecture)

Le Bon Coin et SeLoger sont protégés par DataDome (empreinte TLS et navigateur, réputation des IP). Selon le guide
Scrapfly sur Le Bon Coin (2026), les pages de résultats ne contiennent qu'une partie des données : **la description
complète exige d'ouvrir chaque annonce**. Une recherche à 3 sources ≈ 3 pages de résultats + 30 annonces
= **33 requêtes** (≈ 18 en n'ouvrant que 5 annonces par source).

| Service | Offre de base | Coût d'une requête anti-robots | Recherche à 3 sources (18 à 33 requêtes) |
|---|---|---|---|
| Scrape.do | 29 $ / mois, 250 000 crédits ; résidentiel 10 crédits, + navigateur 25 | 0,0012 à 0,0029 $ | **0,021 à 0,096 $** + 29 $ / mois |
| Bright Data Web Unlocker | à l'usage, 1,50 à 3 $ / 1 000 réussies | 0,0015 à 0,003 $ | **0,027 à 0,099 $** |
| Zyte API | à l'usage ; HTTP 0,20 à 1,90 $ / 1 000, navigateur 1,50 à 24 $ / 1 000 selon la difficulté du site | 0,0019 à 0,024 $ | 0,034 à 0,79 $ |
| Scrapfly | 30 $ / mois, 200 000 crédits ; contournement ≈ 30 crédits | ≈ 0,0045 $ | 0,081 à 0,149 $ + 30 $ / mois |
| ScrapingBee | 49 $ / mois, 250 000 crédits ; premium + JS 25, « stealth » 75 | 0,0049 à 0,0147 $ | 0,088 à 0,49 $ + 49 $ / mois |

Lecture : au mieux (Scrape.do ou Bright Data, requêtes simples qui passent), **≈ 0,02 à 0,05 $ par recherche**,
comparable à Apify optimisé. Au pire (navigateur nécessaire contre DataDome), 2 à 10 × plus cher. S'ajoutent :
- **trois lecteurs à écrire et maintenir** (Le Bon Coin, SeLoger, PAP), qui cassent à chaque changement de site
  (c'est le travail que font les acteurs Apify) ;
- un **taux de réussite non garanti** face à DataDome (les « 98 % » annoncés sont ceux des vendeurs) ;
- un **abonnement fixe** (29 à 49 $ / mois) chez la plupart.

### C. Scraping maison avec proxys résidentiels
Proxys résidentiels ≈ 3 à 8 $ / Go ; une recherche à 3 sources ≈ 33 pages, quelques Mo : ≈ 0,02 à 0,05 $. Mais
contourner DataDome soi-même (empreintes TLS, navigateur furtif, captchas) est un travail permanent : depuis ce
serveur, Le Bon Coin et SeLoger renvoient déjà 403 dès la page d'accueil. **Écarté.**

## Point juridique (toutes les options de scraping, Apify compris)
Les CGU de Le Bon Coin, SeLoger et PAP interdisent l'extraction automatisée. Un fournisseur comme Stream Estate porte
ce risque à notre place (à vérifier dans son contrat) ; avec Apify ou une API de scraping, il reste le nôtre.

## Synthèse

| Option | Coût par recherche (3 sources) | Fixe / mois | Travail | Fiabilité |
|---|---|---|---|---|
| Apify aujourd'hui | 0,107 $ | 0 $ (gratuit, plafonné à 5 $) ou 29 $ | fait | bonne, dépend d'acteurs tiers |
| **Apify optimisé** (`reduction-des-couts.md`) | **0,035 à 0,055 $** | idem | 3 à 4 h | idem |
| Stream Estate, à l'usage | ≈ 0,094 $ | 0 | ≈ 1 jour (une seule source à brancher, plus simple que 3) | bonne, données dédoublonnées |
| Stream Estate, Starter | 99 € fixes, ≈ 0,053 € par recherche à 1 875 recherches | 99 € | idem | idem |
| Scrape.do / Bright Data | 0,02 à 0,10 $ | 0 à 29 $ | plusieurs jours + maintenance | incertaine (DataDome) |
| Zyte, Scrapfly, ScrapingBee | 0,03 à 0,79 $ | 0 à 49 $ | idem | incertaine |
| Maison + proxys | 0,02 à 0,05 $ | variable | très lourd | faible |

**Recommandation** : rester sur Apify et appliquer l'optimisation (le moins cher à notre volume, déjà en place).
Garder **Stream Estate** comme plan B ou étape suivante si le trafic grandit (au-delà de ≈ 2 500 recherches par mois),
si les acteurs Apify deviennent instables, ou pour l'alerte mail (webhooks) : un essai avec les 5 € offerts
dirait ce qu'est un « item » et la qualité réelle des données en location. Les API de scraping génériques ne
font pas gagner d'argent à notre volume et ajoutent beaucoup de maintenance.

Sources : [Stream Estate, tarifs](https://stream.estate/pricing), [Stream Estate, API](https://docs.stream.estate),
[Melo](https://www.melo.io/fr/tarifs), [Scrapfly, guide Le Bon Coin](https://scrapfly.io/blog/how-to-scrape-leboncoin-marketplace-real-estate/),
[Scrapfly, tarifs](https://scrapfly.io/pricing), [Scrape.do, tarifs](https://scrape.do/pricing),
[Scrape.do, coût des requêtes](https://scrape.do/documentation/request-costs/),
[ScrapingBee, tarifs](https://www.scrapingbee.com/pricing/),
[Bright Data, tarifs 2026](https://use-apify.com/blog/bright-data-pricing-guide-2026),
[Zyte, tarifs](https://toolradar.com/tools/zyte/pricing),
[comparatif ScrapingBee](https://prospeo.io/s/scrapingbee-alternatives).
