# Banc d'essai de la pipeline de recherche

Fait passer des demandes de logement par la vraie pipeline, étape par étape, et dit pour chaque annonce si elle est
montrée, ou à quelle étape et pourquoi elle est perdue. Étude et conclusions : `reports/etude-pipeline-recherche-2026-10-08.md`.

```
demande ──► interpret() ──► actorRequest() ──► [Le Bon Coin] ──► 15 plus récentes ──► normalize() + filtres ──► analyze() ──► visible
             (LLM rejoué)    (URL décodée)      (modèle)          (modèle)             (code réel)                (IA simulée)
```

## Lancer

```sh
pnpm --filter @workspace/api-server bench:pipeline                      # aucun appel payant ; rapport dans reports/banc-pipeline-<date>.md
pnpm --filter @workspace/api-server bench:pipeline -- --cas paris-rayon # un ou plusieurs cas (séparés par des virgules)
pnpm --filter @workspace/api-server bench:pipeline -- --maj-reference   # après une amélioration : nouvelle référence
pnpm --filter @workspace/api-server bench:pipeline:live                 # PAYANT (≈ 0,03 $), sur demande explicite : vrai gpt-5-mini
```

`pnpm test` lance `pipeline-bench.test.ts` : **aucun contrôle qui passait dans `baseline.json` ne doit régresser**. Après
une amélioration, relancer avec `--maj-reference` et committer `baseline.json` : les contrôles passés de ❌ à ✅ y
sont alors protégés.

## Ce qui est réel, ce qui est modélisé

| Étape | Réel ou modèle |
|---|---|
| Interprétation | Code réel (`interpret()` et son post-traitement). La réponse du LLM est **rejouée** : simulée (écrite pour le banc), « robustesse » (sortie volontairement imparfaite), ou relevée pour de vrai avec `--live` (`enregistrements.json`, rejouée ensuite sans frais). |
| Requête | Code réel (`actorRequest()`), URL décodée : centre, rayon, communes couvertes, type, fourchettes, mot obligatoire. |
| Recherche Le Bon Coin | **Modèle** : cercle autour du centre, `real_estate_type`, fourchettes `rooms` / `square` / `price` (annonce sans la valeur supposée écartée : « ❔ »), mot `text=` cherché en début de mot dans titre + description. Acteur de secours (ville non reconnue) : zone inconnue, « ❔ ». |
| Profondeur | **Modèle** : chaque annonce porte son rang estimé dans la liste du site (`rank`) et son âge (`ageDays`). Recherche ponctuelle : 15 premières. Veille : 4 jours, 105 annonces au plus. |
| Lecture sans IA | Code réel (`normalize()`, demandes, colocations, type de bien, bornes, chambres et DPE déclarés). |
| Analyse IA | Code réel (`analyze()`, `setAsideReason()`), réponse de l'IA **simulée** par annonce (`analysis`, défaut : logement entier). |

## Ajouter un cas

Dans `cases.ts` : la demande, la réponse du LLM (`simulated({...})`), les attendus d'interprétation (`expect`), et des
annonces `visible(...)` / `setAside(...)` avec de vraies coordonnées. Les attendus décrivent le comportement
**souhaité** : un nouveau cas peut échouer. Puis `--maj-reference`.

Un retour utilisateur (« telle annonce n'est pas remontée ») devient un cas : sa demande telle qu'écrite, l'annonce
(titre, description, prix, surface, pièces, type, position, âge) et `expected: "visible"`.
