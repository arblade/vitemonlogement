# Étude qualitative : Jev, gpt-5-mini, gpt-5.4-mini ; vérité gpt-5.5 — 2026-10-05

188 annonces réelles, 12 critères qualitatifs (Calme, Lumineux, Bon état, Vue dégagée, Cachet, Spacieux, Rangements, Bien situé, Économe en énergie, Adapté à un étudiant, Adapté à une famille, Standing). Oui / non / non précisé, d'après le texte seul ; mêmes définitions données aux quatre.

Précision = part des oui/non conformes à la vérité ; rappel = part des oui/non de la vérité retrouvés ; inventée = tranchée alors que la vérité dit « non précisé » ; contradiction = oui au lieu de non ou l'inverse.

## Tous critères

| Système | Tranchées | Précision | Rappel | Inventées | Contradictions | Accord total |
|---|---|---|---|---|---|---|
| Jev brut | 1161 | 85.4 % | 90.5 % | 152 | 18 | 88.7 % |
| Jev, confiance ≥ 0,85 | 808 | 98.3 % | 72.5 % | 14 | 0 | 86.0 % |
| Jev, confiance ≥ 0,95 | 737 | 99.3 % | 66.8 % | 5 | 0 | 83.7 % |
| gpt-5-mini (effort faible) | 1117 | 89.4 % | 91.2 % | 110 | 8 | 90.9 % |
| gpt-5.4-mini (effort faible) | 1143 | 87.4 % | 91.2 % | 129 | 15 | 90.0 % |

## Jev : effet du seuil de confiance

| Seuil | Tranchées | Précision | Rappel | Inventées | Contradictions | Accord total |
|---|---|---|---|---|---|---|
| 0 | 1161 | 85.4 % | 90.5 % | 152 | 18 | 88.7 % |
| 0.5 | 981 | 93.1 % | 83.4 % | 66 | 2 | 89.0 % |
| 0.7 | 877 | 96.7 % | 77.4 % | 29 | 0 | 87.8 % |
| 0.8 | 835 | 97.8 % | 74.6 % | 18 | 0 | 86.9 % |
| 0.85 | 808 | 98.3 % | 72.5 % | 14 | 0 | 86.0 % |
| 0.9 | 773 | 98.7 % | 69.7 % | 10 | 0 | 84.8 % |
| 0.95 | 737 | 99.3 % | 66.8 % | 5 | 0 | 83.7 % |
| 0.98 | 672 | 99.4 % | 61.0 % | 4 | 0 | 80.9 % |

## Par critère

Vérité : nombre de oui / non. Chaque cellule : précision (justes/tranchées) · rappel.

| Critère | Vérité oui/non | Jev ≥ 0,85 | gpt-5-mini | gpt-5.4-mini |
|---|---|---|---|---|
| Calme | 72 / 2 | 100.0 % (69/69) · 93.2 % | 97.3 % (72/74) · 97.3 % | 90.0 % (72/80) · 97.3 % |
| Lumineux | 103 / 0 | 100.0 % (98/98) · 95.1 % | 100.0 % (103/103) · 100.0 % | 99.0 % (102/103) · 99.0 % |
| Bon état | 83 / 1 | 100.0 % (76/76) · 90.5 % | 75.7 % (81/107) · 96.4 % | 95.2 % (79/83) · 94.0 % |
| Vue dégagée | 44 / 0 | 84.4 % (38/45) · 86.4 % | 81.5 % (44/54) · 100.0 % | 87.8 % (43/49) · 97.7 % |
| Cachet | 64 / 0 | 100.0 % (54/54) · 84.4 % | 87.1 % (61/70) · 95.3 % | 92.3 % (60/65) · 93.8 % |
| Spacieux | 78 / 8 | 97.1 % (33/34) · 38.4 % | 84.6 % (66/78) · 76.7 % | 51.0 % (73/143) · 84.9 % |
| Rangements | 110 / 0 | 100.0 % (72/72) · 65.5 % | 94.0 % (109/116) · 99.1 % | 91.6 % (109/119) · 99.1 % |
| Bien situé | 164 / 0 | 99.1 % (116/117) · 70.7 % | 99.4 % (163/164) · 99.4 % | 98.2 % (161/164) · 98.2 % |
| Économe en énergie | 54 / 19 | 97.2 % (35/36) · 47.9 % | 75.3 % (58/77) · 79.5 % | 74.6 % (53/71) · 72.6 % |
| Adapté à un étudiant | 76 / 10 | 96.1 % (49/51) · 57.0 % | 90.9 % (50/55) · 58.1 % | 89.8 % (53/59) · 61.6 % |
| Adapté à une famille | 46 / 132 | 98.5 % (135/137) · 75.8 % | 96.1 % (171/178) · 96.1 % | 97.1 % (169/174) · 94.9 % |
| Standing | 29 / 0 | 100.0 % (19/19) · 65.5 % | 51.2 % (21/41) · 72.4 % | 75.8 % (25/33) · 86.2 % |

## Coût et temps (12 questions par annonce)

| Système | Tokens entrée / sortie | Coût par annonce | Temps moyen |
|---|---|---|---|
| Jev (0,042 $/M) | 421907 / — | 0.000094 $ | 185 ms (p95 378 ms) |
| gpt-5-mini (0,25 / 2 $/M) | 239801 / 85291 | 0.001226 $ | 4951 ms (p95 7118 ms) |
| gpt-5.4-mini (0,75 / 4,5 $/M) | 239801 / 40491 | 0.001926 $ | 1655 ms (p95 2428 ms) |
| gpt-5.5 (vérité, 5 / 30 $/M) | 239801 / 38865 | 0.012580 $ | 2845 ms (p95 7589 ms) |

## Arbitrage : qui a raison ?

Sur le qualitatif, la « vérité » gpt-5.5 est plus discutable que sur le catalogue. Relu à la main : **les 14 réponses
de Jev (≥ 0,85) jugées fausses** (toutes), 14 erreurs de gpt-5-mini et 10 de gpt-5.4-mini tirées au hasard.

| | Le système avait raison | Ambigu | La vérité avait raison |
|---|---|---|---|
| Jev ≥ 0,85 (14) | 8 | 3 | 3 |
| gpt-5-mini (14) | 4 | 4 | 6 |
| gpt-5.4-mini (10) | 2 | 2 | 6 |

- **Les « erreurs » de Jev sont surtout des déductions justes que gpt-5.5 n'a pas osées** : « donnant sur cour » → pas
  de vue dégagée ; T2 à une chambre ou maison T4 de 109 m² → pas pour une famille, pas pour un étudiant (c'est la
  définition donnée) ; « petite surface » → pas spacieux. Vraies erreurs : ≈ 3 sur 808 réponses.
- **gpt-5-mini et gpt-5.4-mini inventent surtout sur « spacieux », « cachet » et « économe en énergie »** (« 28 m²,
  donc pas spacieux » pour un T1 bis ; « 191 kWh/m², donc pas économe » alors que c'est un DPE D, entre les deux).
- **La vérité elle-même se trompe sur l'énergie** : « économe » pour des DPE D, contraire à la définition (A à C).

## Conclusions

1. **Jev tient sur le qualitatif** : à 0,85, précision 98,3 % (≈ 99,5 % après arbitrage), **aucune contradiction**,
   rappel 72 %. gpt-5-mini : 89,4 % / 91 % ; gpt-5.4-mini : 87,4 % / 91 %. Jev est le plus sûr, les LLM trouvent plus.
   À 0,7 : 96,7 % / 77 %.
2. **Critères forts pour Jev** : calme, lumineux, bon état, cachet, rangements, bien situé, famille (précision
   97 à 100 %, rappel 65 à 95 %). **Plus faibles pour tous** : vue dégagée (84 à 88 %).
3. **À ne confier à aucun modèle** : « spacieux » et « économe en énergie » se calculent mieux qu'ils ne se lisent
   (surface rapportée au nombre de pièces ; lettre du DPE, champ Le Bon Coin `energy_rate` ou « DPE : D » dans le
   texte). Tous les modèles, vérité comprise, s'y trompent.
4. **gpt-5.4-mini n'apporte rien en lecture** : pas plus juste que gpt-5-mini sur le qualitatif, nettement pire sur
   le catalogue (593 « non » inventés sur 6 016 questions, contre 145), 50 % plus cher ; seulement plus rapide
   (≈ 2 s au lieu de 5 à 8 s). À évaluer plutôt sur le résumé, pas sur l'extraction.
5. **Coût et temps** pour 12 critères : Jev 0,00009 $ et 0,19 s par annonce ; gpt-5-mini 0,0012 $ et 5 s ;
   gpt-5.4-mini 0,0019 $ et 1,7 s.

**Organisation conseillée** : Jev lit **sur toutes les annonces** un catalogue générique (≈ 32 caractéristiques + ≈ 10
critères qualitatifs + type d'offre, ≈ 0,0003 $ et < 0,5 s) ; règles calculées pour surface et DPE ; **le LLM ne
reçoit que** le résumé, l'adresse, les critères libres de l'utilisateur hors catalogue, et les critères de
l'utilisateur que Jev laisse « non précisé » ou sous le seuil (pour garder le rappel là où il compte).

Limites : vérité posée par gpt-5.5 et contestable sur le subjectif (arbitrage sur un échantillon) ; définitions
données aux modèles = celles du rapport (elles orientent les réponses) ; le texte seul, sans les photos.
