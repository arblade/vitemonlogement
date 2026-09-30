import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { after, before } from "node:test";
import { checkPassword, issueSession, readSession } from "./auth";
import { closeDatabase } from "./database";
import { useMemoryDatabase } from "../test/helpers";

process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";
process.env.TRUST_PROXY = "1";
process.env.RATE_LIMIT_IP_PER_HOUR = "2";
process.env.QUOTA_COOKIE_PER_HOUR = "100";
process.env.QUOTA_GLOBAL_PER_DAY = "1000";

let server: Server;
let base = "";

before(async () => {
  await useMemoryDatabase();
  const { default: app } = await import("../app"); // après les variables d'environnement (trust proxy)
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server.close(); await closeDatabase(); });

test("mot de passe : exact, sensible à la casse", () => {
  assert.equal(checkPassword("Arblade"), true);
  assert.equal(checkPassword("arblade"), false);
  assert.equal(checkPassword("Arblad"), false);
  assert.equal(checkPassword(undefined), false);
});

test("session signée : valide, falsifiée, expirée", () => {
  const now = Date.now();
  const token = issueSession(now, "visiteur-1");
  assert.equal(readSession(token, now + 1000)?.visitorId, "visiteur-1");
  assert.equal(readSession(token.replace("visiteur-1", "visiteur-2"), now), null);
  assert.equal(readSession(token.slice(0, -2) + "xx", now), null);
  assert.equal(readSession(token, now + 31 * 86_400_000), null);
  assert.equal(readSession("n'importe quoi", now), null);
});

test("l'API métier exige la session ; /healthz reste public", async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/housing/searches`)).status, 401);
  assert.equal((await fetch(`${base}/auth/me`)).status, 401);
});

test("connexion : mauvais mot de passe refusé, bon mot de passe pose un cookie httpOnly", async () => {
  const bad = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "nope" }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "Arblade" }) });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie") ?? "";
  assert.match(cookie, /vml_session=/);
  assert.match(cookie, /HttpOnly/i);
  const session = cookie.split(";")[0];
  assert.equal((await fetch(`${base}/housing/searches`, { headers: { cookie: session } })).status, 200);
  assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie: session } })).status, 200);
});

test("le rate limit par IP lit X-Forwarded-For (proxy Render) : chaque client a son propre quota", async () => {
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ password: "Arblade" }) });
  const session = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const post = (ip: string) => fetch(`${base}/housing/interpret`, {
    method: "POST", headers: { "content-type": "application/json", cookie: session, "x-forwarded-for": ip }, body: JSON.stringify({ prompt: "" }),
  });
  assert.notEqual((await post("10.0.0.1")).status, 429);
  assert.notEqual((await post("10.0.0.1")).status, 429);
  const third = await post("10.0.0.1");
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) > 0);
  assert.notEqual((await post("10.0.0.2")).status, 429, "une autre IP derrière le même proxy n'est pas bloquée");
});

test("les lectures (suivi d'une recherche) ne consomment pas le quota coûteux", async () => {
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" }, body: JSON.stringify({ password: "Arblade" }) });
  const session = (login.headers.get("set-cookie") ?? "").split(";")[0];
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${base}/housing/searches`, { headers: { cookie: session, "x-forwarded-for": "8.8.8.8" } });
    assert.equal(res.status, 200);
  }
});
