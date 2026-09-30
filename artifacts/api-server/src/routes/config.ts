import { Router, type IRouter } from "express";
import { RESULT_LIMIT } from "./housing/apify";

const router: IRouter = Router();

// Réglages utiles à l'affichage : le front ne recopie plus les limites du serveur.
router.get("/config", (_req, res) => {
  res.json({ resultsPerCall: RESULT_LIMIT });
});

export default router;
