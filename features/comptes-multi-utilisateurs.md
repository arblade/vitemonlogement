# Comptes multi-utilisateurs

**Statut :** plan proposé, en attente de décisions et de l'accès en écriture au dépôt. Rien de codé.
**Source :** conversation « Multi-user login feature » (30/09/2026)

## Demande
Plusieurs utilisateurs avec page de connexion (e-mail + mot de passe avec confirmation), stockés proprement en base, chacun avec son compte et ses recherches. Confirmation d'e-mail explicitement retirée. Objectif : plans rapides, demandant le moins d'actions possible à l'utilisateur.

## État actuel
- Un seul mot de passe partagé (`APP_PASSWORD`) ; le cookie de session signé contient un `visitorId` aléatoire, déjà utilisé pour le quota.
- `housing_searches` n'a aucune notion de propriétaire : toutes les recherches sont visibles par tous.
- Favoris dans le `localStorage` (liés à l'appareil).
- `SESSION_SECRET` non défini sur Render : le secret de signature retombe sur `APP_PASSWORD`.

## Plan A : comptes maison (recommandé)
- Table `users` : id, e-mail (minuscules, index unique), hash du mot de passe, date de création.
- Mot de passe haché avec `scrypt` (`node:crypto`), sel par utilisateur, comparaison à durée constante, 8 caractères minimum, confirmation vérifiée côté front et serveur.
- Routes `/api/auth/register`, `login`, `logout`, `me` ; cookie httpOnly avec `userId` ; erreurs génériques ; rate limit par IP et par e-mail.
- Colonne `owner_id` sur `housing_searches` (migration Drizzle) ; toutes les routes filtrent par utilisateur, une recherche d'un autre compte renvoie 404.
- Quota par cookie remplacé par quota par utilisateur.
- Front : `auth-gate.tsx` devient une page connexion / inscription.
- Tests mis à jour et cas d'isolation entre deux utilisateurs ajoutés.
- À faire côté utilisateur : ajouter `SESSION_SECRET` sur Render, relire et fusionner.

## Plan B : Better Auth
Mêmes comptes via une bibliothèque, avec réinitialisation de mot de passe ou Google possibles plus tard. Plus long, plus de surface à maintenir, peu de gain tant que seuls e-mail et mot de passe sont nécessaires.

## Plan C : service géré (Clerk, Auth0…)
Le plus rapide côté code, mais compte, clés et domaines à créer, utilisateurs chez un tiers, service potentiellement payant. Contredit l'objectif de peu d'actions côté utilisateur.

## Points à décider
1. **Inscription libre ou sur invitation ?** Sans vérification d'e-mail, n'importe qui peut créer des comptes, et le plafond global de 300 requêtes/jour est le seul garde-fou. Proposition : exiger l'ancien `APP_PASSWORD` comme code d'invitation.
2. **Mot de passe oublié :** sans e-mail, pas de récupération ; réinitialisation manuelle en base, ou ajout d'un e-mail plus tard.
3. **Recherches existantes :** rattachées au premier compte créé, ou laissées orphelines.
4. **Favoris :** restent dans le navigateur, ou passent en base par compte.

Réponse par défaut proposée : code d'invitation obligatoire + rattachement des recherches existantes au premier compte.

## Blocage
Pas d'accès en écriture au dépôt depuis la session concernée.
