## Arbitrage : qui a raison quand ils ne sont pas d'accord ?

La vérité gpt-5.5 n'est pas infaillible. J'ai relu à la main les désaccords : **les 15 erreurs de Jev en production**
(toutes) et **25 erreurs de gpt-5-mini** tirées au hasard (sur 164).

| | Le système avait raison | Ambigu | La vérité avait raison |
|---|---|---|---|
| Jev en production (15) | 5 (toutes « charges comprises ») | 2 | 8 |
| gpt-5-mini (25) | 5 (dont 4 « charges comprises ») | 4 | 16 |

- **« Charges comprises » est une question ambiguë**, pas une erreur des petits modèles : pour « 645 € HC + 55 € de
  charges, soit 700 € », gpt-5.5 répond « oui » (le total les comprend), Jev et gpt-5-mini « non » (le loyer ne les
  comprend pas). Jev et mini sont d'accord entre eux. À reformuler (« le prix affiché inclut-il les charges ? ») ou à
  laisser au champ Le Bon Coin.
- **Vraies erreurs de Jev** (≈ 8 à 10 sur 1 086 réponses tranchées, ≈ 1 %) : lecture littérale (« quadruple » ou
  « triple vitrage » ≠ double vitrage ; « lit mezzanine » = duplex ; « espace pour un lave-linge » ou « buanderie » =
  lave-linge fourni ; « vue sur le jardin » = jardin).
- **Vraies erreurs de gpt-5-mini** (≈ 2/3 des 164, soit ≈ 6 % des 1 741 réponses tranchées) : surtout des **« non »
  déduits d'une absence** (« pas de baignoire », « pas de balcon », « pas au dernier étage » quand le texte n'en dit
  rien), exactement ce que l'app interdit (« une absence n'est jamais un non ») ; puis des « oui » trop larges
  (« cuisine aménagée » = équipée, « colocation possible » sans le dire).

## Conclusions

1. **Type d'offre** (logement entier / chambre / non habitable) : Jev = gpt-5-mini = 99,5 %, toutes les chambres
   repérées, une seule erreur commune. **Jev peut le remplacer.**
2. **Caractéristiques du catalogue, avec les garde-fous** : Jev en production est **le plus fiable** (98,6 % de
   précision brute, ≈ 99 % après arbitrage, 7 réponses inventées sur 6 016 questions contre 145 pour gpt-5-mini). Son
   défaut est le **rappel** (65 % : il se tait souvent), dû au filtre mot-clé trop étroit (baignoire 19 %,
   rez-de-chaussée 10 %, dernier étage 37 %, transports 54 %).
3. **Sans garde-fou, Jev invente** (balcon, terrasse, duplex, dernier étage : précision 50 à 60 %). Le seuil de
   confiance règle presque tout (0,85 → 97 %) ; le mot-clé reste utile sur quelques sujets.
4. **Réglage proposé** : mot-clé seulement sur 8 sujets à risque (balcon, terrasse, jardin, duplex, dernier étage,
   colocation, charges, parking), seuil 0,85 ailleurs → **précision 98,6 %, rappel 79 %** (au lieu de 65 %), 11
   inventions. Attention : liste choisie sur ces mêmes données, à confirmer sur un nouveau lot.
5. **gpt-5.4-mini (ajouté le 05/10)** n'est pas une meilleure option pour l'extraction : précision 72 %, 593 réponses
   inventées (surtout des « non » déduits d'une absence), contre 145 pour gpt-5-mini ; plus rapide (2,2 s), plus cher
   (0,0029 $ par annonce).
6. **Coût et vitesse** : Jev ≈ 0,00016 $ par annonce pour 33 questions (≈ 12 fois moins que gpt-5-mini sur la même
   tâche, ≈ 0,0019 $) et **0,16 s au lieu de 8 s**.
7. **Champs Le Bon Coin** : quand le texte tranche aussi, accord 93 % ; ils apportent 321 informations absentes du
   texte. Ils restent l'étage 1 (gratuit), avec la règle actuelle « seul un oui fait foi ».
8. **Ce que Jev ne fait pas** (inchangé) : résumé, adresse, critères libres (« calme », « proche de mon travail ») :
   le LLM les garde.

**Verdict : Jev est utilisable pour le type d'offre et le catalogue de caractéristiques**, avec seuil 0,85 et le
filtre mot-clé (élargi ou limité aux sujets à risque). Il y est plus sûr que gpt-5-mini (beaucoup moins d'inventions),
bien plus rapide et moins cher ; il dit plus souvent « non précisé ». Le LLM garde ce qui demande du texte.

Limites : vérité posée par un LLM (corrigée à la main sur un échantillon seulement) ; Le Bon Coin surtout (155/188),
descriptions des échantillons PAP/SeLoger coupées à 600 caractères ; gpt-5-mini interrogé ici sur les 33 questions
fixes, alors qu'en production il lit les critères de l'utilisateur et 6 caractéristiques libres.
