# Critères de trajet (temps de transport / voiture)

**Statut :** premier pas codé avec la carte (voir [carte-des-logements](carte-des-logements.md)) : lieux de vie extraits de la demande et géocodés, temps + tracé Google Routes par annonce dans la fiche, actifs dès que `GOOGLE_MAPS_API_KEY` est posée. Pas encore de filtre « moins de N minutes » ni de matrice par recherche.
**Source :** conversation « Feature géographique pour logement » (30/09/2026)

## Demande
Permettre des critères du type « je travaille à telle adresse, je veux un logement à moins de 30 min en transport » ou « à moins d'une heure en voiture », avec un coût minimal et une implémentation simple.

## Conclusion
Faisable, simple et quasi gratuit à ce volume. Le worker ne garde que 5 à 10 annonces par recherche : **une requête matrice par recherche** suffit (N annonces vers l'adresse de travail), sans isochrones pour la v1.

## Comparatif des API

| API | Transport | Voiture | Coût / limites | Verdict |
|---|---|---|---|---|
| Google Routes (Compute Route Matrix) | Oui | Oui | 10 000 éléments gratuits/mois puis 5 $/1000 (Essentials) ; matrice transport limitée à 100 éléments | **Recommandé v1** |
| OpenRouteService | Non | Oui (OSM) | 500 matrices/jour, 500 isochrones/jour gratuits | Repli voiture / phase 2 |
| TravelTime | Oui | Oui | Gratuit pour dev/test seulement, licence payante en commercial | Frein « non commercial » |
| Navitia | Oui | Non | 5 000 requêtes/mois, dont 500 isochrones | Limité |
| Transitous (MOTIS) | Oui | Non | Gratuit mais bénévole, pas pour la production | Écarté |
| Geoapify | Partiel | Oui | Isochrone limité à 15 min en gratuit | Écarté |
| Google Isochrones | Non | Oui | 10 000 gratuits puis 5 $/1000 | Écarté |

Estimation Google : environ 10 éléments par recherche, soit environ 1 000 recherches/mois avant de payer.

## Choix de conception
- Direction annonces → travail, avec heure d'arrivée fixe (mardi 9 h) pour des résultats reproductibles.
- Géocodage de l'adresse de travail : Géoplateforme IGN (`data.geopf.fr/geocodage`), gratuit et sans clé (l'ancienne URL `api-adresse.data.gouv.fr` est décommissionnée depuis fin janvier 2026).
- ORS : l'ancienne URL `api.openrouteservice.org` est coupée depuis le 24/08/2026 ; utiliser `api.heigit.org/openrouteservice/...`.
- Interface `TravelTimeProvider` (origine, destinations, mode → minutes) : Google en premier, ORS pour la voiture ensuite.

## Intégration dans l'appli
- `HousingCriteria` gagne `commutes: [{address, lat, lon, mode, maxMinutes}]` ; le prompt de `ai.ts` extrait « je travaille au 12 rue X, moins de 30 min en transport ».
- Module `commute.ts` appelé dans `apify.ts`, après `normalize` et avant l'analyse LLM (sans LLM).
- Résultat : un `criterionResult` (`commute-1`, confirmé/contredit, « 27 min », preuve « trajet Google, transport, arrivée mardi 9 h »), déjà affiché par le détail d'annonce.
- Front : champ adresse avec autocomplétion, mode, minutes, badge sur les cartes.
- Cache : table `travel_times` (origine, commune de destination, mode, créneau), distincte du cache LLM.
- Quotas : géocodage (1 à 2 requêtes) et 1 matrice par recherche comptés dans `quota.ts`.

## Limite principale
Les annonces n'ont qu'un nom de ville (pas de coordonnées en base). Utiliser les coordonnées Apify si elles existent, sinon le centre de la commune (voir [base-de-villes](base-de-villes.md)). Erreur de quelques km, plus marquée à Paris, Lyon, Marseille : un résultat à ±5 min du seuil est traité comme « incertain ».

## Phase 2
Utiliser un isochrone ORS pour choisir la **zone de recherche** (communes dont le centre est dans le polygone), à la place de « ville + rayon », ce qui améliore la pertinence avec la limite de 5 résultats Apify.

## Non vérifié
- SKU Google pour le transport (Essentials ou Pro).
- Conditions d'usage Google.
- Présence de coordonnées dans les annonces Le Bon Coin via Apify (à voir sur un vrai run).

## Sources
- [ORS : plans et quotas](https://openrouteservice.org/plans/)
- [ORS : changement d'URL](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912)
- [Google Routes : tarifs](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Routes : limites de la matrice](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix)
- [Google Isochrones : facturation](https://developers.google.com/maps/documentation/isochrones/usage-and-billing)
- [Navitia : conditions](https://navitia.io/en/?p=1571)
- [TravelTime : tarifs](https://traveltime.com/analytics/api-pricing)
- [TravelTime : limites](https://docs.traveltime.com/api/overview/usage-limits)
- [Transitous : politique d'usage](https://glama.ai/mcp/servers/Movm/transitous-mcp)
- [Geoapify : tarifs](https://geoapify.com/pricing)
- [API Adresse transférée à l'IGN](https://www.data.gouv.fr/fr/posts/lapi-adresse-de-la-base-adresse-nationale-est-transferee-a-lign-10/)
