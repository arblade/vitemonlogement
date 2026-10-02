// E-mails : désinscription sans connexion (lien signé), réactivation depuis le site, gabarits (échappement, pluriels).
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { after, before } from "node:test";
import { closeDatabase } from "../lib/database";
import { findUserByEmail } from "../lib/users";
import { useMemoryDatabase } from "../test/helpers";

process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";
process.env.PUBLIC_URL = "https://vitemonlogement.fr";

let server: Server;
let base = "";
let cookie = "";
let userId = 0;

before(async () => {
  await useMemoryDatabase();
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const register = await fetch(`${base}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "Arblade", email: "mails@example.com", password: "motdepasse-1" }) });
  cookie = (register.headers.get("set-cookie") ?? "").split(";")[0];
  userId = (await findUserByEmail("mails@example.com"))!.id;
});
after(async () => { server.close(); await closeDatabase(); delete process.env.PUBLIC_URL; });

const me = async () => (await (await fetch(`${base}/auth/me`, { headers: { cookie } })).json()) as { mailAlerts: boolean };
const linkPath = async () => {
  const { unsubscribeUrl } = await import("../lib/mail-outbox");
  const url = unsubscribeUrl(userId);
  assert.ok(url.startsWith("https://vitemonlogement.fr/api/mail/unsubscribe?"));
  return url.replace("https://vitemonlogement.fr/api", "");
};

test("désinscription : ouvrir le lien ne fait rien (un bouton à toucher), le bouton désinscrit, sans être connecté", async () => {
  assert.equal((await me()).mailAlerts, true, "e-mails actifs par défaut");
  const path = await linkPath();
  const page = await fetch(`${base}${path}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<form method="post"/);
  assert.match(html, /Ne plus recevoir ces e-mails/);
  assert.equal((await me()).mailAlerts, true, "un antivirus qui visite le lien ne désinscrit personne");
  const done = await fetch(`${base}${path}`, { method: "POST" });
  assert.equal(done.status, 200);
  assert.match(await done.text(), /C’est fait/);
  assert.equal((await me()).mailAlerts, false);
});

test("désinscription en un clic des messageries (RFC 8058) : POST « List-Unsubscribe=One-Click »", async () => {
  await fetch(`${base}/mail/preferences`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ alerts: true }) });
  const response = await fetch(`${base}${await linkPath()}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(response.status, 200);
  assert.equal((await me()).mailAlerts, false);
});

test("lien falsifié ou d'un autre compte : refusé, rien ne change", async () => {
  await fetch(`${base}/mail/preferences`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ alerts: true }) });
  const path = await linkPath();
  for (const bad of [path.replace(/t=[\w-]+/, "t=faux"), path.replace(`u=${userId}`, `u=${userId + 1}`), "/mail/unsubscribe", "/mail/unsubscribe?u=abc&t=x"]) {
    assert.equal((await fetch(`${base}${bad}`)).status, 400, bad);
    assert.equal((await fetch(`${base}${bad}`, { method: "POST" })).status, 400, bad);
  }
  assert.equal((await me()).mailAlerts, true);
});

test("réactiver les e-mails depuis le site : il faut être connecté, et une valeur booléenne", async () => {
  assert.equal((await fetch(`${base}/mail/preferences`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ alerts: true }) })).status, 401);
  assert.equal((await fetch(`${base}/mail/preferences`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ alerts: "oui" }) })).status, 400);
  const off = await fetch(`${base}/mail/preferences`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ alerts: false }) });
  assert.deepEqual(await off.json(), { mailAlerts: false });
  assert.equal((await me()).mailAlerts, false);
  await fetch(`${base}/mail/preferences`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ alerts: true }) });
  assert.equal((await me()).mailAlerts, true);
});

test("gabarit du récapitulatif : texte de l'annonce échappé, singulier, faits lisibles, relève partielle signalée", async () => {
  const { watchDigest, facts } = await import("../lib/mail-templates");
  const listing = { title: "<script>alert(1)</script> T2 & balcon", price: 1250, area: 40.4, rooms: 2, location: "Lille", image: "https://img.example/1.jpg?a=1&b=2", aiSummary: "Lumineux." };
  const mail = watchDigest({
    location: "Lille", prompt: "Un T2 à Lille", passAt: Date.UTC(2026, 9, 2, 6, 0), listings: [listing], partial: true,
    searchUrl: "https://vitemonlogement.fr/searches/3", unsubscribeUrl: "https://vitemonlogement.fr/api/mail/unsubscribe?u=1&t=x", email: "a@example.com",
  });
  assert.equal(mail.subject, "1 nouveau logement à Lille");
  assert.ok(!mail.html.includes("<script>"), "pas de HTML venu d'une annonce");
  assert.ok(mail.html.includes("&lt;script&gt;alert(1)&lt;/script&gt; T2 &amp; balcon"));
  assert.ok(mail.html.includes("https://img.example/1.jpg?a=1&amp;b=2"));
  assert.ok(mail.html.includes("Voir la nouveauté"));
  assert.ok(mail.html.includes("Recherche très large"));
  assert.match(mail.text, /Relève de 8 h /, "heure de Paris (6 h UTC en été)");
  assert.equal(facts(listing), "1 250 €/mois · 40 m² · 2 pièces · Lille");
  assert.equal(facts({ ...listing, price: null, area: null, rooms: 1, location: null }), "1 pièce");
});

test("heure annoncée dans le récapitulatif : celle choisie (8 h), même si la relève est partie à 8 h 04 ; un rattrapage dit sa vraie heure", async () => {
  const { digestLabelAt } = await import("../lib/mail-outbox");
  const { hourLabel } = await import("../lib/mail-templates");
  const times = ["08:00", "18:00"];
  assert.equal(hourLabel(digestLabelAt(times, Date.parse("2026-10-23T06:04:37Z"))), "8 h");
  assert.equal(hourLabel(digestLabelAt(times, Date.parse("2026-10-23T16:02:00Z"))), "18 h");
  assert.equal(hourLabel(digestLabelAt(times, Date.parse("2026-10-23T09:12:00Z"))), "11 h 12", "rattrapage à 11 h 12");
  assert.equal(hourLabel(digestLabelAt(["07:30"], Date.parse("2026-10-23T05:33:00Z"))), "7 h 30");
});
