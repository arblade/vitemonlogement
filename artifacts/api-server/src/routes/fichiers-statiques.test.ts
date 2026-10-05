// Après un déploiement, un ancien fichier /assets/….js doit être un 404 : servi en HTML (la page d'accueil), le navigateur
// échoue à charger la carte et l'appli affiche une erreur (onglet resté ouvert pendant la mise en ligne).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "front-statique-"));
writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head></head><body><div id="root"></div></body></html>`);
mkdirSync(path.join(dir, "assets"));
writeFileSync(path.join(dir, "assets", "results-map-canvas-ACTUEL.js"), "export default 1;");
process.env.FRONTEND_DIST = dir;
process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";

let server: Server;
let base = "";
before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); });

test("un fichier existant est servi avec son type", async () => {
  const response = await fetch(`${base}/assets/results-map-canvas-ACTUEL.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /javascript/);
});

test("un ancien fichier d'une version précédente : 404, jamais la page d'accueil", async () => {
  for (const file of ["/assets/results-map-canvas-ANCIEN.js", "/assets/index-ancien.css", "/favicon.ico", "/robots.txt.bak"]) {
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 404, file);
    assert.doesNotMatch(response.headers.get("content-type") ?? "", /html/, file);
    assert.doesNotMatch(await response.text(), /<div id="root">/, file);
  }
});

test("les pages de l'appli, elles, retombent sur l'accueil (routes du navigateur) ; l'API garde ses réponses", async () => {
  for (const route of ["/", "/searches/12", "/favoris", "/searches/12?annonce=345"]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /<div id="root">/, route);
  }
  const api = await fetch(`${base}/api/healthz`);
  assert.equal(api.status, 200);
  assert.doesNotMatch(api.headers.get("content-type") ?? "", /html/);
});
