# Étude : suivre une recherche plusieurs jours (01/10/2026)

Besoin : l'utilisateur lance une recherche une fois, puis l'app la **refait toute seule** à des heures choisies
(8 h, éventuellement 2 créneaux par jour) et ne lui montre que les **nouvelles annonces** depuis le passage précédent.

## Réponse courte
- **Oui, c'est faisable, et ça coûte peu**, parce qu'on ne paie que les annonces lues : lire seulement les plus
  récentes coûte 10 à 20 fois moins qu'une recherche complète.
- **Mais pas « par date » côté Le Bon Coin** : l'acteur Apify ne prend qu'une adresse de recherche et un nombre
  maximum (`startUrls` + `limit`, vérifié dans sa description d'entrée) et l'adresse Le Bon Coin n'a pas de filtre
  « publié depuis ». On obtient le même effet autrement : les résultats arrivent **triés du plus récemment mis à jour
  au plus ancien** (mesuré), donc on lit le haut de la liste et on s'arrête à ce qu'on connaît déjà.
- **Le coût dépend du nombre d'annonces lues, pas du nombre de passages** : 2 passages par jour coûtent presque
  autant qu'un seul.

## Mesures réelles (Le Bon Coin, acteur `fatihtahta`, Lille, ≤ 700 €, 1 à 2 pièces, 5 km ; coût de l'étude ≈ 0,08 $)
| Constat | Mesure |
|---|---|
| Ordre des résultats par défaut | du plus récent au plus ancien sur `updated_at` : vrai sur 60 annonces. Ajouter `sort=time&order=desc` ne change rien (identique) |
| Annonces vues en 24 h | 60 lues et toutes < 24 h : le volume réel dépasse 60 par jour pour cette recherche, qui est très active |
| Dont vraiment nouvelles (publiées < 24 h) | 38 sur 60 (63 %) |
| Dont « remontées » (anciennes, republiées en tête) | 22 sur 60 (37 %) : une annonce de septembre est réapparue en haut aujourd'hui |
| Cadence en soirée | 34 mises à jour en 6 h, soit ≈ 6 par heure |
| Champs utiles | `posted_at` (publication), `updated_at` (dernière remontée), `id`, URL stable |

À retenir : **« nouveau » = adresse jamais vue pour cette recherche**, pas `posted_at` (une remontée change `updated_at` mais
pas l'annonce). `updated_at` sert seulement à savoir où s'arrêter dans la liste.

## Principe d'un passage de suivi
1. À l'heure choisie, le worker lance la recherche avec `limit` = nombre d'annonces attendues depuis le dernier passage
   (débit mesuré × heures écoulées × 1,3, entre 15 et 100).
2. Les résultats arrivent du plus récent au plus ancien. On écarte ceux déjà connus pour cette recherche (même adresse) ;
   le reste est **nouveau**.
3. Les verrous existants s'appliquent (location seulement, pas de demande, pas de colocation, parking, vente).
4. Seules les nouvelles passent à l'analyse IA (les remontées sont déjà en cache : 0 $).
5. Si la dernière annonce lue est encore plus récente que le dernier passage, la limite était trop courte : on relance
   une fois avec le double (rare) et on retient un débit plus fort pour la fois suivante.
6. On enregistre `dernier passage`, les nouvelles annonces (date de première vue) et le prochain passage.

## Où ça tourne (technique)
- Le **worker existe déjà** dans le service Render (plan payant, jamais en veille) : il vérifie les recherches à traiter
  toutes les quelques secondes. On y ajoute « veilles quotidiennes dont l'heure est passée ».
- Données : sur la recherche, `suivi actif`, `créneaux` (ex. 08:00 et 18:00, heure de Paris), `suivi jusqu'au`,
  `dernier passage`, `prochain passage` ; sur chaque annonce, `vue pour la première fois le`. Une migration, vérifiée sur
  un vrai Postgres.
- Heure de Paris, été comme hiver : le prochain passage est calculé en UTC à partir de l'heure locale.
- **Rattrapage** : si Render redémarre ou déploie à 8 h, le passage manqué est fait au redémarrage ; comme on part du
  « dernier passage », rien n'est perdu (la limite est recalculée sur la durée écoulée).
- Pas besoin de tâche planifiée Render (≈ 1 $/mois) ni de service externe : le worker suffit.
- Plusieurs instances : le verrou existant (`owner`) évite qu'un passage soit fait deux fois.

## Ce que voit l'utilisateur
- Un interrupteur « **Suivre cette recherche** » sur la page résultats, avec 1 ou 2 heures à choisir.
- Un badge « **3 nouvelles** » sur la recherche (liste « Mes recherches » et en-tête), et une section en haut des
  résultats pour les nouvelles annonces depuis la dernière visite.
- **Prévenir sans ouvrir l'app** (à choisir, du plus simple au plus riche) :
  1. **E-mail récapitulatif** à l'heure choisie (« 3 nouvelles annonces à Lille ») : universel, nécessite un service
     d'envoi (Resend ou Brevo, gratuit jusqu'à ≈ 3 000 e-mails par mois) et le domaine d'envoi ; l'app a déjà l'adresse
     de chaque compte.
  2. **Notification push** (application installable) : Android et ordinateur sans réserve ; iPhone seulement si l'app est
     ajoutée à l'écran d'accueil (iOS 16.4+). Plus de travail (service worker, clés VAPID, accord de l'utilisateur).
  3. Telegram ou WhatsApp : écarté (compte, API, règles) pour un petit projet.
- Recommandation : badge dans l'app d'abord, puis e-mail ; push plus tard si l'usage le justifie.

## Coût (mesuré, 1 $ ≈ 0,85 €)
Hypothèse prudente : la recherche très active ci-dessus. Apify : 0,001 $ par annonce lue, sans frais de démarrage ;
OpenAI : ≈ 0,0012 $ par nouvelle annonce analysée.

| Par veille quotidienne et par jour | 1 passage (8 h) | 2 passages (8 h, 18 h) |
|---|---|---|
| Annonces lues (nouvelles + remontées + marge 30 %) | ≈ 80 | ≈ 2 × 43 = 86 |
| Apify | 0,08 $ | 0,086 $ |
| OpenAI (≈ 34 nouvelles après verrous) | 0,04 $ | 0,04 $ |
| **Total par jour** | **≈ 0,12 $** | **≈ 0,13 $** |
| **Total par mois** | **≈ 3,6 $** | **≈ 3,8 $** |

- Une recherche plus étroite ou une ville plus petite (5 à 10 nouvelles par jour) : **< 1 $ par mois**.
- Pour comparer : une recherche ponctuelle coûte aujourd'hui ≈ 0,02 à 0,03 $. Refaire chaque jour la recherche
  complète de 10 annonces reviendrait à ≈ 0,3 $ par mois mais **raterait** les nouveautés au-delà de 10 : le suivi
  incrémental lit plus, mais tout ce qui est nouveau.
- Le plan Apify gratuit (5 $ par mois) couvre ≈ 2 recherches très actives suivies (hors OpenAI).
- Les remontées pèsent 37 % de la lecture mais n'apportent rien : on ne peut pas les filtrer à la source.

## Garde-fous (indispensables, sinon le coût suit le nombre d'abonnés)
1. **Plafond de veilles quotidiennes par compte** (proposé : 2).
2. **Arrêt automatique** après 7 jours sans visite de l'utilisateur, ou à date de fin (14 jours, renouvelable en un clic).
3. **Plafond de lecture par passage** (100 annonces) et alerte si dépassé (« recherche trop large, affinez »).
4. **Mutualiser** : deux utilisateurs avec la même adresse de recherche (même ville, mêmes filtres) partagent le même
   passage Apify ; seule l'analyse des critères personnels diffère (en cache par annonce).
5. **Compteur de dépense** visible côté propriétaire (déjà amorcé dans `quota.ts`) et plafond OpenAI à régler dans la
   console OpenAI (toujours pas fait).

## Mise en œuvre proposée
| Étape | Contenu | Estimation |
|---|---|---|
| 1 | Données + planificateur dans le worker + passage incrémental (limite adaptative, rattrapage, verrous) + tests | 1 à 1,5 jour |
| 2 | Interface : « Suivre cette recherche », créneaux, badge « N nouvelles », section des nouveautés, arrêt automatique | 1 jour |
| 3 | E-mail récapitulatif (+ désabonnement en un clic) | ½ à 1 jour |
| 4 | Push, mutualisation entre utilisateurs | à décider selon l'usage |

Les tests suivront les règles du projet : serveur (planificateur avec horloge simulée, rattrapage, limite adaptative,
verrous, arrêt automatique), interface, parcours navigateur ; aucun appel payant (faux Apify, comme aujourd'hui).

## Deux modes : recherche en direct, puis veille quotidienne (idée du 01/10)
Une seule recherche en base, deux états : on la lance **en direct**, et si elle plaît on la **suit** (un clic). Rien
n'est dupliqué : activer le suivi ajoute seulement les créneaux, le curseur « dernier passage » et le prochain passage.

**Recherche en direct** : les annonces **publiées sur les N derniers jours** (7 ou 10), **plafonnées** (15 en production,
25 en développement, réglage par variable d'environnement comme `resultsPerCall`).
- La fenêtre se filtre sur `posted_at` (vraie date de publication) : les annonces remontées en sont exclues.
- Pour obtenir 15 annonces dans la fenêtre il faut lire ≈ 24 candidats (63 % de vraies nouveautés) : Apify ≈ 0,024 $ +
  analyse de 15 annonces ≈ 0,018 $, soit **≈ 0,04 $ par recherche** (≈ 0,025 $ aujourd'hui pour 5 annonces).
- **Attention, dans une ville active le plafond décide, pas la fenêtre** : à Lille ≈ 38 nouvelles annonces par jour, donc
  « 10 jours, 15 annonces max » = les 15 plus récentes, soit environ les 10 dernières heures. Il faut le dire à
  l'utilisateur (« 15 annonces les plus récentes, de ce matin 7 h à maintenant »), sinon il croira avoir tout vu.

**Passer en suivi** : à l'activation le curseur est posé sur « maintenant » ; ce qui est affiché est marqué comme déjà vu.
- Le suivi trouve ce qui **paraît à partir de maintenant**, pas ce qui est plus ancien que la 15e annonce du direct :
  « direct = ce qui existe », « suivi = ce qui arrive ensuite ». À écrire tel quel dans l'interface.
- Créneaux par défaut **8 h et 18 h** (modifiables, de 1 à 2 par jour).
- Plafond par passage : 25 annonces analysées (au-delà : « recherche très large, affinez »), lecture limitée à 100.

**Interface proposée**
- Vocabulaire : « **veille quotidienne** » plutôt que « recherche longue » (parle à l'utilisateur, pas au développeur).
- Sur les résultats, sous la barre d'outils, une carte « **Suivre cette recherche** » : « Recevez les nouvelles annonces
  chaque jour à 8 h et 18 h », deux pastilles d'heure préremplies, bouton rose « Suivre ». Une fois actif, la carte devient
  une ligne discrète « Suivie · prochain passage 18 h · Modifier · Arrêter ».
- Dans « Mes recherches » : deux groupes, **Suivies** en haut (badge rose « 3 nouvelles », heure du prochain passage) puis
  **Recherches ponctuelles** (l'historique actuel).
- Au passage suivant, la page s'ouvre sur une section « **Nouvelles depuis votre dernière visite** », puis le reste.
- Au plafond de veilles quotidiennes (2), le bouton propose de remplacer l'une d'elles.
- « Étendre » prendrait alors un sens naturel : **remonter plus loin dans le temps** (les 15 suivantes plus anciennes).

## Décisions du 01/10 et lecture progressive
Décidé : nom « **veille quotidienne** » ; **une seule par utilisateur** ; prévenu **seulement dans le site** (pastille avec le
nombre d'annonces pas encore vues) ; passages à **8 h et 18 h** ; première recherche plus large (25 à 30 annonces).

**Lecture progressive, mesurée le 01/10** :
- L'acteur repart toujours du haut de la liste (seuls `startUrls` + `limit`), mais l'adresse accepte `page=2`, `page=3`…
  et **Le Bon Coin découpe par 35 annonces** : la page 2 commence ≈ 6 h plus tôt que la page 1 (vérifié).
- Donc pas de « 10 par 10 » sans repayer : relire avec `limit` 10 puis 20 refacture les 10 premières. On fait :
  1. page 1 avec une limite **adaptée** (débit observé × heures écoulées × 1,3, entre 10 et 35) ;
  2. si on n'a pas atteint le dernier passage : page 1 complète (35, seul surcoût possible), puis page 2, page 3 (105 au plus,
     au-delà « recherche trop large, affinez »).
- **Condition d'arrêt : la date, pas « une annonce déjà vue »** : une annonce vue hier et remontée ce matin réapparaît en
  tête ; s'arrêter dessus ferait rater toutes les nouvelles en dessous. On s'arrête à la première annonce dont `updated_at`
  est antérieure ou égale à la plus récente lue au passage précédent ; « nouvelle » = adresse jamais vue.
- Dates Le Bon Coin : heure de Paris étiquetée « Z » (décalage de 2 h l'été, mesuré) : à corriger avant toute comparaison.
- Première recherche : 30 annonces les plus récentes publiées dans les 10 derniers jours = une seule page.

## Implémenté (01/10, sur `develop`)
**Recherche en direct** : Le Bon Coin lu page par page (35 annonces), de la plus récemment mise à jour à la plus
ancienne ; page suivante tant que les **4 derniers jours** ne sont pas atteints, **3 pages au plus** (105 annonces).
Toutes les annonces lues sont gardées ; l'IA analyse les **10 premières** d'emblée, les autres **au fil du défilement**
(5 affichées + 5 d'avance, une demande par annonce ; « Lecture de l'annonce par l'IA… » en attendant). Tri par défaut :
les plus récentes ; chaque carte dit « Publiée il y a 3 h » ou « Remontée hier · publiée le 14 sept. ».
**Étendre** : la page suivante, plus ancienne (une lecture de 35 au plus).

**Veille quotidienne** (une par compte, en activer une autre remplace la précédente) : « Créer une alerte » sur la page
résultats, 8 h et 18 h proposés (de 5 h à 23 h, un ou deux créneaux, heure de Paris, changements d'heure compris).
Le worker lance le passage à l'heure dite ; première page à la taille du débit observé (10 à 35), relue en entier puis
page suivante seulement si les nouveautés dépassent ; **arrêt à la date du passage précédent**, jamais sur « une annonce
déjà vue » (les remontées). Passage manqué (redémarrage) : un seul rattrapage. **Pause automatique** après 7 jours sans
visite (« Reprendre » en un clic). Prévenu **dans le site** : pastille rose sur « Mes recherches » (menu bureau et
bouton Menu sur mobile), nombre dans le titre de l'onglet (« (3) Vite mon logement »), carte en haut de l'accueil et de
« Mes recherches », « N nouvelles annonces depuis votre dernière visite » et étiquette « Nouvelle » sur les cartes ;
ouvrir la recherche remet le compteur à zéro.

**Données** (migration `0007_recherche_suivie`, vérifiée sur PGlite et un vrai Postgres, base existante comprise) :
dates de publication et de mise à jour, première lecture, état d'analyse, annonces masquées après analyse (chambre,
local non habitable, prix contredit) ; sur la recherche : tâche en cours, curseur, pages lues, créneaux, prochain
passage, débit, dernière visite. Dates Le Bon Coin : heure de Paris étiquetée « Z », corrigée (`lib/paris-time.ts`).

**Réglages** (variables d'environnement, valeurs par défaut) : `LIVE_SEARCH_DAYS` 4, `READ_MAX_PAGES` 3,
`FIRST_ANALYSIS` 10, `WATCH_IDLE_DAYS` 7. `APIFY_RESULT_LIMIT` et `APIFY_CANDIDATE_LIMIT` ne servent plus.

**Coût** : première recherche ≈ 0,035 $ par page lue (1 à 3) + ≈ 0,012 $ pour les 10 premières analyses, puis
≈ 0,006 $ par tranche de 5 annonces réellement regardées ; passage suivi : ≈ 0,01 à 0,035 $ de lecture + l'analyse des
nouvelles regardées. Une seule veille quotidienne par compte borne la dépense.

**Tests** : serveur `suivi.test.ts` (faux Le Bon Coin daté servi par pages : 4 jours, 3 pages max, petite ville,
curseur et remontées, relecture, pause, rattrapage, une par compte, analyse demandée, Étendre), `suivi-api.test.ts`
(routes, autre compte en 404), `paris-time.test.ts` ; interface (pastilles, titre d'onglet, alerte, nouveautés, visite,
analyse au défilement, dates, Étendre) ; navigateur mobile puis ordinateur (créer l'alerte, pastille, titre, arrêter).
Captures : `maquettes/suivi-*.png`.

## Ajustements du 01/10 (2e passe, sur `develop`)
- **Recherche ponctuelle** : les **15 annonces les plus récentes**, en une lecture, toutes analysées (`ONE_SHOT_LIMIT`).
- **Créer une veille quotidienne** : bouton avec cloche et texte (« Créer une veille quotidienne ») à côté de la mention
  « Recherche ponctuelle » ; il ouvre une **fenêtre qui explique** (tout de suite les 4 derniers jours jusqu'à 105
  annonces, puis seulement les nouvelles aux heures choisies, pastille rose, remontées et republications jamais
  comptées, pause après 7 jours) et prévient quand une autre veille quotidienne sera remplacée ; rien n'est activé sans
  confirmation. À l'activation, la recherche **remonte 4 jours** (pages de 35, 105 au plus) ; ces annonces ne sont pas
  comptées comme nouvelles (l'utilisateur est là). Puis passages à 8 h et 18 h.
- **Affichage et analyse par 20** (`FIRST_ANALYSIS` 20) : en bas de liste, les 20 suivantes sont analysées avant d'être
  montrées ; l'indicateur rose affiche un message qui change toutes les 3,5 s (« Nous chargeons les annonces suivantes
  pour vous… », « L'IA lit les descriptions, une par une… »…). Les lots de 5 partent 4 à la fois : 20 annonces ≈ le
  temps d'un lot. Remontée de 4 jours : même indicateur, messages dédiés.
- **Accueil** : quand la veille quotidienne a des logements pas encore vus, un **bloc rose** en haut (« 3 nouveaux
  logements à Lille », « Voir les nouveautés ») ; sinon la carte discrète « À jour ».
- **Jamais « nouvelle »** : une annonce **remontée** (même adresse, date de mise à jour plus récente) ni une annonce
  **supprimée puis republiée** (nouvelle adresse, même titre, loyer, surface, pièces et début de description ; le lien
  suit la nouvelle adresse). Deux studios identiques lus ensemble restent deux annonces. Ordre « Plus récentes » : le
  dernier passage d'abord, puis la date de publication, si bien qu'une remontée ne repasse pas devant les nouvelles.
Captures : `maquettes/suivi-1-accueil-nouveautes-*`, `suivi-2-recherche-ponctuelle-mobile`, `suivi-3-fenetre-*`,
`suivi-4-chargement-mobile`, `suivi-5-remontee-4-jours-desktop`.

## Retouches du 01/10 (3e passe)
- « Veille quotidienne » (carte de l'accueil et de « Mes recherches ») en rose ; « N nouvelles annonces depuis votre
  dernière visite » en rose sur fond rose clair.
- Page d'une veille quotidienne : plus de « Modifier ma demande » ni d'« Étendre » (ils restent sur une recherche
  ponctuelle).
- Trait de séparation « Fin de la dernière relève · aujourd'hui à 18:00 » entre les annonces de la dernière relève et
  les plus anciennes (tri « Plus récentes ») ; relève sans rien de nouveau : « Relève aujourd'hui à 18:00 : aucune
  nouvelle annonce » en tête de liste. Heure de la relève gardée en base (`last_watch_at`, migration 0008).
Captures : `maquettes/suivi-v3-*`.

## Revue et corrections du 02/10 (sur `develop`)
**Ne jamais relire une page déjà lue.** Un numéro de page Le Bon Coin ne désigne rien de fixe : chaque nouveauté décale la
liste vers le bas (la « page 3 » d'hier est la « page 4 » d'aujourd'hui). La relève repère donc ce qu'elle a déjà lu par
une **date** (le curseur) : elle repart de la page 1 et descend jusqu'au curseur, sans jamais relire les pages des relèves
précédentes. Il restait trois relectures payées, corrigées :
1. **Bas de la dernière page** : les pages 2 et 3 étaient lues en entier (35). Elles sont maintenant dimensionnées d'après
   le rythme de la page précédente (35 annonces sur X heures) et ce qu'il reste jusqu'à la borne, + 30 % (10 à 35).
   Vaut aussi pour la création de la veille (4 jours).
2. **Page 1 lue en partie puis relue** : au-delà de 25 annonces attendues, la page 1 est lue en entier d'emblée
   (`PARTIAL_MAX`) ; l'acteur ne sait pas « commencer à la 21e », la relecture coûtait plus que le surplus.
3. **Débit gonflé** : une page relue était comptée deux fois dans le débit observé, qui ne faisait que monter. Corrigé ;
   relève tronquée : le débit ne peut que monter (minimum observé).

**Robustesse**
- Panne de l'IA pendant une relève ou la création de la veille : la lecture est enregistrée **avant** l'analyse
  (curseur, heure de la relève) ; les annonces sont analysées à l'affichage. Avant, le curseur restait bloqué et chaque
  relève suivante relisait jusqu'à 3 pages.
- **Issue de la relève** (`last_watch_status`) : « ok », « partial » (plafond de 3 pages, ou page suivante en échec : des
  annonces ont pu échapper) ou « failed » (rien lu, nouvel essai au créneau suivant). Affichée sur la ligne de la veille
  (« Recherche très large… affinez », « La dernière relève n'a pas abouti… »). Relèves en échec d'affilée comptées
  (`watch_failures`) : alerte e-mail au 3e.
- **Mise en pause** : e-mail « Votre veille quotidienne est en pause » avec « Reprendre ».
- « Étendre » : une dernière page lue en partie n'est pas comptée comme lue.
- E-mail à chaque relève qui trouve du nouveau : voir [alerte-mail.md](alerte-mail.md).

Exemple mesuré sur le faux marché des tests : création de veille sur un marché à une annonce toutes les 2 h, 35 + 19
annonces lues au lieu de 35 + 35.

## Simulation sur 10 jours (02/10, `veille-scenario.test.ts`)
Test de bout en bout, sans service payant ni attente : horloge simulée, vraie API, vrai worker, vraie base (PGlite, ou un
vrai Postgres avec `SCENARIO_DATABASE_URL`), faux Le Bon Coin dont le marché vit (≈ 48 annonces par jour de semaine,
15 % de remontées, 4 % de suppressions puis republications), fausse IA, faux Resend. Lancement seul :
`pnpm --filter @workspace/api-server test:veille` (≈ 20 s ; il fait aussi partie de `pnpm test`).

Du jeudi 22 octobre au dimanche 1er novembre 2026 : création (remontée de 4 jours), relèves à 8 h et 18 h, **passage à
l'heure d'hiver** (25/10), **redémarrage** pendant la relève de 8 h (un seul rattrapage à 11 h), **Apify en panne** une
relève (rien de perdu à la suivante), **IA en panne** (relève gardée, e-mail envoyé), **Resend en panne** une fois (nouvel
essai, un seul e-mail), **désinscription** puis réinscription, **7 jours sans visite** (pause, e-mail, plus aucune
lecture), **reprise**.

À chaque relève, comparaison avec un modèle indépendant : exactement les annonces jamais vues au-dessus du curseur
(ni remontées ni republications d'annonces connues, aucune manquante) ; curseur = mise à jour la plus récente ; heure
du passage suivant écrite en dur en UTC (vérifie l'heure de Paris et le changement d'heure) ; pages lues dans l'ordre,
page 1 relue au plus une fois, aucune page lue pour rien ; un seul e-mail, au compte, avec ces annonces et l'heure de
Paris. Bilan : chaque annonce publiée pendant la veille montrée une fois comme nouvelle, aucune analysée deux fois.
Vérifié en réintroduisant des défauts (curseur figé, une seule page, republications non reconnues, relève en échec non
reprogrammée) : chacun fait échouer la simulation.

**Ce que la simulation a appris** : un seul débit pour la journée faisait lire trop à 8 h (la nuit, calme) et pas assez
à 18 h (la journée : page 1 relue 7 fois sur 19). Le débit est maintenant **mémorisé par créneau** (`watch_rates`,
migration 0010) et la page entière n'est lue d'emblée qu'au-delà de **30** annonces attendues. Résultat sur la même
simulation : 743 annonces lues au lieu de 809 (≈ 0,74 $ d'Apify pour 10 jours très actifs), page 1 relue 4 fois (première
relève sans historique, rattrapage, rythme qui change du week-end à la semaine). La simulation l'impose désormais
(lecture ≤ 2 × nouveautés, page 1 relue ≤ 5 fois).

**À savoir** : une annonce ancienne, jamais vue par cette veille (plus vieille que les 4 jours de départ), qui remonte en
tête est montrée comme **nouvelle** (adresse jamais vue). Seules les remontées d'annonces déjà connues ne le sont pas.

## Points ouverts (à décider)
1. Prévenir par e-mail, par push, ou seulement dans l'app pour commencer ?
2. Plafond de veilles quotidiennes par compte (2 ?) et durée avant arrêt automatique (7 jours sans visite ?).
3. Les annonces « remontées » (anciennes réapparues en tête) : à ignorer (proposé : le direct filtre sur la date de publication, le suivi ne garde que les adresses jamais vues) ou à signaler ?
4. Un seul créneau par défaut à 8 h, le second (18 h ?) en option ?
5. Garder SeLoger et PAP désactivés pour le suivi (oui, par économie) ?
