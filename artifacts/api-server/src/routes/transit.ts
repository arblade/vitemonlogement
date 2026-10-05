import { Router, type IRouter } from "express";
import { linesIn } from "../lib/transit-lines";

const router: IRouter = Router();

// Lignes de métro et de tram de la zone affichée (GeoJSON), lues en mémoire : aucun appel extérieur. Mises en cache
// par le navigateur un jour (les données ne changent qu'à la régénération du fichier).
router.get("/transit/lines", (req, res) => {
  const [west, south, east, north] = ["west", "south", "east", "north"].map(key => Number(req.query[key]));
  res.set("Cache-Control", "private, max-age=86400");
  res.json(linesIn({ west, south, east, north }));
});

export default router;
