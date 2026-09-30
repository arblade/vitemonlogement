import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { after, before } from "node:test";
import { checkInviteCode, issueSession, readSession } from "./auth";
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

test("code d'invitation : exact, sensible à la casse", () => {
  assert.equal(checkInviteCode("Arblade"), true);
  assert.equal(checkInviteCode("arblade"), false);
  assert.equal(checkInviteCode("Arblad"), false);
  assert.equal(checkInviteCode(undefined), false);
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
  assert.equal((await fetch(`${base}/favorites`)).status, 401);
  assert.equal((await fetch(`${base}/auth/me`)).status, 401);
});

let ipCounter = 0;
const nextIp = () => `10.1.0.${++ipCounter}`;
const json = (body: unknown, ip = nextIp(), cookie?: string) => ({
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});
/** Crée un compte avec le code d'invitation et renvoie le cookie de session. */
async function signUp(email: string, password = "motdepasse-1", ip = nextIp()) {
  const response = await fetch(`${base}/auth/register`, json({ code: "Arblade", email, password }, ip));
  assert.equal(response.status, 201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

test("inscription : seul le code d'invitation (APP_PASSWORD) ouvre la création de compte", async () => {
  const bad = await fetch(`${base}/auth/register`, json({ code: "nope", email: "a@example.com", password: "motdepasse-1" }));
  assert.equal(bad.status, 403);
  const ok = await fetch(`${base}/auth/register`, json({ code: "Arblade", email: "Premier@Example.com", password: "motdepasse-1" }));
  assert.equal(ok.status, 201);
  const cookie = ok.headers.get("set-cookie") ?? "";
  assert.match(cookie, /vml_session=/);
  assert.match(cookie, /HttpOnly/i);
  const session = cookie.split(";")[0];
  assert.equal((await fetch(`${base}/housing/searches`, { headers: { cookie: session } })).status, 200);
  const me = await fetch(`${base}/auth/me`, { headers: { cookie: session } });
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { email: string }).email, "premier@example.com", "e-mail normalisé en minuscules");
});

test("inscription : e-mail invalide, mot de passe trop court, e-mail déjà pris", async () => {
  const attempt = (body: object) => fetch(`${base}/auth/register`, json({ code: "Arblade", ...body }));
  assert.equal((await attempt({ email: "pas-un-email", password: "motdepasse-1" })).status, 400);
  assert.equal((await attempt({ email: "court@example.com", password: "1234567" })).status, 400);
  await signUp("doublon@example.com");
  assert.equal((await attempt({ email: "DOUBLON@example.com", password: "autre-motdepasse" })).status, 409);
});

test("connexion : mauvais mot de passe ou e-mail inconnu donnent la même erreur, le bon couple ouvre la session", async () => {
  await signUp("membre@example.com", "le-bon-mot-de-passe");
  const wrong = await fetch(`${base}/auth/login`, json({ email: "membre@example.com", password: "nope" }));
  const unknown = await fetch(`${base}/auth/login`, json({ email: "inconnu@example.com", password: "le-bon-mot-de-passe" }));
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json(), "on ne révèle pas quels comptes existent");
  const ok = await fetch(`${base}/auth/login`, json({ email: "MEMBRE@example.com", password: "le-bon-mot-de-passe" }));
  assert.equal(ok.status, 200);
  const session = (ok.headers.get("set-cookie") ?? "").split(";")[0];
  assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie: session } })).status, 200);
  assert.equal((await fetch(`${base}/auth/login`, json({ password: "le-bon-mot-de-passe" }))).status, 401, "sans e-mail : refusé");
});

test("le code d'invitation de l'URL est vérifié, et la recherche du code par force brute est freinée", async () => {
  const check = (code: string, ip: string) => fetch(`${base}/auth/invite?code=${encodeURIComponent(code)}`, { headers: { "x-forwarded-for": ip } });
  assert.deepEqual(await (await check("Arblade", nextIp())).json(), { valid: true });
  assert.deepEqual(await (await check("faux", nextIp())).json(), { valid: false });
  const ip = nextIp();
  for (let i = 0; i < 10; i++) assert.equal((await check(`essai-${i}`, ip)).status, 200);
  const blocked = await check("essai-11", ip);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await check("Arblade", nextIp())).status, 200, "une autre IP n'est pas bloquée");
});

test("le rate limit par IP lit X-Forwarded-For (proxy Render) : chaque client a son propre quota", async () => {
  const session = await signUp("quota-ip@example.com");
  const post = (ip: string) => fetch(`${base}/housing/interpret`, json({ prompt: "" }, ip, session));
  assert.notEqual((await post("10.0.0.1")).status, 429);
  assert.notEqual((await post("10.0.0.1")).status, 429);
  const third = await post("10.0.0.1");
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) > 0);
  assert.notEqual((await post("10.0.0.2")).status, 429, "une autre IP derrière le même proxy n'est pas bloquée");
});

test("les lectures (suivi d'une recherche) ne consomment pas le quota coûteux", async () => {
  const session = await signUp("lectures@example.com");
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${base}/housing/searches`, { headers: { cookie: session, "x-forwarded-for": "8.8.8.8" } });
    assert.equal(res.status, 200);
  }
});
