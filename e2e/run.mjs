// pnpm test:e2e : compile le front, lance l'API de test (base en mémoire, aucun service payant), joue le scénario navigateur
// en mobile puis en desktop, et arrête le serveur. Nécessite Chromium (PLAYWRIGHT_BROWSERS_PATH ou CHROMIUM_PATH).
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.E2E_PORT ?? "4180";
const base = `http://localhost:${port}`;

if (!process.env.E2E_SKIP_BUILD) {
  const build = spawnSync("pnpm", ["--filter", "@workspace/logiscope", "run", "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const { OPENAI_API_KEY: _a, APIFY_TOKEN: _b, DATABASE_URL: _c, ...env } = process.env;
const server = spawn("node", ["--import", "tsx", "scripts/e2e-server.ts"], {
  cwd: path.join(root, "artifacts/api-server"), stdio: ["ignore", "pipe", "pipe"],
  env: { ...env, PORT: port, APP_PASSWORD: "Arblade", SESSION_SECRET: "e2e", TRUST_PROXY: "1", NODE_ENV: "development", WORKER_INTERVAL_MS: "3600000", FRONTEND_DIST: path.join(root, "artifacts/logiscope/dist/public") },
});
let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });
const stop = () => { if (!server.killed) server.kill(); };
process.on("exit", stop);

let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = await fetch(`${base}/api/healthz`).then(response => response.ok).catch(() => false);
  if (!ready) await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) { console.error(`Le serveur de test n'a pas démarré.\n${log}`); stop(); process.exit(1); }

const tests = spawnSync("node", ["--test", "e2e/app.e2e.mjs"], { cwd: root, stdio: "inherit", env: { ...process.env, E2E_BASE_URL: base } });
stop();
process.exit(tests.status ?? 1);
