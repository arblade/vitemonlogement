// Aperçu des liens partagés (WhatsApp, Signal…) : balises og:* avec adresses absolues, lues sans JavaScript.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "front-"));
writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head>
<meta property="og:url" content="__ORIGIN__/" /><meta property="og:image" content="__ORIGIN__/og-image.png" />
<meta name="twitter:image" content="__ORIGIN__/og-image.png" /></head><body><div id="root"></div></body></html>`);
writeFileSync(path.join(dir, "og-image.png"), Buffer.from("89504e470d0a1a0a", "hex"));
process.env.FRONTEND_DIST = dir;
process.env.TRUST_PROXY = "1"; // comme sur Render : le protocole vient de X-Forwarded-Proto
process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";

let server: Server;
let base = "";
before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); delete process.env.PUBLIC_URL; });

// fetch interdit de forcer l'en-tête Host : on passe par node:http pour imiter un robot venu d'un autre domaine.
async function get(pathname: string, headers: Record<string, string>) {
  const { request } = await import("node:http");
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(`${base}${pathname}`, { headers }, res => { let body = ""; res.on("data", chunk => (body += chunk)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body })); });
    req.on("error", reject).end();
  });
}

test("l'accueil donne l'adresse absolue de l'image et de la page, d'après le site demandé (https derrière le proxy)", async () => {
  const { status, body } = await get("/", { host: "vitemonlogement.onrender.com", "x-forwarded-proto": "https" });
  assert.equal(status, 200);
  assert.match(body, /og:image" content="https:\/\/vitemonlogement\.onrender\.com\/og-image\.png"/);
  assert.match(body, /og:url" content="https:\/\/vitemonlogement\.onrender\.com\/"/);
  assert.ok(!body.includes("__ORIGIN__"), "plus aucun repère à remplacer");
});

test("même chose sur un lien profond (invitation, recherche) : tout le site renvoie la page avec ses balises", async () => {
  const { body } = await get("/?invite=Arblade", { host: "exemple.fr", "x-forwarded-proto": "https" });
  assert.match(body, /og:image" content="https:\/\/exemple\.fr\/og-image\.png"/);
  const deep = await get("/searches/12", { host: "exemple.fr", "x-forwarded-proto": "https" });
  assert.match(deep.body, /twitter:image" content="https:\/\/exemple\.fr\/og-image\.png"/);
});

test("PUBLIC_URL, si définie, l'emporte (domaine personnalisé)", async () => {
  process.env.PUBLIC_URL = "https://vitemonlogement.fr/";
  const { body } = await get("/", { host: "autre.onrender.com" });
  assert.match(body, /og:url" content="https:\/\/vitemonlogement\.fr\/"/);
  assert.match(body, /og:image" content="https:\/\/vitemonlogement\.fr\/og-image\.png"/);
  delete process.env.PUBLIC_URL;
});

test("un en-tête Host douteux n'est jamais recopié dans la page (pas d'injection)", async () => {
  const { body } = await get("/", { host: 'x"><script>alert(1)</script>' });
  assert.ok(!body.includes("<script>alert"), "rien d'injecté");
  assert.match(body, /og:image" content="\/og-image\.png"/, "repli sur une adresse relative");
});

test("l'image est servie en PNG, et l'API n'est pas masquée par la page", async () => {
  const image = await fetch(`${base}/og-image.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${base}/api/healthz`)).status, 200);
});
