# Alerte mail

**Statut : implémenté le 02/10/2026 sur `develop`, actif dès que `RESEND_API_KEY` est posée sur Render.**
Étude initiale : 30/09/2026 (voir plus bas, « Étude d'origine »).

## Ce qui est fait
Les e-mails accompagnent la **veille quotidienne** (une par compte, voir [suivi-quotidien.md](suivi-quotidien.md)).
Il n'y a pas de case à cocher : créer une veille quotidienne suffit, et la fenêtre « Créer une veille quotidienne »
le dit (« Un e-mail vous est envoyé à *adresse d'inscription* à chaque relève qui trouve de nouveaux logements »).

| E-mail | Quand | Contenu |
|---|---|---|
| **Récapitulatif de relève** | après **chaque relève** (8 h, 18 h…) qui trouve **au moins une** nouvelle annonce ; rien sinon | « 3 nouveaux logements à Lille », heure de la relève, **5 annonces au plus** (photo, loyer, surface, pièces, lieu, résumé de l'IA ; analysées d'abord, dans l'ordre du site), « Et N autres », bouton « Voir les N nouveautés » vers la recherche ; avertissement si la relève est « partielle » |
| **Veille en pause** | quand la veille se met en pause (7 jours sans visite) | bouton « Reprendre ma veille » |
| **Mot de passe oublié** (03/10) | à la demande, depuis l'écran de connexion (un toutes les 5 min au plus par compte) | lien « Choisir un nouveau mot de passe », valable 1 heure, à usage unique ; envoyé même si le compte s'est désinscrit des e-mails de veille ; plus envoyé après 30 min en file |
| **Alerte d'exploitation** | 3 relèves d'affilée en échec sur une veille (une fois par série) | à `ALERT_EMAIL` seulement, si elle est posée |

- **Pas de seuil de score** (conformément à la réserve ci-dessous) : toutes les nouvelles annonces comptent.
- **Désinscription** : lien « Ne plus recevoir ces e-mails » dans chaque e-mail, plus les en-têtes `List-Unsubscribe`
  (désinscription en un clic de Gmail et Yahoo, exigée pour ne pas finir en spam). Lien signé (`SESSION_SECRET`), utilisable
  sans être connecté ; ouvrir le lien affiche un bouton, rien ne change tant qu'on ne l'a pas touché (un antivirus qui
  visite le lien ne désinscrit personne). La veille continue (pastille du site). Sur la page de la veille : « E-mails
  désactivés · Réactiver les e-mails ».
- **Jamais deux fois** : file d'envoi en base (`mail_outbox`) avec une clé unique par e-mail (`watch:<recherche>:<heure de
  relève>`), reprise jusqu'à 5 fois (1 min, 5 min, 30 min, 2 h) en cas d'erreur Resend, même clé envoyée à Resend comme clé
  d'idempotence. Un récapitulatif qui n'a pas pu partir en 10 h est abandonné (le suivant prend le relais).
- **Composé au moment de l'envoi** (après l'analyse de la relève) : une veille arrêtée, un compte désinscrit, une annonce
  masquée par l'IA entre-temps ne partent pas.
- **Sans clé Resend**, rien ne part : l'e-mail est noté dans les journaux (« E-mail not sent: RESEND_API_KEY is not set »)
  et marqué « non envoyé » dans la file. Le site fonctionne pareil.

## Mise en service (à faire une fois)
1. Créer le compte Resend, puis **Domains → Add domain** : `vitemonlogement.fr`, région **EU (Ireland)**.
2. Chez le registraire du domaine, ajouter les enregistrements DNS affichés par Resend : **MX** et **TXT (SPF)** sur le
   sous-domaine `send`, **TXT (DKIM)** sur `resend._domainkey`. Conseillé : un **TXT DMARC** sur `_dmarc` avec
   `v=DMARC1; p=none;`. Ils ne touchent ni le site ni une éventuelle messagerie du domaine. Attendre « Verified ».
3. **API Keys → Create** : permission « Sending access », limitée au domaine. La coller dans Render
   (service `vitemonlogement` → Environment) sous le nom **`RESEND_API_KEY`**. Render redéploie.
4. Facultatif : `ALERT_EMAIL` (votre adresse, pour les alertes d'exploitation) ; `MAIL_FROM` pour changer l'expéditeur
   (par défaut `Vite mon logement <alertes@vitemonlogement.fr>`) ; `MAIL_REPLY_TO`.
5. Liens des e-mails : par défaut l'adresse `onrender.com` du service (Render la fournit, `RENDER_EXTERNAL_URL`). Quand le
   domaine pointera sur Render, poser `PUBLIC_URL=https://vitemonlogement.fr`.
6. Essai : `pnpm --filter @workspace/api-server mail:test vous@exemple.fr` (avec la clé dans l'environnement) envoie un
   récapitulatif d'exemple. `mail:test --preview <dossier>` écrit les e-mails en HTML sans rien envoyer.

Offre gratuite Resend : 3 000 e-mails par mois, 100 par jour, soit ≈ 45 comptes à 2 relèves fructueuses par jour.

## Technique
- `artifacts/api-server/src/lib/mail.ts` : envoi (API REST Resend, sans dépendance), `publicOrigin()`.
- `lib/mail-templates.ts` : gabarits HTML (tableaux, styles en ligne, 560 px) et texte ; page de désinscription.
- `lib/mail-outbox.ts` : file, composition, envoi par le worker (après le travail sur les recherches, à chaque tour),
  ménage à 30 jours. `routes/mail.ts` : désinscription (`GET`/`POST /api/mail/unsubscribe`), `PUT /api/mail/preferences`.
- Base : migration `0009_mails_et_releves` (table `mail_outbox`, `users.mail_opt_out_at`), vérifiée sur PGlite et sur un
  vrai Postgres (base existante en 0008 avec une veille, puis 0009).
- Tests : `suivi.test.ts` (faux Resend : récapitulatif, rien sans nouveauté, désinscrit, panne puis reprise avec la même
  clé, sans clé, pause, alerte), `routes/mail.test.ts` (désinscription, lien falsifié, réactivation, gabarits),
  front (fenêtre, ligne de la veille, réactivation), navigateur mobile puis desktop (fenêtre, e-mails coupés puis
  réactivés, page de désinscription).
- Captures : `maquettes/mail-*.png`.

## Étude d'origine (30/09/2026)
Réalisable sans nouveau service : le worker relance la recherche, une table mémorise les annonces déjà signalées.
Resend retenu (offre gratuite 3 000 e-mails par mois) ; le SMTP direct est possible sur Render payant.
La détection des nouveautés, la planification et l'identité utilisateur sont venues avec la veille quotidienne et les
comptes ; le double opt-in n'a pas été retenu (comptes sur invitation, e-mail lié à la veille que l'on crée soi-même).

## Piste de réflexion : sélection des annonces envoyées (backlog, 30/09/2026)

> **⚠️ Simple étape de réflexion, non décidée.** Si l'alerte mail est implémentée, elle **ne doit pas** intégrer le seuil de score, la règle « pas de mail si rien ne passe » ni les autres règles de cette section. Ces points sont à rediscuter avant toute implémentation.

Échange sur la qualité des mails quotidiens (un envoi chaque matin vers 8 h, 5 annonces au maximum).

**Règle anti-doublon (seule règle retenue sans débat)** : on ne regarde qu'une chose, « cette annonce a-t-elle déjà été envoyée par mail ? ». On ne tient compte ni des clics, ni des likes, ni du fait que l'utilisateur l'ait vue ou non. C'est ce que fait déjà la table `alert_deliveries` ci-dessus.

**Idée explorée : ne pas envoyer d'annonces moyennes**
- Un seuil fixe d'environ **75 %** de correspondance aux critères, non réglable par l'utilisateur en MVP.
- Au-dessus du seuil : les 5 meilleures. Celles qui dépassent le seuil sans être retenues ne sont pas marquées envoyées et restent candidates pour le lendemain.
- Moins de 5 annonces au-dessus du seuil : on n'envoie que celles-là, sans compléter.
- Aucune annonce au-dessus du seuil : pas de mail ce jour-là.
- Une variante avec un « plancher » plus bas (55-60 %) pour compléter jusqu'à 5 a été proposée puis écartée : elle réintroduit les annonces médiocres que l'on veut éviter.

**Garde-fous évoqués**
- Critères éliminatoires (budget, ville, surface minimale) appliqués **avant** le score, pour qu'un 75 % ne soit pas hors budget ; le pourcentage ne porte que sur les critères souples.
- Ignorer les annonces publiées depuis plus de quelques jours (ex. 7), souvent déjà louées.
- Objet du mail avec le nombre réel d'annonces (« 3 nouveaux logements »), pas un nombre fixe.

**Risques et points ouverts**
- Seuil trop strict : certains utilisateurs ne recevraient presque jamais de mail et croiraient l'outil cassé. Seuil à garder dans une constante facile à changer, et à calibrer en regardant combien de mails partent réellement.
- Niveau de seuil (75 %), délai de péremption (7 jours) et répartition éliminatoire / souple : tous à valider.
- À croiser avec le suivi des favoris : [suivi-des-favoris.md](suivi-des-favoris.md).

## Sources
- [Tarifs Resend](https://resend.com/pricing.md)
- [Render : ports SMTP bloqués pour les services gratuits](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports)
