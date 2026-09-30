# Alerte mail

**Statut :** étude terminée, rien de codé. Doc complet : « Étude – Alerte mail ».
**Source :** conversation « Alerte mail pour nouveaux logements » (30/09/2026)

## Demande
Envoyer automatiquement un mail à l'utilisateur avec les nouveaux logements qu'il n'a pas encore vus, sous forme de résumé succinct avec un lien pour basculer sur l'application.

## Conclusion de l'étude
Réalisable en 3 à 4 jours, sans nouveau service : le worker actuel relance la recherche, une table mémorise les annonces déjà signalées, et un mail de 5 annonces maximum renvoie vers `/searches/:id`.

## Ce qui existe déjà
- Relance d'une recherche (`beginRefresh`) : réutilisée telle quelle.
- Worker serveur (boucle de 3 s, verrous par bail en base) : on y ajoute un déclencheur « alertes dues ».
- Cache d'analyses `listing_analyses` : une alerte ne paie le LLM que pour les annonces nouvelles.
- Page `/searches/:id` : sert de lien de retour.

## Ce qui manque
- Détection des nouveautés (pas de date d'apparition des annonces).
- Identité utilisateur / e-mail, planification, envoi de mail, quotas d'alertes.

## Parcours
1. Bouton « Recevoir une alerte mail » sur une recherche terminée : e-mail + fréquence (quotidienne par défaut, hebdomadaire en option).
2. Mail de confirmation (double opt-in) avec lien signé.
3. À chaque cycle, mail uniquement s'il y a au moins une nouveauté (5 annonces max).
4. Désinscription en un clic et gestion de l'alerte depuis chaque mail.

## Modèle de données
- `mail_alerts` : recherche, e-mail, fréquence, statut, jeton haché, `next_run_at`, verrou, compteurs d'échecs.
- `alert_deliveries` : clé (alerte, annonce) pour ne jamais notifier deux fois.

## Fournisseur d'e-mail
Resend recommandé (offre gratuite : 3 000 mails/mois, 100/jour). Le SMTP direct est possible sur Render payant (le blocage ne touche que les services gratuits). Brevo, Postmark et SES non vérifiés. Prérequis hors code : un domaine d'envoi avec SPF et DKIM.

## Risques
- **Coût Apify :** jusqu'à environ 6 $/mois par alerte quotidienne (0,10 $ par run, 2 runs max par cycle). Maximum déduit de la configuration, pas mesuré.
- Création d'alertes en masse, envoi à une adresse tierce, RGPD, doublons : parades listées dans le doc.

## Plan en 4 étapes
1. Socle : migration, `sendMail`, gabarits, jetons signés.
2. API : routes création/lecture/suppression, confirmation, désinscription, quotas.
3. Cycle : verrou d'alerte, déclencheur worker, détection, envoi avec reprise.
4. Interface : bouton, formulaire, état de l'alerte, mise en avant des nouveautés (`?new=1`).

## Questions ouvertes
- Domaine d'envoi disponible ?
- Fréquence : quotidienne seule ou aussi hebdomadaire ?
- Une alerte par recherche et par adresse, ou regroupement ?
- Inclure la phase élargie ou seulement la ciblée ?
- Plafond d'alertes actives (proposition : 10).

## Sources
- [Tarifs Resend](https://resend.com/pricing.md)
- [Render : ports SMTP bloqués pour les services gratuits](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports)
