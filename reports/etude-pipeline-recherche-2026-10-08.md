# Étude — pipeline de recherche : où se perdent les annonces ?

Date : 8 octobre 2026. Point de départ : un retour utilisateur, « une annonce qui m'intéressait était sur Le Bon Coin et
l'application ne l'a pas remontée ». Objet : suivre une demande de bout en bout (LLM → requête → Le Bon Coin → lecture →
analyse IA), repérer chaque endroit où une annonce pertinente peut disparaître, et outiller la mesure pour la suite.

**Livrable outil** : un banc d'essai (`artifacts/api-server/src/bench/pipeline/`, mode d'emploi dans son `README.md`),
32 demandes, 81 annonces, lancé sans frais par `pnpm --filter @workspace/api-server bench:pipeline`, protégé contre les
régressions dans `pnpm test`. Rapport détaillé de cette exécution : [`banc-pipeline-2026-10-08.md`](banc-pipeline-2026-10-08.md).

## 1. La pipeline actuelle, et les sept portes qu'une annonce doit franchir

| # | Étape | Code | Ce qui peut faire perdre une bonne annonce |
|---|---|---|---|
| 1 | Interprétation par gpt-5-mini | `ai.ts` `interpret()` | lieu mal rendu, borne trop stricte, souhait perdu (8 au plus) |
| 2 | Lieu → commune | `lib/places.ts` `resolvePlace()` | arrondissement, département, « Ville, France », homonyme → **acteur de secours** sans filtres ni pages |
| 3 | Requête Le Bon Coin | `housing-search.ts` | **cercle de 5 km** autour du centre, **mot obligatoire** `text=`, fourchettes strictes prix / surface / pièces, type de bien |
| 4 | Profondeur | `reader.ts` | recherche ponctuelle : **les 15 annonces les plus récentes**, une seule lecture |
| 5 | Lecture sans IA | `apify.ts` `normalize()`, `offer.ts` | offre prise pour une **demande**, logement entier pris pour une **colocation** |
| 6 | Bornes et champs déclarés | `criteria.ts` | prix / surface / pièces hors bornes, chambres ou DPE contraires (voulu) |
| 7 | Analyse IA | `ai.ts` `analyze()`, `reader.ts` `setAsideReason()` | « chambre » ou « non habitable » sur une citation réelle mais mal comprise |

Les portes 3 et 4 sont **silencieuses** : l'utilisateur ne voit jamais ce qui n'a pas été lu, et rien ne lui dit qu'un
mot obligatoire ou un cercle de 5 km a été appliqué.

## 2. Le banc d'essai

Chaque cas : une demande telle qu'écrite, la réponse du LLM, ce que l'interprétation doit donner, et des annonces (vraies
coordonnées, vrais formats Le Bon Coin) avec ce qu'une bonne application devrait en faire. Le banc passe tout par **le
vrai code** ; seuls deux comportements extérieurs sont **modélisés** : le filtrage fait par Le Bon Coin (cercle, type,
fourchettes, mot cherché) et le rang de l'annonce dans la liste du site. Pour chaque annonce, il dit l'étape exacte où
elle est perdue, en recherche ponctuelle et en veille quotidienne.

Réponses du LLM : **simulées** pour cette étude (aucun appel payant, voir `CLAUDE.md`), écrites au plus près de gpt-5-mini
et des sorties réelles relevées le 29/09 ; 5 cas « robustesse » donnent volontairement une sortie imparfaite pour tester
le code qui la reçoit. `bench:pipeline:live` (≈ 0,03 $) remplace les réponses simulées par de vraies, enregistrées puis
rejouées gratuitement.

**Limites** : les cas sont choisis pour faire apparaître des modes de perte ; les pourcentages ci-dessous ne sont pas une
fréquence réelle, ils comptent des mécanismes. Les deux modèles (filtre du site, rang) restent à confirmer par une vraie
lecture (section 6).

## 3. Résultats

**5 cas sur 32** passent entièrement. Sur **68 annonces qui devraient être montrées, 40 sont perdues** en recherche
ponctuelle (38 encore avec la veille quotidienne). Aucune annonce n'est montrée à tort : les garde-fous existants (type de
bien, chambres, DPE, vraies demandes, vraies colocations, terrain ≠ surface) tiennent.

| Où l'annonce est perdue | Annonces | Cas concernés |
|---|---|---|
| Requête / recherche Le Bon Coin | **30** | rayon (Paris, Marseille, Lille ou Villeneuve, zone autour du CHU), lieux non reconnus, mot obligatoire, bornes strictes, champs manquants |
| Lecture sans IA (regex) | 6 | faux demandeurs (2), fausses colocations (4) |
| Profondeur de lecture | 3 | annonces d'hier, d'il y a 3 et 6 jours |
| Analyse IA | 1 | « chaque chambre dispose d'un placard » cité comme preuve de chambre |

## 4. Constats, par ordre d'impact probable sur le retour utilisateur

### C0. En production, le rayon est ignoré et les villes à trait d'union ne renvoient rien
Le banc tourne sur `develop`. La production tourne sur `main`, qui a 5 commits de retard : l'essai réel du 06/10
(`features/lieux-et-distance.md`) a montré qu'avec l'URL de `main`, **le rayon était ignoré** (seule la commune ressortait,
même à 30 km) et que **les villes à trait d'union** (Villeneuve-d'Ascq, Aix-en-Provence, Marcq-en-Barœul, Saint-Étienne…)
**ne renvoyaient aucune annonce**. Corrigé sur `develop`, pas encore déployé. Si la personne cherchait dans une commune à
trait d'union, ou si l'annonce était dans une commune voisine, c'est l'explication la plus simple. Tout ce qui suit
s'ajoute à ce défaut.

### C1. La recherche ponctuelle ne voit que les 3 ou 4 dernières heures du marché
`ONE_SHOT_LIMIT = 15`. L'échantillon réel du dépôt (`leboncoin-fatih-sample.json`, Lille ≤ 700 €) contient 10 annonces
mises à jour entre 12 h 18 et 14 h 39 : **≈ 4 par heure**. Les 15 annonces lues couvrent donc l'après-midi en cours ; une
annonce d'hier n'est jamais lue, sauf « Étendre » (page suivante) ou veille quotidienne (4 jours). C'est la cause la plus
probable d'un « je l'ai vue sur Le Bon Coin, pas dans l'app ». Cas `profondeur-lille-t2` : 3 annonces sur 4 perdues ; la
veille en récupère 2 (pas celle de 6 jours).

### C2. Un souhait devient un mot obligatoire pour Le Bon Coin (`text=`)
`focusedSearchTerm()` envoie le premier équipement cité (parking, garage, balcon, jardin, terrasse, ascenseur) ou un type
(studio, appartement…) en paramètre `text`. Depuis la suppression de la recherche élargie (01/10), c'est un **filtre dur** :
- « balcon ou terrasse » → `text=balcon` : une annonce avec terrasse seulement n'est jamais lue ;
- « avec parking » → un « garage fermé » ou une « place de stationnement » (même avec le champ `nb_parkings = 1`) est perdu ;
- « maison avec jardin » → un « terrain engazonné » est perdu ;
- **« sans jardin » → `text=jardin`** : seules les maisons qui parlent de jardin sont lues, l'inverse de la demande ;
- « studio » → `text=studio` alors que le filtre « 1 pièce » suffit : un « T1 meublé » est perdu.

Le souhait est de toute façon vérifié ensuite à la lecture (Le Bon Coin, Jev ou LLM) : le mot obligatoire n'apporte que
des pertes. 6 annonces perdues sur 5 cas.

### C3. Le cercle de 5 km autour du centre de la commune
Le rayon par défaut est le même pour Lille et pour Marseille. Paris fait ~11 km d'est en ouest, Marseille ~20 km :
- Paris : le 16e (6,4 km) et le 15e (5,3 km) sortent du cercle ;
- Marseille : 13e, 11e et 16e arrondissements perdus (8,8 à 10,6 km) ;
- « Lille ou Villeneuve-d'Ascq » : une seule ville est gardée, Villeneuve (7 à 8 km) disparaît ;
- « à 20 min à vélo du CHU » : depuis le 06/10 (`develop`), la recherche se centre bien sur le lieu cité (Wattignies,
  à 2,7 km du CHU, est retrouvée). Mais le cercle lu chez Le Bon Coin est la portée estimée **sans marge** (3,85 km),
  alors qu'à la lecture l'app classe « à vérifier » jusqu'à 1,25 fois la durée : une annonce à 4,7 km (≈ 24 min
  estimées) n'est jamais lue.

L'URL de Le Bon Coin porte d'ailleurs deux rayons, « rayon de la ville » puis « rayon choisi » : le site connaît un rayon
propre à chaque ville (de l'ordre de 9 km pour Paris, à vérifier), l'app y met 5 km partout.

### C4. Lieux non reconnus : repli silencieux sur un acteur moins capable
`resolvePlace()` n'accepte que le nom exact d'une commune. Sinon, la recherche part sur l'acteur `clearpath` « par nom » :
ni type de bien, ni pièces, ni surface, ni pages suivantes, et une zone réellement couverte inconnue (❔ dans le banc).
Cas : « Lyon 7e » (relevé réel du 29/09), « Paris 12e, Vincennes » (idem), « Nord », « Saint-Denis » (4 communes),
« Lille, France ». Pire : **« Aix » est reconnu… comme Aix en Corrèze (352 habitants)**, la recherche part à 335 km
d'Aix-en-Provence sans aucun signal.

### C5. Des approximations deviennent des bornes strictes
« Autour de 800 € » → plafond 800 : une annonce à 830 € est écartée par le site. « 700 € hors charges » est comparé au
loyer charges comprises de Le Bon Coin : 690 € + 55 € = 745 € écarté. « Une cinquantaine de m² » → 50 m² minimum : 48 m²
écartés. Annonces sans surface ou sans nombre de pièces renseignés : probablement écartées par le filtre du site
(hypothèse, ❔).

### C6. Filtres sans IA trop larges (offer.ts)
- **Fausses demandes** : « Idéal pour un étudiant *cherchant* un logement… », « Parfait pour une personne qui *recherche* un
  appartement calme » → l'offre est prise pour une demande et masquée (le texte n'a pas « à louer »).
- **Fausses colocations** : « Possibilité de colocation », « Convient à 2 colocataires », « Ouvert à la colocation »,
  « Deux chambres dans un appartement entièrement rénové » → logement entier masqué.
Ces filtres tranchent seuls, alors que l'analyse IA (ou Jev, 99,5 % sur le type d'offre) sait faire la différence.

### C7. Robustesse de l'interprétation
Le code accepte tel quel `maxPrice: 0` (recherche de loyers à 0 €) et `radius: 0` (cercle de 1 km). Au-delà de 8
souhaits, les derniers sont perdus sans prévenir (« sans vis-à-vis », « proche du tram » sur la demande chargée).

### C8. Analyse IA : une citation réelle suffit à masquer
La garde « la citation doit exister » bloque les inventions (vérifié), pas les contresens : « Chaque chambre dispose d'un
placard » cité comme preuve de « chambre » masque un T3 (réponse d'IA simulée ; fréquence réelle inconnue).

### Ce qui marche (témoins du banc)
Type de bien (maison / appartement, « Autre » gardé), chambres et DPE vérifiés sur les champs du site, terrain ≠ surface
habitable, fourchette « T1 ou T2 », vraies demandes et vraies colocations écartées, rayon explicite (15 km) transmis.
Seul écart : une « maison de ville » rangée en « Appartement » par son auteur est filtrée par le site (`real_estate_type`)
avant que la règle du titre de l'app ne puisse la sauver.

## 5. Propositions d'amélioration

Classées par gain attendu sur les annonces manquées. Coûts : acteur Le Bon Coin à 0,001 $ l'annonce lue ; l'analyse IA ne
change pas (elle ne porte que sur les annonces affichées, 20 par 20).

| # | Proposition | Corrige | Coût / risque | Effort |
|---|---|---|---|---|
| **A1** | **Lire plus loin d'emblée** : page entière (35) au lieu de 15, voire 2 pages (70) ; ou lancer la remontée de 4 jours pour toute recherche. Dire à l'utilisateur jusqu'où on a lu (« annonces des dernières 9 h ») et rendre « Étendre » plus visible. | C1 | +0,02 $ (35) à +0,055 $ (70) par recherche | faible |
| **A2** | **Supprimer le mot obligatoire `text=`** (le souhait reste vérifié à la lecture et compte dans le score). À défaut : jamais sur un souhait négatif, jamais un type (studio) quand les pièces sont filtrées, et remplacer par les vrais filtres du site quand ils existent (meublé, extérieur, à vérifier). | C2 | plus d'annonces à lire pour un souhait rare (compensé par A1) | très faible |
| **A3** | **Rayon par défaut selon la taille de la ville** : ajouter la superficie à la base des communes (geo.api.gouv.fr la donne), rayon = rayon équivalent de la commune + 2 km (≈ 7 km à Paris, ≈ 9 km à Marseille, 5 km ailleurs) ; le LLM ne donne un rayon que s'il est explicite. | C3 | plus d'annonces hors centre | faible |
| **A4** | **Lieux** : arrondissements (« Lyon 7e » → Lyon + 69007), « Ville, France / région » nettoyé, homonymes départagés (département demandé au LLM, sinon la plus peuplée et l'utilisateur le voit), plusieurs villes (`locations` de Le Bon Coin en accepte plusieurs, à vérifier), départements. **Ne plus partir en silence sur l'acteur de secours** : demander de préciser la ville (l'autocomplétion serveur existe). Garde-fou « Aix » : une commune minuscule quand une grande porte le même début de nom → demander. | C4 | — | moyen |
| **A5** | **Zone autour d'un lieu cité : ajouter la marge** (centrage sur le lieu fait sur `develop` le 06/10) — lire jusqu'à 1,25 × la portée estimée, comme la lecture qui classe « à vérifier » jusque-là. | C3 | quelques annonces en plus | très faible |
| **A6** | **Marges sur les approximations** : « environ / autour de / une cinquantaine » → +10 % au site, puis badge « léger dépassement » ; « hors charges » → champ `chargesExcluded`, plafond relevé au site, vérification à la lecture. | C5 | quelques annonces en plus | faible |
| **A7** | **Filtres sans IA réservés aux cas sûrs** : demande seulement si le titre ou le début le dit à la 1re personne (« je cherche », « recherche T2 ») ; colocation seulement si le titre le dit. Le reste à l'analyse IA / Jev (type d'offre mesuré à 99,5 %). Ajouter les tournures du banc à `COLOC_OK`. | C6 | un peu plus d'analyses | faible |
| **A8** | **Robustesse** : 0 ou négatif → null pour prix et surface, rayon < 2 → défaut ; garder tous les souhaits (ou 12) et afficher ceux qui ne sont pas vérifiés. | C7 | — | très faible |
| **A9** | **Masquage IA plus exigeant** : « chambre » seulement si la citation parle de partage, de colocation ou de chez l'habitant ; sinon « à vérifier » plutôt que masqué. | C8 | — | faible |
| **A10** | **Transparence** : dans « Votre demande », montrer la requête réellement faite (zone, rayon, bornes, profondeur). Un utilisateur qui voit « Lille, 5 km, 15 annonces les plus récentes » comprend pourquoi une annonce manque. | toutes | — | faible |

**Ordre conseillé** : d'abord **déployer `develop`** (C0, sur votre accord : `main` redéploie Render), puis A2 + A5 + A8
(quelques lignes, risque nul), puis A1 (le plus gros gain, choix de coût à faire), A3, A7,
A6, puis A4 / A10. Chaque correctif fait passer des contrôles du banc de ❌ à ✅ ; `--maj-reference` les protège
ensuite dans `pnpm test`.

## 6. Pour aller plus loin (à décider)

1. **Reproduire le cas signalé** : la demande exacte et le lien de l'annonce Le Bon Coin manquante en font un cas du banc,
   avec l'étape exacte de la perte.
2. **Vraies réponses du LLM** : `bench:pipeline:live`, ≈ 0,03 $ pour les 32 demandes, sur accord explicite. Les réponses
   sont enregistrées et rejouées ensuite gratuitement.
3. **Vraies demandes des utilisateurs** : la base de production garde chaque demande et ses critères (la sortie réelle du
   LLM) : les importer dans le banc ne coûte rien (lecture seule, à autoriser).
4. **Vérifier les deux hypothèses sur Le Bon Coin** par une lecture réelle (≈ 0,04 $) : annonces sans surface / pièces
   face aux filtres `square` / `rooms`, et rayon appliqué par le site quand on choisit « Paris ».
