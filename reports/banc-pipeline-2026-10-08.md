# Banc d'essai de la pipeline de recherche — 2026-10-08

Généré par `pnpm --filter @workspace/api-server bench:pipeline` (aucun appel payant). Chaque demande passe par le vrai code : `interpret()` (réponse du LLM rejouée), `actorRequest()`, `normalize()` et les filtres de lecture, `analyze()` (réponse d'IA simulée). Seul le filtrage fait par Le Bon Coin (cercle, type, fourchettes, mot cherché) et la profondeur de lecture sont modélisés.

## Bilan

- **5 cas sur 32** entièrement réussis ; contrôles : 126 ✅, 48 ❌, 8 ❔ (résultat imprévisible : acteur de secours).
- Annonces qui devraient être montrées : **68**, dont **40 perdues** en recherche ponctuelle (38 encore perdues avec la veille quotidienne) ; annonces montrées à tort : 0.
- Où sont perdues les annonces attendues : recherche Le Bon Coin 30 · lecture sans IA 6 · profondeur de lecture 3 · analyse IA 1.
- Par rapport à la référence (baseline.json) : 0 progrès, **0 régressions**, 0 contrôles nouveaux.

## Synthèse par cas

| Cas | Thème | Interprétation | Annonces | Statut |
|---|---|---|---|---|
| [profondeur-lille-t2](#profondeur-lille-t2) | Profondeur de lecture | 6/6 | 1/4 | ❌ |
| [paris-rayon](#paris-rayon) | Géographie | 6/6 | 2/4 | ❌ |
| [marseille-rayon](#marseille-rayon) | Géographie | 5/5 | 2/5 | ❌ |
| [lyon-arrondissement](#lyon-arrondissement) | Géographie | 4/5 | 0/1 | ❌ |
| [paris12-ou-vincennes](#paris12-ou-vincennes) | Géographie | 4/5 | 0/2 | ❌ |
| [lille-ou-villeneuve](#lille-ou-villeneuve) | Géographie | 5/5 | 1/3 | ❌ |
| [departement-nord](#departement-nord) | Géographie | 2/3 | 0/1 | ❌ |
| [saint-denis-ambigu](#saint-denis-ambigu) | Géographie | 1/2 | 0/1 | ❌ |
| [aix-abrege](#aix-abrege) | Géographie | 1/2 | 0/1 | ❌ |
| [lille-france](#lille-france) | Géographie | 0/2 | 0/1 | ❌ |
| [lille-alentours](#lille-alentours) | Géographie | 3/3 | 2/2 | ✅ |
| [lieu-de-travail](#lieu-de-travail) | Géographie | 3/3 | 3/4 | ❌ |
| [budget-environ](#budget-environ) | Budget et surface | 3/3 | 2/3 | ❌ |
| [hors-charges](#hors-charges) | Budget et surface | 1/1 | 1/2 | ❌ |
| [surface-cinquantaine](#surface-cinquantaine) | Budget et surface | 2/2 | 2/3 | ❌ |
| [terrain](#terrain) | Budget et surface | 4/4 | 1/1 | ✅ |
| [budget-zero](#budget-zero) | Budget et surface | 0/1 | 0/1 | ❌ |
| [rayon-zero](#rayon-zero) | Budget et surface | 0/1 | 0/2 | ❌ |
| [balcon-ou-terrasse](#balcon-ou-terrasse) | Mot cherché (text=) | 1/2 | 1/2 | ❌ |
| [maison-jardin](#maison-jardin) | Mot cherché (text=) | 4/5 | 2/3 | ❌ |
| [sans-jardin](#sans-jardin) | Mot cherché (text=) | 1/2 | 0/1 | ❌ |
| [parking-garage](#parking-garage) | Mot cherché (text=) | 1/2 | 1/3 | ❌ |
| [studio-mot](#studio-mot) | Mot cherché (text=) | 3/4 | 1/2 | ❌ |
| [maison-chambres-mot](#maison-chambres-mot) | Mot cherché (text=) | 6/6 | 2/2 | ✅ |
| [faux-demandeurs](#faux-demandeurs) | Filtres de lecture | 1/1 | 2/4 | ❌ |
| [fausses-colocations](#fausses-colocations) | Filtres de lecture | 1/1 | 2/6 | ❌ |
| [champs-manquants](#champs-manquants) | Budget et surface | 3/3 | 0/2 | ❔ |
| [maison-type](#maison-type) | Type de bien, chambres, DPE | 3/3 | 3/4 | ❌ |
| [chambres-dpe](#chambres-dpe) | Type de bien, chambres, DPE | 4/4 | 4/4 | ✅ |
| [t1-ou-t2](#t1-ou-t2) | Type de bien, chambres, DPE | 2/2 | 3/3 | ✅ |
| [demande-chargee](#demande-chargee) | Interprétation | 4/6 | 1/1 | ❌ |
| [ia-chambre](#ia-chambre) | Analyse IA | 1/1 | 2/3 | ❌ |

## Profondeur de lecture

<a id="profondeur-lille-t2"></a>
### Annonce vieille de 1 à 6 jours (`profondeur-lille-t2`)

> Je cherche un T2 à Lille, 750 € maximum.

*Le retour typique : « l'annonce était sur Le Bon Coin, l'appli ne l'a pas montrée ». La recherche ponctuelle ne lit que les 15 annonces les plus récentes ; à Lille, c'est quelques heures de publications.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–750 € · 2–2 pièces · rayon 5 km · mots-clés « T2 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `2-2` · prix `min-750`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| maxPrice | ✅ | attendu 750, obtenu 750 |
| minRooms | ✅ | attendu 2, obtenu 2 |
| maxRooms | ✅ | attendu 2, obtenu 2 |
| lieu reconnu | ✅ | « Lille » : commune Lille (59) → acteur URL (filtres complets, pages) |
| mot cherché (text=) | ✅ | attendu null, obtenu null |
| annonce « du-jour » visible | ✅ | visible |
| annonce « d-hier » visible | ❌ | perdue à l'étape « profondeur de lecture » : rang 22 dans la liste Le Bon Coin : la recherche ponctuelle ne lit que les 15 plus récentes ; la veille la trouverait |
| annonce « trois-jours » visible | ❌ | perdue à l'étape « profondeur de lecture » : rang 58 dans la liste Le Bon Coin : la recherche ponctuelle ne lit que les 15 plus récentes ; la veille la trouverait |
| annonce « six-jours » visible | ❌ | perdue à l'étape « profondeur de lecture » : rang 140 dans la liste Le Bon Coin : la recherche ponctuelle ne lit que les 15 plus récentes ; la veille non plus (6 jours, 105 annonces au plus) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| du-jour | publiée ce matin, rang 3 | 0.8 km | visible | visible |
| d-hier | publiée hier, rang 22 | 1.7 km | profondeur de lecture | visible |
| trois-jours | publiée il y a 3 jours, rang 58 | 3 km | profondeur de lecture | visible |
| six-jours | publiée il y a 6 jours, rang 140, toujours en ligne | 2.2 km | profondeur de lecture | profondeur de lecture |

</details>

## Géographie

<a id="paris-rayon"></a>
### Paris : 5 km autour du centre ne couvrent pas Paris (`paris-rayon`)

> Appartement 2 pièces à Paris, 1 500 € maximum.

*Le rayon par défaut (5 km) part du centre de la commune. Paris fait ~11 km d'est en ouest : le 15e et le 16e sortent du cercle.*

- **Interprétation** (LLM : simulée) : lieu **Paris** · type apartment · …–1500 € · 2–2 pièces · rayon 5 km · mots-clés « appartement 2 pièces »
- **Requête Le Bon Coin** : centre Paris (48.8589, 2.3470), rayon **5 km** · type `2,5` · pièces `2-2` · prix `min-1500`
- **Zone couverte** : 1 communes dont le centre est dans le cercle (Paris)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Paris", obtenu "Paris" |
| propertyType | ✅ | attendu "apartment", obtenu "apartment" |
| maxPrice | ✅ | attendu 1500, obtenu 1500 |
| minRooms | ✅ | attendu 2, obtenu 2 |
| maxRooms | ✅ | attendu 2, obtenu 2 |
| lieu reconnu | ✅ | « Paris » : commune Paris (75) → acteur URL (filtres complets, pages) |
| annonce « paris-11 » visible | ✅ | visible |
| annonce « paris-16 » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 6.5 km du centre (Paris), rayon 5 km |
| annonce « paris-15 » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 5.3 km du centre (Paris), rayon 5 km |
| annonce « montreuil » écartée | ✅ | perdue à l'étape « recherche Le Bon Coin » : à 7.4 km du centre (Paris), rayon 5 km |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| paris-11 | Paris 11e, 2,5 km du centre | 2.4 km | visible | visible |
| paris-16 | Paris 16e (Auteuil), 6,4 km du centre | 6.5 km | recherche Le Bon Coin | recherche Le Bon Coin |
| paris-15 | Paris 15e (porte de Versailles), 5,2 km du centre | 5.3 km | recherche Le Bon Coin | recherche Le Bon Coin |
| montreuil | Montreuil : pas Paris | 7.4 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="marseille-rayon"></a>
### Marseille : la moitié de la ville hors du cercle (`marseille-rayon`)

> Je cherche un T3 à Marseille pour 1 100 € maximum.

*Marseille s'étend sur ~20 km : 5 km autour du centre ignorent les 11e, 13e, 15e et 16e arrondissements.*

- **Interprétation** (LLM : simulée) : lieu **Marseille** · …–1100 € · 3–3 pièces · rayon 5 km · mots-clés « T3 »
- **Requête Le Bon Coin** : centre Marseille (43.2803, 5.3806), rayon **5 km** · type `1,2` · pièces `3-3` · prix `min-1100`
- **Zone couverte** : 1 communes dont le centre est dans le cercle (Marseille)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Marseille", obtenu "Marseille" |
| maxPrice | ✅ | attendu 1100, obtenu 1100 |
| minRooms | ✅ | attendu 3, obtenu 3 |
| maxRooms | ✅ | attendu 3, obtenu 3 |
| lieu reconnu | ✅ | « Marseille » : commune Marseille (13) → acteur URL (filtres complets, pages) |
| annonce « castellane » visible | ✅ | visible |
| annonce « pointe-rouge » visible | ✅ | visible |
| annonce « chateau-gombert » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 9.8 km du centre (Marseille), rayon 5 km |
| annonce « la-valentine » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 8.8 km du centre (Marseille), rayon 5 km |
| annonce « estaque » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 10.6 km du centre (Marseille), rayon 5 km |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| castellane | 6e, 0,7 km | 0.7 km | visible | visible |
| pointe-rouge | 8e, 4,4 km | 4.4 km | visible | visible |
| chateau-gombert | 13e, 9,8 km | 9.8 km | recherche Le Bon Coin | recherche Le Bon Coin |
| la-valentine | 11e, 8,8 km | 8.8 km | recherche Le Bon Coin | recherche Le Bon Coin |
| estaque | 16e, 10,6 km | 10.6 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="lyon-arrondissement"></a>
### Arrondissement : « Lyon 7e » n'est pas une commune (`lyon-arrondissement`)

> T2 meublé à Lyon 7e, 900 € maximum.

*Le 29/09, gpt-5-mini a rendu « Lyon 7e » tel quel. La base des communes ne le connaît pas : repli sur l'acteur « par nom », sans type, sans pièces, sans surface ni pages.*

- **Interprétation** (LLM : simulée) : lieu **Lyon 7e** · …–900 € · 2–2 pièces · rayon 5 km · mots-clés « T2 meublé »
- **Souhaits** : « meublé »
- **Requête** : ⚠️ acteur de secours (lieu non reconnu), recherche par nom : `{"location":"Lyon 7e","radius":"5","price_max_filter":"900","adLimit":"15"}` — ni type, ni pièces, ni surface, ni pages suivantes

| Contrôle | Résultat | Détail |
|---|---|---|
| maxPrice | ✅ | attendu 900, obtenu 900 |
| minRooms | ✅ | attendu 2, obtenu 2 |
| maxRooms | ✅ | attendu 2, obtenu 2 |
| lieu reconnu | ❌ | « Lyon 7e » : inconnu → acteur de secours (recherche par nom, sans type ni pièces ni surface) |
| souhait /meubl/ | ✅ | souhaits : ["meublé"] |
| annonce « jean-mace » visible | ❔ | perdue à l'étape « recherche Le Bon Coin » : lieu « Lyon 7e » non reconnu : recherche par nom (acteur de secours), zone réellement couverte inconnue |

<a id="paris12-ou-vincennes"></a>
### Deux lieux en une seule chaîne (`paris12-ou-vincennes`)

> Paris 12e ou Vincennes : appartement à louer, 1 500 € maximum, 45 m² minimum, deux chambres, proche d'un parc.

*Relevé du 29/09 : « Paris 12e, Vincennes » en un seul lieu, inconnu de la base → acteur de secours, zone imprévisible.*

- **Interprétation** (LLM : simulée) : lieu **Paris 12e, Vincennes** · type apartment · …–1500 € · 45–… m² · ≥ 2 chambres · rayon 5 km · mots-clés « appartement »
- **Souhaits** : « proche d'un parc »
- **Requête** : ⚠️ acteur de secours (lieu non reconnu), recherche par nom : `{"location":"Paris 12e, Vincennes","radius":"5","price_max_filter":"1500","adLimit":"15"}` — ni type, ni pièces, ni surface, ni pages suivantes

| Contrôle | Résultat | Détail |
|---|---|---|
| maxPrice | ✅ | attendu 1500, obtenu 1500 |
| minArea | ✅ | attendu 45, obtenu 45 |
| minRooms | ✅ | attendu null, obtenu null |
| minBedrooms | ✅ | attendu 2, obtenu 2 |
| lieu reconnu | ❌ | « Paris 12e, Vincennes » : inconnu → acteur de secours (recherche par nom, sans type ni pièces ni surface) |
| annonce « vincennes » visible | ❔ | perdue à l'étape « recherche Le Bon Coin » : lieu « Paris 12e, Vincennes » non reconnu : recherche par nom (acteur de secours), zone réellement couverte inconnue |
| annonce « bel-air » visible | ❔ | perdue à l'étape « recherche Le Bon Coin » : lieu « Paris 12e, Vincennes » non reconnu : recherche par nom (acteur de secours), zone réellement couverte inconnue |

<a id="lille-ou-villeneuve"></a>
### « Lille ou Villeneuve-d'Ascq » : une seule ville gardée (`lille-ou-villeneuve`)

> T3 à Lille ou Villeneuve-d'Ascq, 1 000 € maximum.

*Une seule ville par recherche : le LLM garde Lille, les annonces de Villeneuve-d'Ascq (7 à 8 km) sortent du rayon de 5 km.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–1000 € · 3–3 pièces · rayon 5 km · mots-clés « T3 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `3-3` · prix `min-1000`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| maxPrice | ✅ | attendu 1000, obtenu 1000 |
| minRooms | ✅ | attendu 3, obtenu 3 |
| maxRooms | ✅ | attendu 3, obtenu 3 |
| lieu reconnu | ✅ | « Lille » : commune Lille (59) → acteur URL (filtres complets, pages) |
| annonce « fives » visible | ✅ | visible |
| annonce « pont-de-bois » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 7.3 km du centre (Lille), rayon 5 km |
| annonce « vda-centre » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 8.1 km du centre (Lille), rayon 5 km |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| fives | Lille Fives | 3 km | visible | visible |
| pont-de-bois | Villeneuve-d'Ascq, Pont de Bois (7,4 km) | 7.3 km | recherche Le Bon Coin | recherche Le Bon Coin |
| vda-centre | Villeneuve-d'Ascq, hôtel de ville (8,1 km) | 8.1 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="departement-nord"></a>
### Un département (`departement-nord`)

> Maison avec jardin dans le Nord, 1 100 € maximum.

*Un département n'est pas dans la base des communes : acteur de secours, recherche « Nord » par nom, rayon de 5 km.*

- **Interprétation** (LLM : simulée) : lieu **Nord** · type house · …–1100 € · rayon 5 km · mots-clés « maison jardin »
- **Souhaits** : « jardin »
- **Requête** : ⚠️ acteur de secours (lieu non reconnu), recherche par nom : `{"searchQuery":"jardin","location":"Nord","radius":"5","price_max_filter":"1100","adLimit":"15"}` — ni type, ni pièces, ni surface, ni pages suivantes

| Contrôle | Résultat | Détail |
|---|---|---|
| propertyType | ✅ | attendu "house", obtenu "house" |
| maxPrice | ✅ | attendu 1100, obtenu 1100 |
| lieu reconnu | ❌ | « Nord » : inconnu → acteur de secours (recherche par nom, sans type ni pièces ni surface) |
| annonce « bailleul » visible | ❔ | perdue à l'étape « recherche Le Bon Coin » : lieu « Nord » non reconnu : recherche par nom (acteur de secours), zone réellement couverte inconnue |

<a id="saint-denis-ambigu"></a>
### Nom de commune ambigu (`saint-denis-ambigu`)

> Studio à Saint-Denis, 700 € maximum.

*Quatre communes s'appellent Saint-Denis : sans département, la ville n'est pas reconnue (acteur de secours).*

- **Interprétation** (LLM : simulée) : lieu **Saint-Denis** · type apartment · …–700 € · 1–1 pièces · rayon 5 km · mots-clés « studio »
- **Requête** : ⚠️ acteur de secours (lieu non reconnu), recherche par nom : `{"searchQuery":"studio","location":"Saint-Denis","radius":"5","price_max_filter":"700","adLimit":"15"}` — ni type, ni pièces, ni surface, ni pages suivantes

| Contrôle | Résultat | Détail |
|---|---|---|
| maxPrice | ✅ | attendu 700, obtenu 700 |
| lieu reconnu | ❌ | « Saint-Denis » : ambigu (4 communes) → acteur de secours (recherche par nom, sans type ni pièces ni surface) |
| annonce « saint-denis-93 » visible | ❔ | perdue à l'étape « recherche Le Bon Coin » : lieu « Saint-Denis » non reconnu : recherche par nom (acteur de secours), zone réellement couverte inconnue |

<a id="aix-abrege"></a>
### « Aix » : un village de Corrèze (`aix-abrege`)

> Studio à Aix pour mes études, 650 € maximum.

*Si le LLM recopie « Aix », la base des communes le reconnaît… comme Aix (Corrèze, 352 habitants) : la recherche part à 400 km.*

- **Interprétation** (LLM : robustesse : le LLM recopie « Aix ») : lieu **Aix** · type apartment · …–650 € · 1–1 pièces · rayon 5 km · mots-clés « studio »
- **Requête Le Bon Coin** : centre Aix (45.6160, 2.3930), rayon **5 km** · type `2,5` · pièces `1-1` · prix `min-650` · **mot obligatoire `studio`**
- **Zone couverte** : 3 communes dont le centre est dans le cercle (Merlines, Aix, Saint-Pardoux-le-Neuf)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ❌ | attendu "Aix-en-Provence", obtenu "Aix" |
| maxPrice | ✅ | attendu 650, obtenu 650 |
| annonce « aix-en-provence » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 335.1 km du centre (Aix), rayon 5 km |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| aix-en-provence | Aix-en-Provence centre | 335.1 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="lille-france"></a>
### Lieu rendu « Lille, France » (`lille-france`)

> Appartement à Lille, 800 € maximum.

*Une ville suivie de « , France » ou de la région n'est pas reconnue (seuls un département ou un code postal le sont) : acteur de secours.*

- **Interprétation** (LLM : robustesse : le LLM ajoute « , France ») : lieu **Lille, France** · type apartment · …–800 € · rayon 5 km · mots-clés « appartement »
- **Requête** : ⚠️ acteur de secours (lieu non reconnu), recherche par nom : `{"location":"Lille, France","radius":"5","price_max_filter":"800","adLimit":"15"}` — ni type, ni pièces, ni surface, ni pages suivantes

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ❌ | attendu "Lille", obtenu "Lille, France" |
| lieu reconnu | ❌ | « Lille, France » : inconnu → acteur de secours (recherche par nom, sans type ni pièces ni surface) |
| annonce « centre » visible | ❔ | perdue à l'étape « recherche Le Bon Coin » : lieu « Lille, France » non reconnu : recherche par nom (acteur de secours), zone réellement couverte inconnue |

<a id="lille-alentours"></a>
### Rayon explicite (15 km) (`lille-alentours`)

> T2 à Lille ou alentours, 15 km maximum, 750 €.

*Témoin : un rayon explicite est bien transmis.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–750 € · 2–2 pièces · rayon 15 km · mots-clés « T2 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **15 km** · type `1,2` · pièces `2-2` · prix `min-750`
- **Zone couverte** : 97 communes dont le centre est dans le cercle (Lille, Tourcoing, Roubaix, Villeneuve-d'Ascq, Wattrelos, Marcq-en-Barœul, Lambersart, Armentières…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| lieu reconnu | ✅ | « Lille » : commune Lille (59) → acteur URL (filtres complets, pages) |
| rayon | ✅ | attendu ≥ 15 km, obtenu 15 km |
| annonce « roubaix » visible | ✅ | visible |
| annonce « lambersart » visible | ✅ | visible |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| roubaix | Roubaix, 11 km | 11.6 km | visible | visible |
| lambersart | Lambersart, 2,7 km | 3 km | visible | visible |

</details>

<a id="lieu-de-travail"></a>
### « À 20 min à vélo du CHU » : zone sans marge (`lieu-de-travail`)

> Je travaille à l'hôpital Huriez (CHU de Lille), je cherche un T2 à 20 minutes à vélo maximum, 800 €.

*Depuis le 06/10 (develop), la recherche se centre sur le lieu cité : bien. Mais le cercle lu chez Le Bon Coin est la portée estimée sans marge (20 min à 15 km/h, détour 1,3 → 3,85 km), alors qu'à la lecture l'app classe « à vérifier » jusqu'à 25 min : une annonce à 4,7 km (≈ 24 min) n'est jamais lue.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–800 € · 2–2 pièces · rayon 5 km · mots-clés « T2 »
- **Lieux de vie** : Travail : Hôpital Claude Huriez, CHU de Lille (bike) ≤ 20 min → trouvé (50.6100, 3.0350) · centre de la recherche · portée 3.8 km 
- **Requête Le Bon Coin** : centre Lille, lieu cité (50.6100, 3.0350), rayon **3.846 km** · type `1,2` · pièces `2-2` · prix `min-800`
- **Zone couverte** : 7 communes dont le centre est dans le cercle (Lille, Loos, Faches-Thumesnil, Wattignies, Haubourdin, Sequedin, Emmerin)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| maxPrice | ✅ | attendu 800, obtenu 800 |
| lieu reconnu | ✅ | « Lille » : commune Lille (59) → acteur URL (filtres complets, pages) |
| annonce « loos » visible | ✅ | visible |
| annonce « wattignies » visible | ✅ | visible |
| annonce « fives » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 4.7 km du centre (Lille, lieu cité), rayon 3.8 km |
| annonce « pont-de-bois » écartée | ✅ | perdue à l'étape « recherche Le Bon Coin » : à 8.4 km du centre (Lille, lieu cité), rayon 3.8 km |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| loos | Loos, 1,6 km du CHU | 1.6 km | visible | visible |
| wattignies | Wattignies, 2,7 km du CHU (5,0 km du centre de Lille) | 2.7 km | visible | visible |
| fives | Fives, 4,7 km du CHU : ≈ 24 min estimées, « à vérifier » pour l'app | 4.7 km | recherche Le Bon Coin | recherche Le Bon Coin |
| pont-de-bois | Villeneuve-d'Ascq, 8 km du CHU : trop loin | 8.4 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

## Budget et surface

<a id="budget-environ"></a>
### « Autour de 800 € » devient un plafond strict (`budget-environ`)

> Un T2 à Lille autour de 800 € par mois.

*« Autour de » n'est pas « au plus » : une annonce à 830 € intéresse, le filtre du site l'écarte.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–800 € · 2–2 pièces · rayon 5 km · mots-clés « T2 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `2-2` · prix `min-800`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| minRooms | ✅ | attendu 2, obtenu 2 |
| maxRooms | ✅ | attendu 2, obtenu 2 |
| annonce « 790 » visible | ✅ | visible |
| annonce « 830 » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : 830 € hors de price=min-800 |
| annonce « 1000 » écartée | ✅ | perdue à l'étape « recherche Le Bon Coin » : 1000 € hors de price=min-800 |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| 790 | 790 € | 0.8 km | visible | visible |
| 830 | 830 € : léger dépassement | 1.7 km | recherche Le Bon Coin | recherche Le Bon Coin |
| 1000 | 1 000 € : trop cher | 1.3 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="hors-charges"></a>
### « 700 € hors charges » comparé au loyer charges comprises (`hors-charges`)

> T2 à Lille, 700 € hors charges maximum.

*Le prix Le Bon Coin est charges comprises. 690 € + 55 € de charges = 745 € : écarté alors qu'il respecte la demande.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–700 € · 2–2 pièces · rayon 5 km · mots-clés « T2 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `2-2` · prix `min-700`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| annonce « 690-plus-55 » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : 745 € hors de price=min-700 |
| annonce « 680-cc » visible | ✅ | visible |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| 690-plus-55 | 690 € HC + 55 € de charges = 745 € CC | 2.2 km | recherche Le Bon Coin | recherche Le Bon Coin |
| 680-cc | 680 € charges comprises | 3 km | visible | visible |

</details>

<a id="surface-cinquantaine"></a>
### « Une cinquantaine de m² » devient « 50 m² minimum » (`surface-cinquantaine`)

> Appartement d'une cinquantaine de m² à Lille, 900 € maximum.

*Une approximation devient une borne stricte : 48 m² sont écartés.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · type apartment · …–900 € · 50–… m² · rayon 5 km · mots-clés « appartement »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `2,5` · surface `50-max` · prix `min-900`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| maxPrice | ✅ | attendu 900, obtenu 900 |
| annonce « 48m2 » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : 48 m² hors de square=50-max |
| annonce « 52m2 » visible | ✅ | visible |
| annonce « 30m2 » écartée | ✅ | perdue à l'étape « recherche Le Bon Coin » : 30 m² hors de square=50-max |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| 48m2 | 48 m² | 0.8 km | recherche Le Bon Coin | recherche Le Bon Coin |
| 52m2 | 52 m² | 2.2 km | visible | visible |
| 30m2 | 30 m² : bien trop petit | 1.7 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="terrain"></a>
### Terrain de 1 000 m² (garde-fou existant) (`terrain`)

> Maison à louer près de Lille avec un terrain de 1 000 m², 1 300 € maximum.

*Témoin : la surface d'un terrain prise pour la surface habitable est rattrapée (landAreaClause).*

- **Interprétation** (LLM : robustesse : le LLM prend le terrain pour la surface habitable) : lieu **Lille** · type house · …–1300 € · rayon 10 km · mots-clés « maison terrain »
- **Souhaits** : « terrain de 1 000 m² »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **10 km** · type `1,5` · prix `min-1300`
- **Zone couverte** : 42 communes dont le centre est dans le cercle (Lille, Villeneuve-d'Ascq, Marcq-en-Barœul, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Wasquehal…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| propertyType | ✅ | attendu "house", obtenu "house" |
| minArea | ✅ | attendu null, obtenu null |
| souhait /terrain/ | ✅ | souhaits : ["terrain de 1 000 m²"] |
| annonce « lambersart » visible | ✅ | visible |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| lambersart | Maison 110 m² avec terrain | 3 km | visible | visible |

</details>

<a id="budget-zero"></a>
### Budget non fixé rendu par 0 (`budget-zero`)

> T2 à Lille, je n'ai pas encore fixé de budget.

*Si le LLM rend maxPrice = 0 au lieu de null, le code l'accepte : la recherche demande des loyers de 0 €.*

- **Interprétation** (LLM : robustesse : maxPrice = 0 au lieu de null) : lieu **Lille** · …–0 € · 2–2 pièces · rayon 5 km · mots-clés « T2 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `2-2` · prix `min-0`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| maxPrice | ❌ | attendu null, obtenu 0 |
| annonce « t2 » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : 700 € hors de price=min-0 |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| t2 | T2 à 700 € | 3 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="rayon-zero"></a>
### « Intra-muros » rendu par un rayon de 0 (`rayon-zero`)

> Studio à Lille intra-muros, 600 € maximum.

*Un rayon de 0 devient 1 km autour du centre : la plus grande partie de Lille est perdue.*

- **Interprétation** (LLM : robustesse : radius = 0) : lieu **Lille** · type apartment · …–600 € · 1–1 pièces · rayon 0 km · mots-clés « studio »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **1 km** · type `2,5` · pièces `1-1` · prix `min-600` · **mot obligatoire `studio`**
- **Zone couverte** : 1 communes dont le centre est dans le cercle (Lille)

| Contrôle | Résultat | Détail |
|---|---|---|
| rayon | ❌ | attendu ≥ 3 km, obtenu 1 km |
| annonce « vieux-lille » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 1.7 km du centre (Lille), rayon 1 km |
| annonce « fives » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : à 3.0 km du centre (Lille), rayon 1 km |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| vieux-lille | Vieux-Lille, 1,4 km | 1.7 km | recherche Le Bon Coin | recherche Le Bon Coin |
| fives | Fives, 3 km | 3 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

## Mot cherché (text=)

<a id="balcon-ou-terrasse"></a>
### « Balcon ou terrasse » : seul « balcon » est cherché (`balcon-ou-terrasse`)

> T2 à Lille avec balcon ou terrasse, 850 € maximum.

*Le premier équipement d'un souhait devient un mot obligatoire pour Le Bon Coin (il n'y a plus de recherche élargie depuis le 01/10) : une annonce avec terrasse seulement n'est jamais lue.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–850 € · 2–2 pièces · rayon 5 km · mots-clés « T2 »
- **Souhaits** : « balcon ou terrasse »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `2-2` · prix `min-850` · **mot obligatoire `balcon`**
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| mot cherché (text=) | ❌ | attendu null, obtenu "balcon" |
| souhait /balcon/ | ✅ | souhaits : ["balcon ou terrasse"] |
| annonce « balcon » visible | ✅ | visible |
| annonce « terrasse » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : le mot « balcon » n'apparaît pas dans l'annonce (text=balcon) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| balcon | avec balcon | 0.8 km | visible | visible |
| terrasse | avec terrasse seulement | 1.7 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="maison-jardin"></a>
### « Jardin » obligatoire dans le texte (`maison-jardin`)

> Maison avec jardin à Villeneuve-d'Ascq, 1 300 € maximum.

*Une maison avec « terrain » ou « extérieur engazonné » mais sans le mot « jardin » n'est jamais lue.*

- **Interprétation** (LLM : simulée) : lieu **Villeneuve-d'Ascq** · type house · …–1300 € · rayon 5 km · mots-clés « maison jardin »
- **Souhaits** : « jardin »
- **Requête Le Bon Coin** : centre Villeneuve-d'Ascq (50.6362, 3.1619), rayon **5 km** · type `1,5` · prix `min-1300` · **mot obligatoire `jardin`**
- **Zone couverte** : 13 communes dont le centre est dans le cercle (Villeneuve-d'Ascq, Mons-en-Barœul, Wasquehal, Croix, Hem, Chéreng, Lezennes, Willems…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Villeneuve-d'Ascq", obtenu "Villeneuve-d'Ascq" |
| propertyType | ✅ | attendu "house", obtenu "house" |
| lieu reconnu | ✅ | « Villeneuve-d'Ascq » : commune Villeneuve-d'Ascq (59) → acteur URL (filtres complets, pages) |
| mot cherché (text=) | ❌ | attendu null, obtenu "jardin" |
| souhait /jardin/ | ✅ | souhaits : ["jardin"] |
| annonce « jardin » visible | ✅ | visible |
| annonce « terrain » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : le mot « jardin » n'apparaît pas dans l'annonce (text=jardin) |
| annonce « appartement » écartée | ✅ | perdue à l'étape « recherche Le Bon Coin » : type 2 hors de real_estate_type=1,5 |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| jardin | le mot « jardin » | 2.4 km | visible | visible |
| terrain | « terrain engazonné », pas « jardin » | 0.9 km | recherche Le Bon Coin | recherche Le Bon Coin |
| appartement | un appartement | 1.8 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="sans-jardin"></a>
### « Sans jardin » cherche… « jardin » (`sans-jardin`)

> Maison à Villeneuve-d'Ascq sans jardin, je n'ai pas le temps de l'entretenir, 1 200 € maximum.

*Un souhait négatif choisit le même mot-clé : seules les annonces qui parlent de jardin sont lues, l'inverse de la demande.*

- **Interprétation** (LLM : simulée) : lieu **Villeneuve-d'Ascq** · type house · …–1200 € · rayon 5 km · mots-clés « maison »
- **Souhaits** : « sans jardin »
- **Requête Le Bon Coin** : centre Villeneuve-d'Ascq (50.6362, 3.1619), rayon **5 km** · type `1,5` · prix `min-1200` · **mot obligatoire `jardin`**
- **Zone couverte** : 13 communes dont le centre est dans le cercle (Villeneuve-d'Ascq, Mons-en-Barœul, Wasquehal, Croix, Hem, Chéreng, Lezennes, Willems…)

| Contrôle | Résultat | Détail |
|---|---|---|
| mot cherché (text=) | ❌ | attendu null, obtenu "jardin" |
| souhait /sans jardin/ | ✅ | souhaits : ["sans jardin"] |
| annonce « cour » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : le mot « jardin » n'apparaît pas dans l'annonce (text=jardin) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| cour | maison avec une petite cour | 2.4 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="parking-garage"></a>
### « Parking » obligatoire dans le texte (`parking-garage`)

> T3 à Lille avec parking, 1 000 € maximum.

*Garage, box ou « place de stationnement » : pas le mot « parking », annonce jamais lue, même quand le champ Le Bon Coin dit 1 place.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–1000 € · 3–3 pièces · rayon 5 km · mots-clés « T3 »
- **Souhaits** : « parking »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `3-3` · prix `min-1000` · **mot obligatoire `parking`**
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| mot cherché (text=) | ❌ | attendu null, obtenu "parking" |
| souhait /parking/ | ✅ | souhaits : ["parking"] |
| annonce « parking » visible | ✅ | visible |
| annonce « garage » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : le mot « parking » n'apparaît pas dans l'annonce (text=parking) |
| annonce « champ-site » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : le mot « parking » n'apparaît pas dans l'annonce (text=parking) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| parking | « place de parking » | 2.2 km | visible | visible |
| garage | « garage fermé » | 3 km | recherche Le Bon Coin | recherche Le Bon Coin |
| champ-site | « stationnement » et champ nb_parkings = 1 | 3 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="studio-mot"></a>
### « Studio » obligatoire dans le texte (`studio-mot`)

> Studio meublé à Lille pour étudiant, 550 € maximum.

*Le type « studio » devient un mot obligatoire alors que le filtre « 1 pièce » suffit : un « T1 meublé » n'est jamais lu.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · type apartment · …–550 € · 1–1 pièces · rayon 5 km · mots-clés « studio meublé »
- **Souhaits** : « meublé »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `2,5` · pièces `1-1` · prix `min-550` · **mot obligatoire `studio`**
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| propertyType | ✅ | attendu "apartment", obtenu "apartment" |
| minRooms | ✅ | attendu 1, obtenu 1 |
| maxRooms | ✅ | attendu 1, obtenu 1 |
| mot cherché (text=) | ❌ | attendu null, obtenu "studio" |
| annonce « studio » visible | ✅ | visible |
| annonce « t1 » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : le mot « studio » n'apparaît pas dans l'annonce (text=studio) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| studio | « studio » | 3 km | visible | visible |
| t1 | « T1 », pas « studio » | 2.2 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="maison-chambres-mot"></a>
### Maison 3 chambres, texte abrégé (`maison-chambres-mot`)

> Maison 3 chambres à Lambersart, 1 400 € maximum.

*Témoin : « chambres » (au pluriel) dans les mots-clés ne devient pas un mot obligatoire ; le tri se fait sur le champ chambres du site, même quand le texte abrège « 3 ch. ».*

- **Interprétation** (LLM : simulée) : lieu **Lambersart** · type house · …–1400 € · ≥ 3 chambres · rayon 5 km · mots-clés « maison 3 chambres »
- **Requête Le Bon Coin** : centre Lambersart (50.6538, 3.0248), rayon **5 km** · type `1,5` · pièces `3-max` · prix `min-1400`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, La Madeleine, Saint-André-lez-Lille, Marquette-lez-Lille, Pérenchies, Sequedin, Capinghem…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lambersart", obtenu "Lambersart" |
| propertyType | ✅ | attendu "house", obtenu "house" |
| minRooms | ✅ | attendu null, obtenu null |
| minBedrooms | ✅ | attendu 3, obtenu 3 |
| lieu reconnu | ✅ | « Lambersart » : commune Lambersart (59) → acteur URL (filtres complets, pages) |
| mot cherché (text=) | ✅ | attendu null, obtenu null |
| annonce « 3-ch » visible | ✅ | visible |
| annonce « 2-ch » écartée | ✅ | perdue à l'étape « lecture sans IA » : chambres ou DPE déclarés contraires (contradictsDeclared) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| 3-ch | « 3 ch. » abrégé, champ chambres = 3 | 0 km | visible | visible |
| 2-ch | 2 chambres déclarées | 0 km | lecture sans IA | lecture sans IA |

</details>

## Filtres de lecture

<a id="faux-demandeurs"></a>
### Offres prises pour des demandes (`faux-demandeurs`)

> T2 à Lille près des facs, 700 € maximum.

*« … pour un étudiant cherchant un logement » dans les 200 premiers caractères suffit à faire passer une offre pour une demande.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–700 € · 2–2 pièces · rayon 5 km · mots-clés « T2 »
- **Souhaits** : « près des facs »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `2-2` · prix `min-700`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| annonce « etudiant-cherchant » visible | ❌ | perdue à l'étape « lecture sans IA » : prise pour une demande de logement (offer.ts : isSeekerAd) |
| annonce « personne-qui-recherche » visible | ❌ | perdue à l'étape « lecture sans IA » : prise pour une demande de logement (offer.ts : isSeekerAd) |
| annonce « proprio-cherche » visible | ✅ | visible |
| annonce « vraie-demande » écartée | ✅ | perdue à l'étape « lecture sans IA » : prise pour une demande de logement (offer.ts : isSeekerAd) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| etudiant-cherchant | « idéal pour un étudiant cherchant un logement » | 2.2 km | lecture sans IA | lecture sans IA |
| personne-qui-recherche | « parfait pour une personne qui recherche un appartement calme » | 0.8 km | lecture sans IA | lecture sans IA |
| proprio-cherche | « nous recherchons un locataire sérieux » | 3 km | visible | visible |
| vraie-demande | vraie demande de logement | 1.3 km | lecture sans IA | lecture sans IA |

</details>

<a id="fausses-colocations"></a>
### Logements entiers pris pour des colocations (`fausses-colocations`)

> T3 à Lille, 1 000 € maximum.

*Le filtre sans IA écarte toute mention de colocation sauf quelques tournures (« colocation acceptée », « pas de colocation »).*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–1000 € · 3–3 pièces · rayon 5 km · mots-clés « T3 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `3-3` · prix `min-1000`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| annonce « possibilite » visible | ❌ | perdue à l'étape « lecture sans IA » : prise pour une colocation ou une chambre (offer.ts : isColocationAd) |
| annonce « convient » visible | ❌ | perdue à l'étape « lecture sans IA » : prise pour une colocation ou une chambre (offer.ts : isColocationAd) |
| annonce « ouvert » visible | ❌ | perdue à l'étape « lecture sans IA » : prise pour une colocation ou une chambre (offer.ts : isColocationAd) |
| annonce « chambres-dans » visible | ❌ | perdue à l'étape « lecture sans IA » : prise pour une colocation ou une chambre (offer.ts : isColocationAd) |
| annonce « acceptee » visible | ✅ | visible |
| annonce « vraie-coloc » écartée | ✅ | perdue à l'étape « lecture sans IA » : prise pour une colocation ou une chambre (offer.ts : isColocationAd) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| possibilite | « possibilité de colocation » | 3 km | lecture sans IA | lecture sans IA |
| convient | « convient à 2 colocataires » | 2.2 km | lecture sans IA | lecture sans IA |
| ouvert | « ouvert à la colocation » | 0.8 km | lecture sans IA | lecture sans IA |
| chambres-dans | « deux chambres dans un appartement entièrement rénové » | 1.7 km | lecture sans IA | lecture sans IA |
| acceptee | « colocation acceptée » (déjà géré) | 3 km | visible | visible |
| vraie-coloc | une chambre en colocation | 2.2 km | lecture sans IA | lecture sans IA |

</details>

## Budget et surface

<a id="champs-manquants"></a>
### Annonce sans surface ou sans nombre de pièces (`champs-manquants`)

> T2 d'au moins 40 m² à Lille, 800 € maximum.

*Les fourchettes de pièces et de surface sont envoyées au site. Une annonce qui n'a pas rempli ces champs est probablement écartée par Le Bon Coin (hypothèse à vérifier : résultat « incertain »), alors que l'app, elle, la garderait.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–800 € · 40–… m² · 2–2 pièces · rayon 5 km · mots-clés « T2 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `2-2` · surface `40-max` · prix `min-800`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| minArea | ✅ | attendu 40, obtenu 40 |
| minRooms | ✅ | attendu 2, obtenu 2 |
| maxRooms | ✅ | attendu 2, obtenu 2 |
| annonce « sans-surface » visible | ❔ | perdue à l'étape « recherche Le Bon Coin » : square absent de l'annonce, filtre square=40-max (hypothèse : écartée) |
| annonce « sans-pieces » visible | ❔ | perdue à l'étape « recherche Le Bon Coin » : rooms absent de l'annonce, filtre rooms=2-2 (hypothèse : écartée) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| sans-surface | surface non renseignée (45 m² dans le texte) | 0.8 km | recherche Le Bon Coin | recherche Le Bon Coin |
| sans-pieces | pièces non renseignées (T2 dans le titre) | 3 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

## Type de bien, chambres, DPE

<a id="maison-type"></a>
### Une maison (correctif du 05/10) (`maison-type`)

> Je cherche une maison à louer à Lille, 1 300 € maximum.

*Témoin du correctif « type de bien ».*

- **Interprétation** (LLM : simulée) : lieu **Lille** · type house · …–1300 € · rayon 5 km · mots-clés « maison »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,5` · prix `min-1300`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| propertyType | ✅ | attendu "house", obtenu "house" |
| mot cherché (text=) | ✅ | attendu null, obtenu null |
| annonce « maison » visible | ✅ | visible |
| annonce « autre » visible | ✅ | visible |
| annonce « maison-de-ville » visible | ❌ | perdue à l'étape « recherche Le Bon Coin » : type 2 hors de real_estate_type=1,5 |
| annonce « appartement » écartée | ✅ | perdue à l'étape « recherche Le Bon Coin » : type 2 hors de real_estate_type=1,5 |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| maison | maison | 3 km | visible | visible |
| autre | rangée en « Autre » | 2.2 km | visible | visible |
| maison-de-ville | « Maison de ville » rangée en appartement | 0.8 km | recherche Le Bon Coin | recherche Le Bon Coin |
| appartement | un appartement | 1.7 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

<a id="chambres-dpe"></a>
### 3 chambres et DPE D minimum (correctif du 05/10) (`chambres-dpe`)

> Appartement 3 chambres à Lille, DPE D minimum, 1 400 € maximum.

*Témoin : chambres et DPE vérifiés sur les champs du site.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · type apartment · …–1400 € · ≥ 3 chambres · DPE ≤ D · rayon 5 km · mots-clés « appartement »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `2,5` · pièces `3-max` · prix `min-1400`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| minRooms | ✅ | attendu null, obtenu null |
| minBedrooms | ✅ | attendu 3, obtenu 3 |
| minEnergyClass | ✅ | attendu "D", obtenu "D" |
| mot cherché (text=) | ✅ | attendu null, obtenu null |
| annonce « 3ch-c » visible | ✅ | visible |
| annonce « 3ch-sans-dpe » visible | ✅ | visible |
| annonce « 2ch » écartée | ✅ | perdue à l'étape « lecture sans IA » : chambres ou DPE déclarés contraires (contradictsDeclared) |
| annonce « dpe-f » écartée | ✅ | perdue à l'étape « lecture sans IA » : chambres ou DPE déclarés contraires (contradictsDeclared) |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| 3ch-c | 3 chambres, DPE C | 3 km | visible | visible |
| 3ch-sans-dpe | 3 chambres, DPE non indiqué | 2.2 km | visible | visible |
| 2ch | 2 chambres déclarées | 3 km | lecture sans IA | lecture sans IA |
| dpe-f | DPE F | 0.8 km | lecture sans IA | lecture sans IA |

</details>

<a id="t1-ou-t2"></a>
### T1 ou T2 (`t1-ou-t2`)

> T1 ou T2 à Lille, 650 € maximum.

*Témoin : fourchette de pièces.*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–650 € · 1–2 pièces · rayon 5 km · mots-clés « T1 T2 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `1-2` · prix `min-650`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| minRooms | ✅ | attendu 1, obtenu 1 |
| maxRooms | ✅ | attendu 2, obtenu 2 |
| annonce « t1 » visible | ✅ | visible |
| annonce « t2 » visible | ✅ | visible |
| annonce « t3 » écartée | ✅ | perdue à l'étape « recherche Le Bon Coin » : 3 pièces hors de rooms=1-2 |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| t1 | T1 | 0.8 km | visible | visible |
| t2 | T2 | 3 km | visible | visible |
| t3 | T3 | 2.2 km | recherche Le Bon Coin | recherche Le Bon Coin |

</details>

## Interprétation

<a id="demande-chargee"></a>
### Plus de 8 souhaits : les derniers disparaissent (`demande-chargee`)

> Pour Strasbourg, je voudrais louer un appartement de 70 m² minimum pour 1 400 € au plus, avec parking, ascenseur, balcon, cave, fibre, animaux acceptés, peu de bruit, DPE C ou mieux, cuisine séparée, sans vis-à-vis et proche du tram.

*interpret() ne garde que 8 souhaits, sans prévenir : « sans vis-à-vis » et « proche du tram » sont perdus.*

- **Interprétation** (LLM : simulée) : lieu **Strasbourg** · type apartment · …–1400 € · 70–… m² · DPE ≤ C · rayon 5 km · mots-clés « appartement »
- **Souhaits** : « parking », « ascenseur », « balcon », « cave », « fibre », « animaux acceptés », « peu de bruit », « cuisine séparée »
- **Requête Le Bon Coin** : centre Strasbourg (48.5691, 7.7621), rayon **5 km** · type `2,5` · surface `70-max` · prix `min-1400` · **mot obligatoire `parking`**
- **Zone couverte** : 3 communes dont le centre est dans le cercle (Strasbourg, Schiltigheim, Ostwald)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Strasbourg", obtenu "Strasbourg" |
| minEnergyClass | ✅ | attendu "C", obtenu "C" |
| souhait /parking/ | ✅ | souhaits : ["parking","ascenseur","balcon","cave","fibre","animaux acceptés","peu de bruit","cuisine séparée"] |
| souhait /ascenseur/ | ✅ | souhaits : ["parking","ascenseur","balcon","cave","fibre","animaux acceptés","peu de bruit","cuisine séparée"] |
| souhait /vis-à-vis/ | ❌ | souhaits : ["parking","ascenseur","balcon","cave","fibre","animaux acceptés","peu de bruit","cuisine séparée"] |
| souhait /tram/ | ❌ | souhaits : ["parking","ascenseur","balcon","cave","fibre","animaux acceptés","peu de bruit","cuisine séparée"] |
| annonce « t3 » visible | ✅ | visible |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| t3 | T3 avec parking | 1.5 km | visible | visible |

</details>

## Analyse IA

<a id="ia-chambre"></a>
### Une phrase sur « chaque chambre » suffit à masquer un T3 (`ia-chambre`)

> T3 à Lille, 1 000 € maximum.

*La seule garde est que la citation existe dans le texte. Si l'IA se trompe en citant une vraie phrase, l'annonce est masquée sans recours (réponse d'IA simulée ici).*

- **Interprétation** (LLM : simulée) : lieu **Lille** · …–1000 € · 3–3 pièces · rayon 5 km · mots-clés « T3 »
- **Requête Le Bon Coin** : centre Lille (50.6311, 3.0468), rayon **5 km** · type `1,2` · pièces `3-3` · prix `min-1000`
- **Zone couverte** : 10 communes dont le centre est dans le cercle (Lille, Lambersart, Loos, La Madeleine, Mons-en-Barœul, Ronchin, Faches-Thumesnil, Saint-André-lez-Lille…)

| Contrôle | Résultat | Détail |
|---|---|---|
| location | ✅ | attendu "Lille", obtenu "Lille" |
| annonce « erreur-citee » visible | ❌ | perdue à l'étape « analyse IA » : masquée par l'analyse (room) : « Chaque chambre dispose d'un placard. » |
| annonce « erreur-inventee » visible | ✅ | visible |
| annonce « vraie-chambre » écartée | ✅ | perdue à l'étape « analyse IA » : masquée par l'analyse (room) : « Je loue une chambre dans mon T3, salle de bains partagée. » |

<details><summary>Annonces : distance au centre, veille quotidienne</summary>

| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |
|---|---|---|---|---|
| erreur-citee | IA : « room » en citant une vraie phrase | 0.8 km | analyse IA | analyse IA |
| erreur-inventee | IA : « room » avec une citation inventée (garde-fou) | 3 km | visible | visible |
| vraie-chambre | IA : chambre chez l'habitant, citation exacte | 2.2 km | analyse IA | analyse IA |

</details>

