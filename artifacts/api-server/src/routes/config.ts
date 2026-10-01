import { Router, type IRouter } from "express";
import { liveDays } from "./housing/reader";

const router: IRouter = Router();

// Réglages utiles à l'affichage : le front ne recopie plus les limites du serveur.
router.get("/config", (_req, res) => {
  res.json({ liveDays: liveDays() });
});

export default router;
