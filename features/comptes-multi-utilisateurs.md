# Comptes multi-utilisateurs

**Statut :** implémenté le 30/09/2026 sur `develop` (plan A, avec les décisions ci-dessous).

## Décisions prises
1. **Inscription sur invitation :** `APP_PASSWORD` devient le code d'invitation. Lien à partager : `https://<site>/?invite=<APP_PASSWORD>` ; si le code est valide, l'écran propose de créer un compte (e-mail, mot de passe, confirmation). Sans lien valide, seul l'écran de connexion apparaît.
2. **Mot de passe oublié :** réinitialisation manuelle, pas de récupération par e-mail : `DATABASE_URL=... pnpm --filter @workspace/api-server run user:reset-password <email> <nouveau-mot-de-passe>`.
3. **Recherches existantes :** rattachées au **premier compte créé** (celui du développeur). Elles ont `owner_id` NULL jusqu'à cette première inscription.
4. **Favoris :** en base (table `favorites`), liés à l'utilisateur. Les favoris déjà mémorisés dans un navigateur sont repris automatiquement dans le compte à la première connexion.

## Implémenté
- Tables `users` (e-mail unique en minuscules, mot de passe haché `scrypt` avec sel) et `favorites` ; colonne `housing_searches.owner_id` (migration Drizzle `0001`, appliquée au démarrage).
- Routes `/api/auth/register`, `login`, `logout`, `me`, `invite` ; cookie de session httpOnly portant l'identifiant du compte.
- Toutes les routes de recherche filtrent par propriétaire : la recherche d'un autre compte répond **404**.
- Quota par utilisateur (à la place du quota par cookie) ; freinage par IP de la recherche du code d'invitation et des mots de passe (10 essais / 15 min) ; erreur de connexion identique que l'e-mail existe ou non.
- Front : écran de connexion / inscription, bouton « Se déconnecter » (menu mobile et barre desktop), favoris synchronisés avec le serveur.
- Routes favoris : `GET/PUT/DELETE /api/favorites`, `POST /api/favorites/import`.

## À faire au déploiement
1. Ajouter `SESSION_SECRET` sur Render (sinon il retombe sur `APP_PASSWORD`).
2. **Créer son propre compte en premier** (le premier compte adopte les anciennes recherches), puis partager le lien d'invitation.
3. Les anciennes sessions (cookie sans compte) sont invalides : tout le monde doit se reconnecter.

## Limites connues
- Le code d'invitation est dans l'URL : il reste dans l'historique du navigateur et peut apparaître dans des journaux ; changer `APP_PASSWORD` invalide les anciens liens (les comptes existants ne sont pas touchés).
- Pas de suppression de compte, ni de changement de mot de passe depuis l'application.
- Les annonces « consultées » restent dans le navigateur (seuls les favoris sont en base).
