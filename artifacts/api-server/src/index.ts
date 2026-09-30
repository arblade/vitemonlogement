import app from "./app";
import { logger } from "./lib/logger";
import { closeDatabase, initDatabase } from "./lib/database";
import { createWorker } from "./lib/worker";
import { setWorker } from "./lib/worker-registry";
import { isProduction } from "./lib/env";
import { passwordConfigured } from "./lib/auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (!passwordConfigured()) {
  logger.warn(isProduction()
    ? "APP_PASSWORD n'est pas défini : l'API métier répond 503 tant qu'il ne l'est pas."
    : "APP_PASSWORD n'est pas défini : accès libre (développement uniquement).");
}

// Migrations d'abord (Drizzle), puis le worker qui reprend les recherches laissées « running », puis l'écoute.
await initDatabase();
const worker = createWorker();
setWorker(worker);
worker.start();

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Render envoie SIGTERM à chaque déploiement : on laisse finir l'étape en cours, on rend les baux.
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "Shutting down");
  server.close();
  await worker.stop();
  await closeDatabase();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
