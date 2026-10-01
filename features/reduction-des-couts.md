# Étude : réduire les coûts, même service rendu (01/10/2026)

Point de départ (`bilan-financier.md`) : **0,12 à 0,17 $ par recherche** à 3 sources, dont ≈ 80 % d'Apify et
≈ 20 % d'OpenAI. Tout ce qui suit est **mesuré** (runs Apify réels, tokens OpenAI comptés) ; coût des essais :
≈ 0,06 $ d'Apify et ≈ 0,5 $ d'OpenAI.

## 1. OpenAI : régler l'effort de raisonnement (−50 % sur l'IA, et un bug en moins)

L'app appelle `gpt-5-mini` sans `reasoning_effort` : le modèle « réfléchit » au niveau moyen, et ces tokens de
réflexion sont facturés en sortie (≈ 6 000 par lot de 5 annonces). Banc d'essai : 69 vraies annonces des 3 sources
(dont 10 chambres en colocation), le vrai prompt d'analyse, critères « balcon, meublé, chat accepté ».

| Modèle (tarif $/M tokens entrée/sortie) | Coût par lot de 5 | Chambres repérées | Logements écartés à tort | Critères comme aujourd'hui | Lots en échec |
|---|---|---|---|---|---|
| gpt-5-mini, effort moyen (actuel ; 0,25/2) | 0,0123 $ | 7/10 | 0 | référence | **1 sur 14** (réponse tronquée) |
| **gpt-5-mini, effort faible** | **0,0063 $** | **7/10** | **0** | **186/192 (97 %)** | 0 |
| gpt-5-mini, effort minimal | 0,0051 $ | 5/10 | 0 | 166/177 | 1 |
| gpt-4.1-mini (0,40/1,60) | 0,0028 $ | 6/10 | 0 | 179/192 | 0 |
| gpt-4o-mini (0,15/0,60) | 0,0012 $ | 8/10 | **4** | 174/192 | 0 |
| gpt-5-nano, effort faible (0,05/0,40) | 0,0014 $ | 2/10 | 0 | 153/177 | 1 |
| gpt-5-nano, effort minimal | 0,0007 $ | 5/10 | 1 | 155/192 | 0 |

- Les 3 chambres manquées par tous sont des « Colocation à louer » SeLoger, déjà écartées par leur titre avant l'IA :
  sur les cas qu'elle doit vraiment trancher, gpt-5-mini en effort faible fait aussi bien qu'aujourd'hui.
- **Bug trouvé** : en effort moyen, la réflexion dépasse parfois la limite de 8 192 tokens ; la réponse est tronquée,
  l'analyse échoue et le worker la retente (donc la repaie). L'effort faible n'a pas débordé.
- Les modèles moins chers ratent des chambres (nano) ou écartent de vrais logements (gpt-4o-mini) : à éviter.
- Interprétation de la demande, effort faible : 22/22 champs justes (comme aujourd'hui), 0,0009 $ au lieu de 0,0016 $.

**Recommandé : `reasoning_effort: "low"` sur gpt-5-mini** (une ligne de code). IA : ≈ 0,014–0,04 $ → ≈ 0,007–0,02 $.

## 2. Le Bon Coin : un acteur Apify 2,4 × moins cher, mêmes données

| Acteur | Tarif | 10 annonces (mesuré) | Fiabilité (30 j) |
|---|---|---|---|
| `clearpath/leboncoin-api` (actuel) | 0,009 $ de départ + 0,0015 $/annonce | 0,024 $ | 5 451 / 5 493 |
| **`fatihtahta/leboncoin-fr-scraper`** | 0,001 $/annonce, pas de départ | **0,010 $** | 14 557 / 14 574, 85 utilisateurs |
| `scrapifier/leboncoin-universal-scraper` | 0,00089 $/annonce | 0 annonce rendue sur notre URL | écarté |

Même URL de recherche (type de bien, pièces, budget, ville avec coordonnées). Comparaison annonce par annonce
(6 annonces communes) : **prix, surface, pièces, ville, coordonnées, précision de la position, description,
photos et attributs identiques** ; location confirmée (`deal_type: rent`, `lease_type: rent`). Format différent :
un adaptateur d'une trentaine de lignes, plus deux retouches cosmétiques (photos demandées en grande taille,
classes énergie en majuscules). Garder `clearpath` en secours, choisi par variable d'environnement.

## 3. SeLoger et PAP : les acteurs actuels restent les bons

| Site | Acteur testé | 10 annonces | Verdict |
|---|---|---|---|
| SeLoger | `silentflow` (actuel) | 0,038 $ | description complète, coordonnées : **garder** |
| SeLoger | `shahidirfan/seloger-com-scraper` | 0,011 $ | ignore les filtres (maison à 2 100 € pour 700 € max), description coupée à 500 car., pas de coordonnées : écarté |
| SeLoger | `azzouzana/…by-search-url` | 0,020 $ | description coupée, pas de coordonnées, 5 annonces max en compte Apify gratuit : écarté |
| PAP | `clearpath/pap-scraper` (actuel) | 0,045 $ | coordonnées, description complète : **garder** |
| PAP | `scrapifier/pap-universal-scraper` | 0,004 $ (4 annonces) | pas de coordonnées (plus de carte), 96 s, moins d'annonces : écarté |

Autres acteurs du store vus mais non retenus : départ à 0,03–0,09 $ (`memo23`, `abotapi`), ou 0,002–0,012 $
l'annonce sans gain de données (`lexis-solutions`, `parseforge`, `crawlerbros`, `leadsbrary`).

## 4. Payer ce qu'on montre : nombre d'annonces lues par source

On montre 5 annonces, en alternance Le Bon Coin, SeLoger, PAP, Le Bon Coin, SeLoger : **PAP en place 1, SeLoger 2**,
mais on en lit 10 de chaque (le surplus sert à remplacer les annonces écartées). Proposition : Le Bon Coin 10,
SeLoger 6, PAP 4 (variables par source). SeLoger : 0,038 → 0,024 $ ; PAP : 0,045 → 0,021 $. Risque : sur les petits
budgets à Lille, SeLoger est envahi de colocations (27/30) ; avec 6 annonces lues, il peut n'en rester aucune.

## 5. Recherche élargie Le Bon Coin seulement si elle sert

Quand la demande contient un souhait (balcon, parking…), Le Bon Coin est interrogé deux fois : avec le mot-clé, puis
sans, dès que la première recherche donne moins de 40 annonces, c'est-à-dire presque toujours, alors qu'on n'en
montre que 5. Proposition : élargir seulement s'il manque des annonces pour remplir les 5. Économie : un run
Le Bon Coin sur les recherches avec souhait (0,024 $ aujourd'hui, 0,010 $ avec l'acteur du point 2).

## Résultat

| Scénario | Apify | OpenAI | Total par recherche | 10 recherches |
|---|---|---|---|---|
| Aujourd'hui (`develop`, 3 sources) | 0,107 à 0,131 $ | 0,014 à 0,04 $ | **0,12 à 0,17 $** | 1,2 à 1,7 $ |
| Points 1 + 2 (aucun changement visible) | 0,093 à 0,103 $ | 0,007 à 0,02 $ | 0,10 à 0,12 $ | 1,0 à 1,2 $ |
| **Points 1 à 5** | **0,035 à 0,055 $** | **0,007 à 0,02 $** | **≈ 0,05 à 0,07 $** | **≈ 0,5 à 0,7 $ (≈ 0,45 à 0,6 €)** |
| Le Bon Coin seul + points 1, 2, 5 | 0,010 $ | 0,007 à 0,02 $ | ≈ 0,02 à 0,03 $ | ≈ 0,2 à 0,3 $ |

Avec les points 1 à 5, les 5 $ mensuels d'Apify gratuit couvrent ≈ 100 à 140 recherches à 3 sources
(≈ 40 aujourd'hui).

## Pistes écartées
- **Pas d'Apify, scraping maison** : Le Bon Coin et SeLoger bloquent les robots (403 dès la page d'accueil depuis
  ce serveur) ; il faudrait des proxys résidentiels payants et une maintenance permanente. Pas d'API publique
  officielle (Le Bon Coin, SeLoger, PAP réservent leurs flux aux professionnels).
- **API Batch d'OpenAI** (−50 %) : réponse en minutes ou heures, incompatible avec une recherche en direct.
- **Mutualiser les runs entre utilisateurs** (même ville, mêmes filtres) : peu d'utilisateurs, donc peu de cas
  identiques ; à reconsidérer si le trafic grandit.
- **Hébergement** (Render 7 $/mois) : un VPS à ≈ 4 € existe, mais l'économie est faible face à la maintenance.

## Plan proposé
1. `reasoning_effort: "low"` (interprétation et analyse) + test : 15 min.
2. Acteur Le Bon Coin `fatihtahta` derrière une variable (`LEBONCOIN_ACTOR`), adaptateur testé sur ses vraies
   données, `clearpath` gardé en secours : 1 à 2 h.
3. Nombre d'annonces lues par source réglable (Le Bon Coin 10, SeLoger 6, PAP 4) : 30 min.
4. Recherche élargie seulement s'il manque des annonces : 30 min.
Puis une vraie recherche de contrôle par ville test (Lille, Rennes, Nantes), comme pour les sources.

Sources des tarifs : [OpenAI gpt-5-mini](https://developers.openai.com/api/docs/models/gpt-5-mini),
[OpenAI gpt-4.1-nano](https://developers.openai.com/api/docs/models/gpt-4.1-nano),
[comparatif des tarifs OpenAI](https://modelcompare.dev/pricing/openai-api-pricing) ; tarifs Apify lus sur l'API
Apify (`/v2/acts/{acteur}`) et coûts facturés lus sur chaque run.
