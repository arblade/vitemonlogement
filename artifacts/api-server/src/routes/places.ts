import { Router, type IRouter } from "express";
import { suggestPlaces } from "../lib/places";

const router: IRouter = Router();

// Autocomplétion de ville (lecture seule, locale : aucun appel IA ni Apify, donc pas de quota coûteux).
router.get("/places/suggest", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : "";
  const limit = Math.min(20, Math.max(1, Number.parseInt(String(req.query.limit ?? "8"), 10) || 8));
  res.json(suggestPlaces(q, limit));
});

export default router;
