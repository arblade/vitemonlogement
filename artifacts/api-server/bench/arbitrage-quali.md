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
