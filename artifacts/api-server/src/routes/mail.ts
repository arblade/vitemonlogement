import { Router, type IRouter } from "express";
import { setMailOptOut, validUnsubscribe } from "../lib/mail-outbox";
import { unsubscribePage } from "../lib/mail-templates";

/**
 * Désinscription des e-mails, sans connexion (le lien est signé). GET affiche un bouton (un antivirus qui « visite » le
 * lien ne désinscrit personne) ; POST désinscrit : c'est aussi la désinscription en un clic des messageries (RFC 8058).
 */
export const unsubscribeRouter: IRouter = Router();

unsubscribeRouter.get("/mail/unsubscribe", (req, res) => {
  const valid = validUnsubscribe(req.query.u, req.query.t);
  res.status(valid ? 200 : 400).type("html").set("Cache-Control", "no-store")
    .send(unsubscribePage(valid ? "confirm" : "invalid", req.originalUrl));
});

unsubscribeRouter.post("/mail/unsubscribe", async (req, res) => {
  if (!validUnsubscribe(req.query.u, req.query.t)) { res.status(400).type("html").send(unsubscribePage("invalid")); return; }
  await setMailOptOut(Number(req.query.u), true);
  res.type("html").set("Cache-Control", "no-store").send(unsubscribePage("done"));
});

/** Le compte connecté réactive (ou coupe) les e-mails de sa veille quotidienne. */
export const mailPreferencesRouter: IRouter = Router();

mailPreferencesRouter.put("/mail/preferences", async (req, res): Promise<void> => {
  const alerts = (req.body as { alerts?: unknown } | undefined)?.alerts;
  if (typeof alerts !== "boolean") { res.status(400).json({ error: "Requête invalide." }); return; }
  await setMailOptOut(req.userId!, !alerts);
  res.json({ mailAlerts: alerts });
});
