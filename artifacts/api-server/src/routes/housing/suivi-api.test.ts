// Routes de la veille quotidienne : suivre (une par compte), arrêter, visite (compteur à zéro), pastille, analyse demandée.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingListings, housingSearches } from "@workspace/db";
import { closeDatabase, db } from "../../lib/database";
import { findUserByEmail } from "../../lib/users";
import { useMemoryDatabase } from "../../test/helpers";

const EMAILS = ["suivie@example.com", "autre@example.com"];

process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";

let server: Server;
let base = "";
const cookies: string[] = [];
const call = (path: string, init: RequestInit = {}, who = 0) =>
  fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", cookie: cookies[who], ...(init.headers ?? {}) } });

/** Une recherche terminée du compte `who`, avec 3 annonces dont 2 lues après `seenAt`. */
async function completedSearch(who: number, seenAt = Date.now() - 60_000) {
  const me = (await findUserByEmail(EMAILS[who]))!;
  const [search] = await db().insert(housingSearches).values({ prompt: "Un T2 à Lille, 900 € max", criteria: JSON.stringify({ location: "Lille", intent: "rent", keywords: "" }), status: "completed", stage: "ready", ownerId: me.id }).returning();
  for (const [n, firstSeenAt, analyzed] of [[1, seenAt - 1000, 1], [2, seenAt + 1000, 0], [3, seenAt + 2000, 0]] as const) {
    await db().insert(housingListings).values({ searchId: search.id, title: `T2 n° ${n}`, url: `https://www.leboncoin.fr/ad/locations/${search.id}${n}`, description: "d", score: 70, features: "[]", firstSeenAt, analyzed });
  }
  return search.id;
}

before(async () => {
  await useMemoryDatabase();
  const { default: app } = await import("../../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  for (const email of EMAILS) {
    const register = await fetch(`${base}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "Arblade", email, password: "motdepasse-1" }) });
    cookies.push((register.headers.get("set-cookie") ?? "").split(";")[0]);
  }
});
after(async () => { server.close(); await closeDatabase(); });

test("suivre : heures valides seulement (1 ou 2, « HH:MM »), prochain passage à l'heure de Paris", async () => {
  const id = await completedSearch(0);
  for (const times of [[], ["8h"], ["08:00", "12:00", "18:00"], ["25:00"]]) {
    assert.equal((await call(`/housing/searches/${id}/watch`, { method: "PUT", body: JSON.stringify({ times }) })).status, 400, JSON.stringify(times));
  }
  const response = await call(`/housing/searches/${id}/watch`, { method: "PUT", body: JSON.stringify({ times: ["18:00", "08:00"] }) });
  assert.equal(response.status, 200);
  const search = await response.json() as { watch: string; watchTimes: string[]; nextWatchAt: string; unseenCount: number };
  assert.equal(search.watch, "active");
  assert.deepEqual(search.watchTimes, ["08:00", "18:00"]);
  assert.ok(Date.parse(search.nextWatchAt) > Date.now() && Date.parse(search.nextWatchAt) <= Date.now() + 24 * 3_600_000);
  assert.equal(search.unseenCount, 0, "ce qui est déjà là compte comme vu");
});

test("une seule veille quotidienne par compte ; la pastille donne son nombre de non vues ; la visite le remet à zéro", async () => {
  const first = await completedSearch(0), second = await completedSearch(0);
  await call(`/housing/searches/${first}/watch`, { method: "PUT", body: JSON.stringify({ times: ["08:00"] }) });
  await call(`/housing/searches/${second}/watch`, { method: "PUT", body: JSON.stringify({ times: ["08:00", "18:00"] }) });
  // Un passage a trouvé 2 annonces après la dernière visite.
  await db().update(housingSearches).set({ lastVisitedAt: Date.now() - 60_000 }).where(eq(housingSearches.id, second));
  const watch = await (await call("/housing/watch")).json() as { search: { id: number; unseenCount: number } | null };
  assert.equal(watch.search?.id, second);
  assert.equal(watch.search?.unseenCount, 2);
  const list = await (await call("/housing/searches")).json() as { id: number; watch: string | null }[];
  assert.equal(list[0].id, second, "la veille quotidienne en tête de « Mes recherches »");
  assert.equal(list.find(search => search.id === first)?.watch, null, "la précédente n'est plus suivie");
  assert.equal((await call(`/housing/searches/${second}/visit`, { method: "POST" })).status, 204);
  assert.equal(((await (await call("/housing/watch")).json()) as { search: { unseenCount: number } }).search.unseenCount, 0);
});

test("arrêter le suivi ; plus de pastille", async () => {
  const id = await completedSearch(0);
  await call(`/housing/searches/${id}/watch`, { method: "PUT", body: JSON.stringify({ times: ["08:00"] }) });
  const stopped = await (await call(`/housing/searches/${id}/watch`, { method: "DELETE" })).json() as { watch: string | null; nextWatchAt: string | null };
  assert.equal(stopped.watch, null);
  assert.equal(stopped.nextWatchAt, null);
  assert.equal(((await (await call("/housing/watch")).json()) as { search: unknown }).search, null);
});

test("un autre compte ne peut ni suivre, ni visiter, ni demander d'analyse (404), et ne voit pas la pastille", async () => {
  const id = await completedSearch(0);
  assert.equal((await call(`/housing/searches/${id}/watch`, { method: "PUT", body: JSON.stringify({ times: ["08:00"] }) }, 1)).status, 404);
  assert.equal((await call(`/housing/searches/${id}/watch`, { method: "DELETE" }, 1)).status, 404);
  assert.equal((await call(`/housing/searches/${id}/visit`, { method: "POST" }, 1)).status, 404);
  assert.equal((await call(`/housing/searches/${id}/analyze`, { method: "POST", body: JSON.stringify({ listingIds: [1] }) }, 1)).status, 404);
  assert.equal(((await (await call("/housing/watch", {}, 1)).json()) as { search: unknown }).search, null);
});

test("analyse demandée en faisant défiler : seules les annonces pas encore analysées de la recherche ; dates en ISO", async () => {
  const id = await completedSearch(0);
  const detail = await (await call(`/housing/searches/${id}`)).json() as { listings: { id: number; analyzed: boolean; firstSeenAt: string | null }[] };
  assert.deepEqual(detail.listings.map(listing => listing.analyzed).sort(), [false, false, true]);
  assert.ok(detail.listings.every(listing => listing.firstSeenAt && !Number.isNaN(Date.parse(listing.firstSeenAt))));
  assert.equal((await call(`/housing/searches/${id}/analyze`, { method: "POST", body: JSON.stringify({}) })).status, 400);
  const response = await call(`/housing/searches/${id}/analyze`, { method: "POST", body: JSON.stringify({ listingIds: detail.listings.map(listing => listing.id) }) });
  assert.equal(response.status, 202);
  assert.equal(((await response.json()) as { task: string }).task, "analyze");
  const requested = await db().select({ id: housingListings.id }).from(housingListings).where(eq(housingListings.analysisRequested, 1));
  assert.equal(requested.filter(row => detail.listings.some(listing => listing.id === row.id)).length, 2, "l'annonce déjà analysée n'est pas redemandée");
});

test("modifier la demande d'une veille : la veille passe sur la nouvelle recherche, aux mêmes heures ; jamais celle d'un autre compte", async () => {
  const watched = await completedSearch(0);
  await call(`/housing/searches/${watched}/watch`, { method: "PUT", body: JSON.stringify({ times: ["07:30", "19:00"] }) });
  const created = await call("/housing/searches", { method: "POST", body: JSON.stringify({ prompt: "Un T2 à Lille, 950 € max, avec balcon", watchFrom: watched }) });
  assert.equal(created.status, 201);
  const search = await created.json() as { id: number; watch: string | null; watchTimes: string[] };
  assert.equal(search.watch, "active");
  assert.deepEqual(search.watchTimes, ["07:30", "19:00"]);
  const old = await (await call(`/housing/searches/${watched}`)).json() as { watch: string | null };
  assert.equal(old.watch, null, "l'ancienne redevient une recherche ponctuelle");
  // Recherche non suivie, ou d'un autre compte : rien ne bouge.
  const plain = await completedSearch(0);
  const fromPlain = await (await call("/housing/searches", { method: "POST", body: JSON.stringify({ prompt: "Un T3 à Lille, 1 100 € max", watchFrom: plain }) })).json() as { watch: string | null };
  assert.equal(fromPlain.watch, null);
  const theirs = await completedSearch(1);
  await call(`/housing/searches/${theirs}/watch`, { method: "PUT", body: JSON.stringify({ times: ["08:00"] }) }, 1);
  const stolen = await (await call("/housing/searches", { method: "POST", body: JSON.stringify({ prompt: "Un T2 à Lille, 900 € max", watchFrom: theirs }) })).json() as { watch: string | null };
  assert.equal(stolen.watch, null);
  assert.equal(((await (await call(`/housing/searches/${theirs}`, {}, 1)).json()) as { watch: string | null }).watch, "active", "la veille de l'autre compte reste intacte");
});
