# Étude : Jev (TypeSafe) pour lire les annonces à moindre coût (03/10/2026)

**Statut : implémenté sur la branche `jev` (03/10), désactivé par défaut** (`ANALYSIS_ENGINE=llm`). Jev n'a jamais été
appelé pour de vrai : il faut l'accès (liste d'attente) puis le banc d'essai. Sources publiques uniquement : chiffres du
fournisseur, non vérifiés par nous.

## Ce qu'est Jev
- Modèle de **décision typée** de TypeSafe (San Francisco), ouvert en accès anticipé le 15/09/2026. Il **n'écrit pas de
  texte** : on lui donne un texte (« state », jusqu'à 32 000 tokens) et des questions typées, il répond à chacune, en
  parallèle, avec une probabilité.
- Trois types de question : **oui/non** (probabilité 0–1), **choix** dans une liste (jusqu'à 255 options, probabilité par
  option), **note** sur une échelle. Réponse toujours conforme au schéma demandé.
- Prix annoncé : **0,042 $ par million de tokens d'entrée, sortie gratuite** (≈ 0,058 $ via AI/ML API). Latence
  annoncée : **70 à 500 ms**. Disponible sur liste d'attente (console TypeSafe), sur Cloudflare Workers AI
  (`typesafe/jev`) et via AI/ML API (`POST /v1/decisions`).
- Limites : **pas de texte** (ni résumé, ni citation, ni extraction d'adresse) ; le français n'est pas documenté ;
  « confiance calibrée » ne veut pas dire « jamais faux » ; prix de lancement, sans grille publiée ; société jeune.

## Ce que fait le LLM aujourd'hui (gpt-5-mini, réflexion faible)
Par lot de 5 annonces, ≈ 0,0063 $ (mesuré, `reduction-des-couts.md`), soit **≈ 0,0013 $ par annonce**, surtout en tokens
de réflexion. Il produit : type d'offre (logement entier / chambre / non habitable), vérification des critères de
l'utilisateur, jusqu'à 6 caractéristiques libres, résumé « Pourquoi ce logement ? », adresse lue dans la description.
Chaque réponse doit **citer** le texte (sinon elle est rejetée).

| Tâche | Jev possible ? |
|---|---|
| Type d'offre (entier / chambre / non habitable / incertain) | **Oui** : question à choix |
| Critères de l'utilisateur (« balcon », « chat accepté », « calme »…) | **Oui** : une question par critère, choix oui / non / non précisé |
| Caractéristiques | **Oui, mieux** : un catalogue fixe (ci-dessous) au lieu de 6 libellés libres |
| Valeurs numériques manquantes (prix, surface, pièces) | Partiel (choix par tranches) ; rare, garder le LLM |
| Résumé « Pourquoi ce logement ? » | **Non** (pas de texte) |
| Adresse lue dans la description | **Non** (pas d'extraction) |
| Citation qui prouve | **Non** : à remplacer par un seuil de probabilité + une vérification de mots-clés |

## Catalogue de caractéristiques visables par Jev
Question type : choix **oui / non / non précisé** (une information absente n'est jamais un « non », comme aujourd'hui),
sauf mention. « LBC » : déjà fourni par Le Bon Coin en champ structuré, donc **gratuit** et prioritaire sur Jev.

| Famille | Caractéristique | Question Jev | Déjà dans LBC ? |
|---|---|---|---|
| Type d'offre | Logement entier / chambre en colocation / non habitable / incertain | choix | non |
| | Demande de logement (« Recherche T2… ») | oui/non | non (déjà repéré par regex) |
| Extérieur | Balcon | oui/non/non précisé | parfois |
| | Terrasse | idem | parfois |
| | Jardin : privatif / commun / aucun / non précisé | choix | parfois |
| | Loggia, cour | idem | non |
| | Vue dégagée | idem | non |
| Stationnement | Parking ou garage | idem | parfois (`nb_parkings`, `specificities`) |
| | Parking : compris / en supplément / non précisé | choix | non |
| | Local vélo | idem | non |
| Annexes | Cave | idem | parfois (`specificities`) |
| | Grenier, cellier, buanderie | idem | non |
| Immeuble | Ascenseur | idem | souvent (`elevator`) |
| | Étage : RDC, 1…30, non précisé | choix | souvent (`floor_number`) |
| | Dernier étage / rez-de-chaussée | idem | parfois (`floor_property`) |
| | Interphone / digicode, gardien, résidence sécurisée | idem | parfois (`specificities`) |
| | Accès personne à mobilité réduite | idem | non |
| Intérieur | Meublé | idem | oui (`furnished`) |
| | Cuisine : équipée / aménagée / nue / non précisé | choix | parfois (`specificities`) |
| | Cuisine ouverte / séparée | choix | parfois (`specificities`) |
| | Baignoire / douche ; WC séparés | idem | parfois (`nb_shower_room`) |
| | Rangements (placards, dressing) | idem | non |
| | Double vitrage | idem | non |
| | Parquet, cheminée, climatisation | idem | non |
| | Lave-linge, lave-vaisselle fournis | idem | non |
| | Duplex, mezzanine, traversant | idem | non |
| | Refait à neuf / rénové | idem | parfois (`global_condition`) |
| Énergie, charges | Chauffage individuel / collectif ; gaz / électrique / autre | choix | souvent (`heating_type`, `heating_mode`) |
| | DPE A à G | choix | souvent (`energy_rate`) |
| | Charges comprises ; eau chaude, internet ou fibre compris | idem | parfois (`charges_included`) |
| Conditions | Animaux : acceptés / refusés / non précisé | choix | parfois (`specificities`) |
| | Fumeurs | idem | non |
| | Colocation acceptée (logement entier) | idem | non |
| | Étudiants acceptés ; garant exigé ; garantie Visale acceptée | idem | non |
| | APL possible | idem | non |
| | Bail : classique / meublé / mobilité / étudiant | choix | parfois (`lease_type`) |
| | Sans frais d'agence | idem | parfois (`mandate_type`, `rental_fees`) |
| Environnement | Proche transports (métro, tram, gare) à pied | idem | non |
| | Commerces, écoles à proximité | idem | non |
| Ressenti (moins fiable) | Lumineux, calme | note 1–5 ou oui/non | non |

Pour tous les autres souhaits de l'utilisateur, la question est construite à la volée : « L'annonce dit-elle que :
*chat accepté* ? » → oui / non / non précisé.

## À faire d'abord, gratuitement : les champs Le Bon Coin pas encore exploités
Le Bon Coin renvoie `specificities` (cases cochées par l'annonceur : « Avec garage ou place de parking, Cuisine
équipée, Cave, Interphone, Gardien, Animaux autorisés, Cuisine ouverte… »), `floor_property` (dernier étage, pas de
RDC), `heating_type` / `heating_mode`, `charges_included`, `available_date`, `global_condition`. **Aucun n'est lu
aujourd'hui** (constaté dans les échantillons de test et dans `apify.ts`). Les lire = caractéristiques et critères
tranchés sans IA du tout. Une case non cochée n'est pas un « non » : seulement un « oui » sûr.

## Architecture proposée (si le banc d'essai est bon)
1. **Le Bon Coin d'abord** (gratuit, sûr).
2. **Jev pour toutes les annonces lues** : type d'offre, critères de l'utilisateur, catalogue ci-dessus. Seuils :
   « Confirmé » ou « Ne correspond pas » seulement si la probabilité dépasse ≈ 0,85 (à régler sur le banc d'essai), sinon
   « À vérifier ». Garde-fou contre l'invention : un « oui » n'est retenu que si un mot-clé du sujet figure dans le texte
   (« balcon », « loggia »…) ; la phrase qui le contient sert d'extrait affiché (la « preuve », sans LLM). Pour écarter
   une annonce (chambre, non habitable), probabilité ≥ 0,9 **et** accord avec les règles existantes (`offer.ts`).
3. **Le LLM seulement là où il est irremplaçable**, et plus tard : le résumé « Pourquoi ce logement ? » quand on ouvre
   la fiche, l'adresse quand la position est imprécise.

## Gain attendu (estimations, à mesurer)
| | Aujourd'hui | Avec Jev |
|---|---|---|
| Lecture d'une annonce (offre, critères, caractéristiques) | ≈ 0,0013 $ (LLM) | ≈ 0,00005 $ si le texte n'est facturé qu'une fois ; ≈ 0,0005 $ s'il l'est par question (≈ 35 questions) |
| Résumé et adresse | inclus ci-dessus | LLM seulement sur les fiches ouvertes (≈ 20 % ?) |
| Coût par annonce, tout compris | ≈ 0,0013 $ | ≈ 0,0003 à 0,0007 $ |
| Attente à l'affichage (20 annonces) | plusieurs secondes (« L'IA lit les descriptions… ») | < 1 s annoncée |

Le gain le plus net est peut-être la **vitesse** : l'analyse au défilement deviendrait presque instantanée. Le coût
OpenAI est déjà faible face à Apify (≈ 20 % de la dépense) : Jev réduit surtout cette part-là.

## Risques
- **Plus de citation exacte** : c'est le principe de l'app (« l'IA cite le passage qui le prouve »). Le garde-fou
  mots-clés + phrase extraite le remplace en partie, pas entièrement (formulations sans le mot attendu).
- **Français non documenté**, chiffres du fournisseur non vérifiés, prix de lancement, accès sur liste d'attente,
  société récente : garder le LLM actuel derrière un réglage (`ANALYSIS_ENGINE=llm|jev`) et basculer seulement après
  le banc d'essai.
- Facturation par question inconnue (texte compté une fois ou à chaque question) : elle décide du gain réel.

## Plan
| Étape | Contenu | Effort | Coût |
|---|---|---|---|
| 0 | Lire les champs Le Bon Coin inutilisés (`specificities`…) : caractéristiques et critères sans IA | ½ jour | 0 |
| 1 | Accès (liste d'attente TypeSafe, ou Cloudflare Workers AI / AI/ML API) | — | — |
| 2 | Banc d'essai : les 69 annonces réelles déjà utilisées, vérité annotée à la main sur ≈ 15 caractéristiques + type d'offre + 3 critères ; Jev contre gpt-5-mini : justesse, faux « oui », tokens réellement facturés, latence | 1 jour | < 1 $ |
| 3 | Si concluant : moteur Jev derrière `ANALYSIS_ENGINE`, catalogue de caractéristiques, seuils, garde-fou mots-clés ; résumé et adresse au LLM à l'ouverture de la fiche ; tests (faux Jev, comme les faux Apify/OpenAI) | 2 jours | — |

## Implémenté (branche `jev`)
Trois étages, du plus sûr au plus cher, autour d'un **catalogue de 33 caractéristiques** (`routes/housing/catalogue.ts`) :
1. **Le Bon Coin** (gratuit, certain, actif même sans Jev) : en plus des champs déjà lus, les cases « Spécificités »
   (parking ou garage, cuisine équipée, cave, interphone, gardien, animaux autorisés…), l'étage (`floor_property`,
   `floor_number`), l'état (`global_condition`), les charges comprises, le chauffage (« Individuel · gaz ») et la date
   de disponibilité. Ils tranchent les critères correspondants (« cave », « chat accepté », « sans ascenseur »,
   « pas de rez-de-chaussée »…) et s'affichent comme caractéristiques. Une case non cochée reste « à vérifier ».
   **Seul un « oui » des champs fait foi.** Un « non » (« Ascenseur : Non », « 0 place ») est souvent une valeur par
   défaut que le propriétaire n'a pas remplie : la description est lue quand même (Jev ou LLM), et un « oui » explicite
   y l'emporte (critère et caractéristique) ; si elle ne dit rien, le « non » des champs reste affiché. Vaut pour les
   deux moteurs (`isWeakStructured`, `saysNo`, `mergeFeatures`).
2. **Jev** (`ANALYSIS_ENGINE=jev` + `JEV_API_KEY`) : type d'offre, caractéristiques du catalogue que Le Bon Coin ne dit
   pas, et critères de l'utilisateur qui en relèvent. Une question n'est posée que si le sujet apparaît dans le texte
   (≈ 6 questions par annonce au lieu de 34) ; réponse retenue au-dessus de 0,85 (`JEV_MIN_CONFIDENCE`), avec la phrase
   de l'annonce comme preuve ; écarter une annonce exige 0,90 et une phrase qui le montre. Client tolérant au format
   (`lib/jev.ts`) : adresse, modèle et clé réglables, réponses lues sous plusieurs formes.
3. **LLM** : critères complexes (plus de 6 mots, ou hors catalogue : « calme », « proche de mon travail »…), critères
   que Jev n'a pas tranchés, résumé, adresse ; caractéristiques et type d'offre seulement si Jev ne les a pas donnés.
   **Jev en panne : le LLM fait tout, comme avant.**

Tests (`jev.test.ts`, faux Jev et faux LLM, aucun appel payant) : lecture des « Spécificités », critères tranchés par
Le Bon Coin, catalogue, client HTTP (requête, formats de réponse), questions limitées aux sujets présents, seuils,
preuve, « sans … » inversé, offre écartée seulement avec preuve, enchaînement des trois étages, repli si Jev tombe,
cache. Vérifiés en cassant volontairement seuil, mot-clé, preuve de l'offre et répartition Jev/LLM.

**Banc d'essai** (`pnpm --filter @workspace/api-server bench:jev`, appels payants, à la demande) :
`-- --annoter bench/a-annoter.json` écrit les 39 annonces des échantillons avec une vérité à remplir ;
`-- --verite bench/a-annoter.json` lance Jev et le LLM et écrit `reports/jev-bench-<date>.md` (justesse, faux « oui »,
accord avec le LLM, tokens facturés, coût, temps) ; `-- --essai` vérifie le script avec un faux Jev local.

## Sources
- [TypeSafe : Jev Latest API (AI/ML API)](https://aimlapi.com/models/typesafe-jev-latest)
- [TypeSafe Jev review (eesel)](https://www.eesel.ai/blog/typesafe-jev-review)
- [TypeSafe Jev : the first System One model, explained (eesel)](https://www.eesel.ai/blog/typesafe-jev)
- [TypeSafe’s Jev : can decision models replace LLM judges? (Arize)](https://arize.com/blog/typesafe-jev-llm-judge/)
- [TypeSafe AI funding puts a 445x cost claim under scrutiny (remio)](https://www.remio.ai/post/typesafe-ai-jev-funding-puts-a-445-cost-claim-under-scrutiny)
- [Jev on LLM Reference](https://www.llmreference.com/model/jev/typesafe-ai)
