import express, { type Express } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
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
  app.use(express.static(staticDir));
  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
