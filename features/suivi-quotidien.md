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
  toutes les quelques secondes. On y ajoute « recherches suivies dont l'heure est passée ».
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

| Par recherche suivie et par jour | 1 passage (8 h) | 2 passages (8 h, 18 h) |
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
1. **Plafond de recherches suivies par compte** (proposé : 2).
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

## Points ouverts (à décider)
1. Prévenir par e-mail, par push, ou seulement dans l'app pour commencer ?
2. Plafond de recherches suivies par compte (2 ?) et durée avant arrêt automatique (7 jours sans visite ?).
3. Les annonces « remontées » (anciennes réapparues en tête) : à ignorer (proposé) ou à signaler ?
4. Un seul créneau par défaut à 8 h, le second (18 h ?) en option ?
5. Garder SeLoger et PAP désactivés pour le suivi (oui, par économie) ?
