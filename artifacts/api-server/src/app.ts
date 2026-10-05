import express, { type Express, type Request, type Response } from "express";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { isProduction } from "./lib/env";

const app: Express = express();

// Derrière le proxy de Render, l'IP du client est dans X-Forwarded-For : sans « trust proxy », tout le
// monde aurait l'IP du proxy et partagerait le même quota. 1 = un seul proxy de confiance (Render).
const trustProxy = process.env.TRUST_PROXY ?? (isProduction() ? "1" : "false");
app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === "true" ? true : trustProxy === "false" ? false : trustProxy);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Le front est servi par le même service : aucun CORS en production, sauf CORS_ORIGIN explicite.
const corsOrigins = process.env.CORS_ORIGIN?.split(",").map(value => value.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins?.length ? corsOrigins : !isProduction(), credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

// En production, le même service sert le front compilé (Vite) et l'API.
const staticDir = process.env.FRONTEND_DIST || path.resolve(process.cwd(), "artifacts/logiscope/dist/public");
if (existsSync(path.join(staticDir, "index.html"))) {
  // Les aperçus de lien (WhatsApp, Signal…) lisent les balises og:* de la page, sans exécuter le JavaScript, et
  // exigent des adresses absolues : on y met l'adresse du site telle que le visiteur (ou le robot) l'a demandée.
  const indexHtml = readFileSync(path.join(staticDir, "index.html"), "utf8");
  const originOf = (req: Request) => {
    const configured = process.env.PUBLIC_URL?.trim().replace(/\/+$/, "");
    if (configured && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(configured)) return configured;
    const host = req.get("host") ?? "";
    return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${req.protocol}://${host}` : ""; // hôte douteux : adresse relative
  };
  const sendIndex = (req: Request, res: Response) => {
    res.type("html").set("Cache-Control", "no-cache").send(indexHtml.replaceAll("__ORIGIN__", originOf(req)));
  };
  app.get("/", sendIndex);
  app.use(express.static(staticDir, { index: false }));
  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    // Un fichier qui n'existe pas (ancien /assets/….js d'un onglet resté ouvert pendant un déploiement) est un 404, pas
    // la page d'accueil : en HTML, le navigateur échoue à charger le module et l'appli affiche une erreur.
    if (req.path.startsWith("/assets/") || /\.[a-z0-9]{1,8}$/i.test(req.path)) return void res.status(404).set("Cache-Control", "no-store").type("text").send("Fichier introuvable");
    sendIndex(req, res);
  });
}

export default app;
