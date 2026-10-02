// Mot de passe oublié : demande (même réponse que le compte existe ou non), e-mail, lien signé à usage unique, 1 heure.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { mailOutbox } from "@workspace/db";
import { closeDatabase, db } from "../lib/database";
import { useMemoryDatabase } from "../test/helpers";

process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";
process.env.TRUST_PROXY = "1";
process.env.PUBLIC_URL = "https://vitemonlogement.fr";

let server: Server;
let base = "";
let ip = 0;
const post = (path: string, body: unknown, fixedIp?: string) => fetch(`${base}${path}`, {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fixedIp ?? `10.3.0.${++ip}` }, body: JSON.stringify(body),
});
const resetRows = () => db().select().from(mailOutbox).where(eq(mailOutbox.kind, "password-reset"));

/** Lien envoyé par e-mail pour la dernière demande (composé comme au moment de l'envoi). */
async function mailedToken(now = Date.now()) {
  const { compose } = await import("../lib/mail-outbox");
  const rows = await resetRows();
  const composed = await compose(rows[rows.length - 1], now);
  assert.ok("mail" in composed, JSON.stringify(composed));
  const link = composed.mail.text.match(/https:\/\/vitemonlogement\.fr\/\?reset=([\w.-]+)/);
  assert.ok(link, composed.mail.text);
  return { token: link[1], mail: composed.mail };
}

before(async () => {
  await useMemoryDatabase();
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  assert.equal((await post("/auth/register", { code: "Arblade", email: "oubli@example.com", password: "ancien-mdp-1" })).status, 201);
});
after(async () => { server.close(); await closeDatabase(); delete process.env.PUBLIC_URL; });

test("demande : même réponse pour un compte inconnu, e-mail seulement pour un compte existant (un toutes les 5 minutes au plus)", async () => {
  const unknown = await post("/auth/forgot", { email: "personne@example.com" });
  assert.equal(unknown.status, 200);
  assert.deepEqual(await unknown.json(), { sent: true });
  assert.equal((await resetRows()).length, 0);
  const known = await post("/auth/forgot", { email: " Oubli@Example.com " });
  assert.deepEqual(await known.json(), { sent: true }, "réponse identique : on ne révèle pas qui est inscrit");
  assert.equal((await resetRows()).length, 1);
  await post("/auth/forgot", { email: "oubli@example.com" });
  assert.equal((await resetRows()).length, 1, "pas de rafale d'e-mails");
  assert.equal((await post("/auth/forgot", { email: "pas-une-adresse" })).status, 400);
});

test("e-mail : lien vers le site, valable 1 heure, envoyé même si le compte s'est désinscrit des e-mails de veille", async () => {
  const { setMailOptOut } = await import("../lib/mail-outbox");
  const { findUserByEmail } = await import("../lib/users");
  await setMailOptOut((await findUserByEmail("oubli@example.com"))!.id, true);
  const { mail } = await mailedToken();
  assert.deepEqual(mail.to, "oubli@example.com");
  assert.equal(mail.subject, "Choisir un nouveau mot de passe");
  assert.match(mail.text, /valable 1 heure/);
  assert.match(mail.html, /href="https:\/\/vitemonlogement\.fr\/\?reset=/);
});

test("nouveau mot de passe : le lien connecte, l'ancien mot de passe ne marche plus, le lien ne sert qu'une fois", async () => {
  const { token } = await mailedToken();
  assert.equal((await post("/auth/reset", { token, password: "court" })).status, 400, "8 caractères minimum");
  const reset = await post("/auth/reset", { token, password: "nouveau-mdp-1" });
  assert.equal(reset.status, 200);
  assert.equal((await reset.json() as { email: string }).email, "oubli@example.com");
  const cookie = (reset.headers.get("set-cookie") ?? "").split(";")[0];
  assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie } })).status, 200, "connecté");
  assert.equal((await post("/auth/login", { email: "oubli@example.com", password: "ancien-mdp-1" })).status, 401);
  assert.equal((await post("/auth/login", { email: "oubli@example.com", password: "nouveau-mdp-1" })).status, 200);
  const again = await post("/auth/reset", { token, password: "encore-un-mdp-1" });
  assert.equal(again.status, 400, "déjà servi");
  assert.match((await again.json() as { error: string }).error, /expiré ou a déjà servi/);
});

test("lien expiré, falsifié ou d'un autre compte : refusé", async () => {
  const { readResetToken, issueResetToken } = await import("../lib/password-reset");
  const { findUserByEmail } = await import("../lib/users");
  const user = (await findUserByEmail("oubli@example.com"))!;
  const token = issueResetToken(user);
  assert.equal((await readResetToken(token))?.id, user.id);
  assert.equal(await readResetToken(token, Date.now() + 61 * 60_000), null, "après 1 heure");
  assert.equal(await readResetToken(token.replace(/\.[\w-]+$/, ".faux")), null);
  assert.equal(await readResetToken(token.replace(/^\d+/, String(user.id + 1))), null);
  assert.equal(await readResetToken(`${user.id}.9999999999.x`), null);
  for (const bad of [undefined, "", "abc"]) assert.equal((await post("/auth/reset", { token: bad, password: "nouveau-mdp-2" })).status, 400);
});

test("demande restée en file plus de 30 minutes (Resend en panne) : plus envoyée", async () => {
  const { compose } = await import("../lib/mail-outbox");
  const rows = await resetRows();
  const composed = await compose(rows[rows.length - 1], rows[rows.length - 1].createdAt + 31 * 60_000);
  assert.deepEqual(composed, { skip: "trop tard" });
});

test("trop de demandes depuis la même adresse IP : refusées (429)", async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await post("/auth/forgot", { email: `x${i}@example.com` }, "10.9.9.9")).status);
  assert.equal(statuses.filter(status => status === 429).length, 2);
});
