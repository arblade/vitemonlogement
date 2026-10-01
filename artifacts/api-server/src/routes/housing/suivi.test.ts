// Recherche en direct sur 4 jours, lecture page par page, recherche suivie (8 h / 18 h), « Étendre », analyse au défilement.
// Faux Le Bon Coin : un « marché » d'annonces datées, servi par pages de 35, de la plus récemment mise à jour à la plus ancienne.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { fatihRecord, leboncoinLabel } from "../../test/fatih";

const HOUR = 3_600_000;
type Ad = { n: number; postedAt: number; updatedAt: number; title?: string };
let market: Ad[] = [];
/** Pages demandées à l'acteur : { page, limit }. */
let reads: { page: number; limit: number }[] = [];
let llmListings = 0;
const runs = new Map<string, unknown[]>();
let fake: Server;

const record = (ad: Ad) => fatihRecord({
  url: `https://www.leboncoin.fr/ad/locations/${ad.n}`, title: ad.title ?? `Appartement T2 n° ${ad.n}`, description: "Appartement lumineux, proche métro.",
  price: 650, area: 40, rooms: 2, postedAt: leboncoinLabel(ad.postedAt), updatedAt: leboncoinLabel(ad.updatedAt),
});
/** Une annonce toutes les `everyHours` heures, la plus récente il y a 10 minutes. */
const makeMarket = (count: number, everyHours: number, start = 1) => Array.from({ length: count }, (_, i) => {
  const at = Date.now() - 10 * 60_000 - i * everyHours * HOUR;
  return { n: start + i, postedAt: at, updatedAt: at };
});
const sorted = () => [...market].sort((a, b) => b.updatedAt - a.updatedAt);

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
        reads.push({ page, limit: input.limit });
        const id = `run-${runs.size + 1}`;
        runs.set(id, sorted().slice((page - 1) * 35, (page - 1) * 35 + input.limit).map(record));
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
          const { listings } = JSON.parse(request.messages[1].content) as { listings: { id: number; title: string; wantGeneral: boolean }[] };
          llmListings += listings.length;
          content = { items: listings.map(item => ({ id: item.id, checks: [], ...(item.wantGeneral ? {
            summary: "Logement lumineux.", summaryEvidence: ["Appartement lumineux"], features: [],
            ...(item.title.includes("Coliving") ? { offer: "room", offerEvidence: "Coliving" } : { offer: "entire", offerEvidence: "" }),
          } : {}) })) };
        }
        return json({ id: "x", object: "chat.completion", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.APIFY_BASE_URL = origin;
  process.env.APIFY_TOKEN = "test";
  process.env.OPENAI_BASE_URL = `${origin}/v1`;
  process.env.OPENAI_API_KEY = "test";
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
});
after(async () => {
  fake.close();
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});
beforeEach(() => { reads = []; llmListings = 0; });

/** Fait tourner le worker jusqu'à ce que la recherche soit terminée et sans tâche. */
async function settle(id: number) {
  const { createWorker } = await import("../../lib/worker");
  const { db } = await import("../../lib/database");
  const worker = createWorker({ owner: "test" });
  for (let i = 0; i < 20; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    if (row.status !== "running" && !row.task) return row;
  }
  throw new Error("La recherche ne se termine pas");
}
const row = async (id: number) => {
  const { db } = await import("../../lib/database");
  return (await db().select().from(housingSearches).where(eq(housingSearches.id, id)))[0];
};
const setRow = async (id: number, fields: Partial<typeof housingSearches.$inferInsert>) => {
  const { db } = await import("../../lib/database");
  await db().update(housingSearches).set(fields).where(eq(housingSearches.id, id));
};

test("première recherche : page 1 (35), puis page 2 tant que les 4 jours ne sont pas atteints ; les 10 premières analysées, les autres plus tard", async () => {
  market = makeMarket(120, 2); // une annonce toutes les 2 h : 4 jours ≈ 48 annonces
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  const done = await settle(id);
  assert.equal(done.status, "completed");
  assert.deepEqual(reads, [{ page: 1, limit: 35 }, { page: 2, limit: 35 }], "la page 2 atteint 4 jours : on s'arrête");
  const search = (await getSearch(id))!;
  assert.equal(search.listings.length, 70, "tout ce qui est lu (et payé) est gardé");
  assert.equal(search.listings.filter(listing => listing.analyzed).length, 10, "seules les 10 premières sont analysées d'emblée");
  assert.equal(llmListings, 10);
  assert.ok(search.listings.slice(0, 10).every(listing => listing.analyzed && listing.aiSummary), "les plus récentes d'abord");
  // Dates : heure de Paris relue correctement (la plus récente a 10 minutes).
  assert.ok(Math.abs(search.listings[0].refreshedAt! - (Date.now() - 10 * 60_000)) < 2 * 60_000);
  assert.equal(done.pagesRead, 2);
  assert.ok(Math.abs(done.cursorAt! - search.listings[0].refreshedAt!) < 1000, "curseur : la mise à jour la plus récente lue");
});

test("première recherche : au plus 3 pages (105 annonces), même si 4 jours ne sont pas atteints", async () => {
  market = makeMarket(200, 0.5); // très active : une annonce toutes les 30 min
  const { createSearch } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  await settle(id);
  assert.deepEqual(reads.map(read => read.page), [1, 2, 3]);
});

test("petite ville : une seule page suffit (moins de 35 annonces)", async () => {
  market = makeMarket(12, 3);
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  await settle(id);
  assert.deepEqual(reads, [{ page: 1, limit: 35 }]);
  assert.equal((await getSearch(id))!.listings.length, 12);
});

test("recherche suivie : le passage lit juste ce qu'il faut et s'arrête au curseur ; une annonce remontée n'est pas « nouvelle »", async () => {
  market = makeMarket(30, 3, 1000);
  const { createSearch, getSearch, scheduleDueWatches } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  await settle(id);
  // Suivie juste après la première lecture (comme startWatching : ce qui est affiché compte comme vu), passage dû.
  await setRow(id, { watched: 1, watchTimes: JSON.stringify(["08:00", "18:00"]), nextWatchAt: Date.now() - 1000, lastVisitedAt: Date.now() });
  assert.equal((await getSearch(id))!.unseenCount, 0, "ce qui était affiché compte comme vu");

  // 4 nouvelles annonces et une ancienne remontée en tête depuis le passage précédent.
  const now = Date.now();
  market = [...makeMarket(4, 0.2, 2000).map(ad => ({ ...ad, postedAt: now - 60_000, updatedAt: now - 60_000 })), ...market];
  market[market.length - 1] = { ...market[market.length - 1], updatedAt: now - 30_000 };
  reads = [];
  await scheduleDueWatches();
  assert.equal((await row(id)).task, "watch");
  await settle(id);
  assert.equal(reads.length, 1, "une seule lecture : le curseur est atteint dans la première page");
  assert.ok(reads[0].limit < 35 && reads[0].limit >= 10, `première page à la taille du débit observé (${reads[0].limit})`);
  const search = (await getSearch(id))!;
  assert.equal(search.unseenCount, 4, "4 nouvelles ; la remontée n'en est pas une");
  assert.ok((await row(id)).nextWatchAt! > Date.now(), "prochain passage programmé");
  await setRow(id, { lastVisitedAt: Date.now() }); // ouverture de la recherche (markVisited, testé par l'API)
  assert.equal((await getSearch(id))!.unseenCount, 0, "ouverte : plus rien de non vu");
});

test("recherche suivie : plus de nouveautés que prévu → la page 1 est relue en entier, puis la page 2 si besoin", async () => {
  market = makeMarket(20, 6, 3000);
  const { createSearch, getSearch, scheduleDueWatches } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  await settle(id);
  await setRow(id, { watched: 1, watchTimes: JSON.stringify(["08:00"]), nextWatchAt: Date.now() - 1000, lastVisitedAt: Date.now(), watchRate: 0.5 });
  const now = Date.now();
  market = [...Array.from({ length: 50 }, (_, i) => ({ n: 4000 + i, postedAt: now - i * 5_000, updatedAt: now - i * 5_000 })), ...market];
  reads = [];
  await scheduleDueWatches();
  await settle(id);
  assert.equal(reads[0].page, 1);
  assert.ok(reads[0].limit < 35);
  assert.deepEqual(reads.slice(1), [{ page: 1, limit: 35 }, { page: 2, limit: 35 }]);
  assert.equal((await getSearch(id))!.unseenCount, 50, "aucune nouveauté perdue");
});

test("recherche suivie : sans visite depuis 7 jours, elle se met en pause et ne coûte plus rien", async () => {
  market = makeMarket(5, 3, 5000);
  const { createSearch, scheduleDueWatches } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  await settle(id);
  await setRow(id, { watched: 1, watchTimes: JSON.stringify(["08:00"]), nextWatchAt: Date.now() - 1000, lastVisitedAt: Date.now() - 8 * 24 * HOUR });
  reads = [];
  await scheduleDueWatches();
  const paused = await row(id);
  assert.equal(paused.watched, 2);
  assert.equal(paused.task, null);
  assert.equal(reads.length, 0);
});

test("passage manqué (serveur arrêté) : un seul rattrapage, puis le créneau suivant", async () => {
  market = makeMarket(5, 3, 6000);
  const { createSearch, scheduleDueWatches } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  await settle(id);
  await setRow(id, { watched: 1, watchTimes: JSON.stringify(["08:00", "18:00"]), nextWatchAt: Date.now() - 3 * 24 * HOUR, lastVisitedAt: Date.now() });
  await scheduleDueWatches();
  await settle(id);
  const after = await row(id);
  assert.ok(after.nextWatchAt! > Date.now() && after.nextWatchAt! < Date.now() + 24 * HOUR, "prochain créneau, pas les passages manqués");
  await scheduleDueWatches();
  assert.equal((await row(id)).task, null, "pas de second passage");
});

test("une seule recherche suivie par compte : en suivre une autre arrête la première", async () => {
  const { createUser } = await import("../../lib/users");
  const user = (await createUser("suivi@example.com", "motdepasse-1"))!;
  const { createSearch, startWatching, watchedSearch } = await import("./store");
  const first = await createSearch("Un T2 à Lille, 900 € max", user.id);
  const second = await createSearch("Un T3 à Lille, 1 100 € max", user.id);
  await setRow(first, { status: "completed" });
  await setRow(second, { status: "completed" });
  await startWatching(first, user.id, ["08:00"], Date.now() + HOUR);
  await startWatching(second, user.id, ["08:00", "18:00"], Date.now() + HOUR);
  assert.equal((await row(first)).watched, 0);
  assert.equal((await row(second)).watched, 1);
  assert.equal((await watchedSearch(user.id))?.id, second);
});

test("analyse au défilement : seules les annonces demandées sont analysées, une fois ; une colocation repérée par l'IA disparaît", async () => {
  market = makeMarket(30, 2, 7000);
  market[15] = { ...market[15], title: "Studio privatif en résidence Coliving" };
  const { createSearch, getSearch, requestAnalysis } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  await settle(id);
  const before = (await getSearch(id))!;
  const pending = before.listings.filter(listing => !listing.analyzed);
  assert.equal(pending.length, 20);
  llmListings = 0;
  assert.equal(await requestAnalysis(id, [...pending.slice(0, 8).map(listing => listing.id), before.listings[0].id, 999_999]), 8, "déjà analysée ou étrangère : ignorée");
  assert.equal((await row(id)).task, "analyze");
  await settle(id);
  const after = (await getSearch(id))!;
  assert.equal(llmListings, 8);
  // Les 8 demandées (dont la résidence coliving, 16e annonce) : 7 gardées et analysées, 1 masquée.
  assert.equal(after.listings.filter(listing => listing.analyzed).length, 17);
  assert.equal(after.listings.find(listing => listing.title.includes("Coliving")), undefined, "masquée après analyse");
  assert.equal(after.count, 29);
});

test("« Étendre » : une seule page, la suivante (plus ancienne)", async () => {
  market = makeMarket(120, 2, 8000);
  const { createSearch, getSearch, requestExtend } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  await settle(id);
  reads = [];
  assert.ok(await requestExtend(id));
  assert.equal(await requestExtend(id), false, "pas deux lectures à la fois");
  await settle(id);
  assert.deepEqual(reads, [{ page: 3, limit: 35 }]);
  assert.equal((await getSearch(id))!.listings.length, 105);
  assert.equal((await row(id)).pagesRead, 3);
});
