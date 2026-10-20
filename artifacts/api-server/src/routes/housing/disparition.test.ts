import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
import { housingListings, housingSearches } from "@workspace/db";
import { fatihRecord, leboncoinLabel } from "../../test/fatih";

// Annonces disparues de Le Bon Coin : détectées sans lecture de plus, par leur absence dans la tête de liste lue (triée de la
// plus récemment mise à jour à la plus ancienne), puis masquées. Voir detectGone (store.ts) et features/annonces-disparues.md.

const HOUR = 3_600_000;
const criteria = { location: "Lille", intent: "rent" as const, keywords: "", radius: 5, wishes: [] };
/** Date réaliste à partir d'un chiffre simple : 100 unités = 1 heure (Le Bon Coin date à la seconde). */
const BASE = Date.parse("2026-10-01T00:00:00Z");
const T = (value: number) => BASE + value * 36_000;
const urlOf = (n: number) => `https://www.leboncoin.fr/ad/locations/${n}`;

let fake: Server;
const apifyInputs: { page: number; limit: number }[] = [];
const runs = new Map<string, unknown[]>();
/** Marché simulé : annonce n → dernière mise à jour (ms). Retirer une entrée = annonce supprimée du site. */
const market = new Map<number, number>();
const sortedMarket = () => [...market].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/acts/fatihtahta~leboncoin-fr-scraper/runs")) {
        const input = JSON.parse(body) as { startUrls: string[]; limit: number };
        const page = Number(new URL(input.startUrls[0]).searchParams.get("page") ?? 1);
        apifyInputs.push({ page, limit: input.limit });
        const id = `run-${runs.size + 1}`;
        runs.set(id, sortedMarket().slice((page - 1) * 35, (page - 1) * 35 + input.limit).map(([n, updatedAt]) => fatihRecord({
          url: urlOf(n), title: `Appartement T2 n° ${n}`, description: "Appartement lumineux, proche métro.", price: 650, area: 40, rooms: 2,
          postedAt: leboncoinLabel(updatedAt), updatedAt: leboncoinLabel(updatedAt),
        })));
        return json({ data: { id } });
      }
      const run = url.match(/^\/v2\/actor-runs\/(run-\d+)/);
      if (run) return json({ data: { status: "SUCCEEDED", defaultDatasetId: run[1] } });
      const dataset = url.match(/^\/v2\/datasets\/(run-\d+)\/items/);
      if (dataset) return json(runs.get(dataset[1]) ?? []);
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        let content: unknown;
        if (request.messages[0].content.includes("Interprète une demande")) {
          content = { location: "Lille", intent: "rent", maxPrice: 900, radius: 5, keywords: "", uncertainChecks: [], places: [] };
        } else {
          const { listings } = JSON.parse(request.messages[1].content) as { listings: { id: number; wantGeneral: boolean }[] };
          content = { items: listings.map(item => ({ id: item.id, checks: [], ...(item.wantGeneral ? { summary: "Logement.", summaryEvidence: ["Appartement lumineux"], features: [], offer: "entire", offerEvidence: "" } : {}) })) };
        }
        return json({ id: "x", object: "chat.completion", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }] });
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  Object.assign(process.env, { APIFY_BASE_URL: origin, APIFY_TOKEN: "test", OPENAI_BASE_URL: `${origin}/v1`, OPENAI_API_KEY: "test" });
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
});
after(async () => {
  fake.close();
  delete process.env.VERIFY_DAYS;
  delete process.env.GONE_AFTER_PASSES;
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});

async function listingRows(searchId: number) {
  const { db } = await import("../../lib/database");
  return db().select().from(housingListings).where(eq(housingListings.searchId, searchId));
}
const rowOf = async (searchId: number, n: number) => (await listingRows(searchId)).find(row => row.url === urlOf(n))!;
async function displayed(searchId: number) {
  const { getSearch } = await import("./store");
  return ((await getSearch(searchId))?.listings ?? []).map(listing => Number(listing.url.split("/").pop())).sort((a, b) => a - b);
}

// --- Niveau stockage : la règle de détection ------------------------------------------------------------------------------

/** Annonces en base avec leur date de mise à jour (n → ms) ; renvoie l'identifiant de la recherche. */
async function seed(dates: Record<number, number>, source = "leboncoin") {
  const { createSearch, saveRead } = await import("./store");
  const { normalize } = await import("./apify");
  const id = await createSearch("studio à Lille");
  const items = Object.entries(dates).map(([n, at]) => ({
    ...normalize(fatihRecord({ url: urlOf(Number(n)), title: `T2 n° ${n}`, description: "Lumineux.", price: 650, area: 40, rooms: 2, postedAt: leboncoinLabel(T(at)), updatedAt: leboncoinLabel(T(at)) }), criteria)!,
    source: source as "leboncoin",
  }));
  assert.equal(items.length, Object.keys(dates).length);
  await saveRead(id, items, 1);
  return id;
}
/** Un passage : ces annonces sont vues (début du passage `at`), puis la détection sur la plage lue. */
async function pass(id: number, seen: number[], range: { oldest: number; newest: number | null }, at: number) {
  const { markSeen, detectGone } = await import("./store");
  await markSeen(id, seen.map(urlOf), at);
  return detectGone(id, { oldest: range.oldest < 0 ? -1 : T(range.oldest), newest: range.newest == null ? null : T(range.newest) }, at, at + 1);
}

test("une annonce absente de la plage lue n'est jugée disparue qu'au 2e passage de suite, puis masquée", async () => {
  const id = await seed({ 1: 1000, 2: 900, 3: 800, 4: 700 });
  const first = await pass(id, [1, 2, 4], { oldest: 650, newest: null }, 10);
  assert.deepEqual(first, { expected: 4, missing: 1, gone: 0 });
  assert.equal((await rowOf(id, 3)).missedPasses, 1);
  assert.deepEqual(await displayed(id), [1, 2, 3, 4], "un seul passage ne suffit pas : toujours affichée");
  const second = await pass(id, [1, 2, 4], { oldest: 650, newest: null }, 20);
  assert.equal(second.gone, 1);
  assert.notEqual((await rowOf(id, 3)).goneAt, null);
  assert.deepEqual(await displayed(id), [1, 2, 4]);
  // Déjà jugée disparue : plus comptée aux passages suivants.
  assert.deepEqual(await pass(id, [1, 2, 4], { oldest: 650, newest: null }, 30), { expected: 3, missing: 0, gone: 0 });
});

test("une annonce revue entre-temps repart de zéro ; une annonce jugée disparue qui revient est rétablie", async () => {
  const id = await seed({ 1: 1000, 2: 900, 3: 800 });
  await pass(id, [1, 3], { oldest: 700, newest: null }, 10); // 2 manque une fois
  assert.equal((await rowOf(id, 2)).missedPasses, 1);
  await pass(id, [1, 2, 3], { oldest: 700, newest: null }, 20); // revue
  assert.equal((await rowOf(id, 2)).missedPasses, 0);
  await pass(id, [1, 3], { oldest: 700, newest: null }, 30); // ne compte plus que pour 1
  assert.equal((await rowOf(id, 2)).goneAt, null, "deux absences non consécutives ne suffisent pas");
  await pass(id, [1, 3], { oldest: 700, newest: null }, 40);
  assert.notEqual((await rowOf(id, 2)).goneAt, null);
  const { markSeen } = await import("./store");
  await markSeen(id, [urlOf(2)], 50); // l'annonce est de nouveau en ligne
  assert.equal((await rowOf(id, 2)).goneAt, null);
  assert.deepEqual(await displayed(id), [1, 2, 3]);
});

test("seules les annonces dont la mise à jour est dans la plage lue sont jugées : les plus anciennes ne le sont jamais", async () => {
  const id = await seed({ 1: 1000, 2: 900, 3: 800, 4: 500 });
  // Lecture jusqu'à 800 : l'annonce 4 (500) est hors plage ; 3 (800) est à la limite (non comptée : une égalité peut être coupée).
  const result = await pass(id, [1], { oldest: 800, newest: null }, 10);
  assert.deepEqual(result, { expected: 2, missing: 1, gone: 0 });
  assert.equal((await rowOf(id, 2)).missedPasses, 1);
  assert.equal((await rowOf(id, 3)).missedPasses, 0, "à la limite de la plage");
  assert.equal((await rowOf(id, 4)).missedPasses, 0, "plus ancienne que la plage");
});

test("fin de liste atteinte : toutes les annonces connues sont vérifiées, même les plus anciennes", async () => {
  const id = await seed({ 1: 1000, 2: 900, 3: 800, 4: 500 });
  const result = await pass(id, [1, 2], { oldest: -1, newest: null }, 10);
  assert.deepEqual(result, { expected: 4, missing: 2, gone: 0 });
  assert.equal((await rowOf(id, 4)).missedPasses, 1);
});

test("lecture d'une page plus ancienne (« Étendre ») : la plage est bornée en haut aussi", async () => {
  const id = await seed({ 1: 1000, 2: 900, 3: 800, 4: 700 });
  const result = await pass(id, [3], { oldest: 650, newest: 850 }, 10); // la page lue va de 850 à 650
  assert.deepEqual(result, { expected: 2, missing: 1, gone: 0 });
  assert.equal((await rowOf(id, 4)).missedPasses, 1, "dans la page");
  assert.equal((await rowOf(id, 1)).missedPasses, 0, "au-dessus de la page lue");
  assert.equal((await rowOf(id, 2)).missedPasses, 0, "au-dessus de la page lue");
});

test("GONE_AFTER_PASSES règle le nombre d'absences de suite", async () => {
  process.env.GONE_AFTER_PASSES = "1";
  try {
    const id = await seed({ 1: 1000, 2: 900 });
    assert.equal((await pass(id, [1], { oldest: 800, newest: null }, 10)).gone, 1);
    assert.deepEqual(await displayed(id), [1]);
  } finally { delete process.env.GONE_AFTER_PASSES; }
});

test("si aucune des annonces attendues n'est revenue (3 ou plus), la lecture est suspecte : rien n'est enregistré", async () => {
  const id = await seed({ 1: 1000, 2: 900, 3: 800 });
  assert.deepEqual(await pass(id, [], { oldest: 700, newest: null }, 10), { expected: 3, missing: 0, gone: 0 });
  assert.deepEqual((await listingRows(id)).map(row => row.missedPasses), [0, 0, 0]);
  // Avec 2 annonces seulement, la même absence est prise au sérieux.
  const small = await seed({ 1: 1000, 2: 900 });
  assert.equal((await pass(small, [], { oldest: 700, newest: null }, 10)).missing, 2);
});

test("les annonces des autres sites et les annonces masquées ne sont pas concernées", async () => {
  const pap = await seed({ 1: 1000, 2: 900 }, "pap");
  assert.equal((await pass(pap, [], { oldest: 0, newest: null }, 10)).expected, 0);
  const id = await seed({ 1: 1000, 2: 900 });
  const { db } = await import("../../lib/database");
  await db().update(housingListings).set({ hidden: "room" }).where(and(eq(housingListings.searchId, id), eq(housingListings.url, urlOf(2))));
  assert.equal((await pass(id, [], { oldest: 0, newest: null }, 10)).expected, 1);
});

test("une annonce disparue ne compte plus dans les nouvelles annonces de la veille", async () => {
  const { unseenCountFor } = await import("./store").then(store => ({ unseenCountFor: async (id: number) => (await store.getSearch(id))!.unseenCount }));
  const id = await seed({ 1: 1000, 2: 900 });
  const { db } = await import("../../lib/database");
  await db().update(housingSearches).set({ watched: 1, lastVisitedAt: 0 }).where(eq(housingSearches.id, id));
  assert.equal(await unseenCountFor(id), 2);
  await pass(id, [1], { oldest: 800, newest: null }, 10);
  await pass(id, [1], { oldest: 800, newest: null }, 20);
  assert.equal(await unseenCountFor(id), 1);
});

// --- De bout en bout : passages de veille réels (faux Apify, vraie base, vrai worker) -----------------------------------------

async function runToCompletion(id: number) {
  const { createWorker } = await import("../../lib/worker");
  const { db } = await import("../../lib/database");
  const worker = createWorker({ owner: "test" });
  for (let i = 0; i < 12; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    if (row.status !== "running" && !row.task) return row;
  }
  throw new Error("La recherche ne se termine pas");
}
/** Un passage de la veille : l'heure du créneau est passée, le worker tourne jusqu'à la fin. */
async function watchPass(id: number) {
  const { db } = await import("../../lib/database");
  await db().update(housingSearches).set({ watched: 1, watchTimes: '["08:00"]', nextWatchAt: Date.now() - HOUR, lastVisitedAt: Date.now() })
    .where(eq(housingSearches.id, id));
  const { scheduleDueWatches } = await import("./store");
  await scheduleDueWatches();
  await new Promise(resolve => setTimeout(resolve, 5)); // deux passages ne partagent jamais la même milliseconde de départ
  return runToCompletion(id);
}

test("veille : une annonce supprimée du site disparaît au 2e passage ; une plus ancienne que la lecture reste, sauf VERIFY_DAYS", async () => {
  const { createSearch } = await import("./store");
  market.clear();
  const now = Date.now();
  for (let n = 1; n <= 12; n++) market.set(100 + n, now - n * 30 * 60_000);
  const id = await createSearch("Un T2 à Lille");
  assert.equal((await runToCompletion(id)).status, "completed");
  assert.equal((await displayed(id)).length, 12, "la première recherche lit la liste entière (12 < 15)");

  // 103 est supprimée du site : le passage lit les 10 plus récentes (101…111), elle manque dans la plage.
  market.delete(103);
  await watchPass(id);
  assert.equal((await rowOf(id, 103)).missedPasses, 1);
  assert.ok((await displayed(id)).includes(103), "toujours affichée après un seul passage");
  await watchPass(id);
  assert.ok(!(await displayed(id)).includes(103), "masquée au 2e passage");
  assert.equal((await displayed(id)).length, 11);

  // 112, la plus ancienne, est supprimée aussi : la lecture de 10 s'arrête avant elle, rien ne la vérifie.
  market.delete(112);
  await watchPass(id);
  await watchPass(id);
  await watchPass(id);
  assert.ok((await displayed(id)).includes(112), "hors de la plage lue : elle reste (limite connue)");

  // VERIFY_DAYS : on relit plus loin ; la liste est lue jusqu'à sa fin, 112 manque donc et disparaît en 2 passages.
  process.env.VERIFY_DAYS = "2";
  try {
    await watchPass(id);
    assert.equal((await rowOf(id, 112)).missedPasses, 1);
    await watchPass(id);
    assert.ok(!(await displayed(id)).includes(112));
    assert.equal((await displayed(id)).length, 10);
    assert.equal(apifyInputs.at(-1)!.limit, 35, "relecture de la page entière");
  } finally { delete process.env.VERIFY_DAYS; }

  // Une relève « ok » : lire plus loin pour vérifier ne la rend pas « partielle ».
  const [row] = await (await import("../../lib/database")).db().select().from(housingSearches).where(eq(housingSearches.id, id));
  assert.equal(row.lastWatchStatus, "ok");
});

test("veille : une annonce remontée (mise à jour récente) n'est pas prise pour une disparue", async () => {
  const { createSearch } = await import("./store");
  market.clear();
  const now = Date.now();
  for (let n = 1; n <= 12; n++) market.set(200 + n, now - n * 30 * 60_000);
  const id = await createSearch("Un T2 à Lille");
  await runToCompletion(id);
  market.set(205, now + 1000); // remontée en tête de liste
  await watchPass(id);
  await watchPass(id);
  assert.equal((await rowOf(id, 205)).missedPasses, 0);
  assert.ok((await displayed(id)).includes(205));
  assert.equal((await displayed(id)).length, 12);
});
