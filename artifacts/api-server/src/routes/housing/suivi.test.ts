// Recherche en direct sur 4 jours, lecture page par page, veille quotidienne (8 h / 18 h), « Étendre », analyse au défilement.
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
/** Pannes simulées : runs Apify en échec à partir de cette page ; IA refusée (clé invalide) pour les analyses. */
let failFromPage: number | null = null;
let llmDown = false;
const failedRuns = new Set<string>();
/** E-mails reçus par le faux Resend, et statuts à renvoyer (un par appel, puis 200). */
type SentMail = { body: { from: string; to: string[]; subject: string; html: string; text: string; headers?: Record<string, string> }; idempotencyKey: string | undefined; authorization: string | undefined };
let mails: SentMail[] = [];
let resendStatuses: number[] = [];
let fake: Server;
let owner = 0;

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
        if (failFromPage != null && page >= failFromPage) failedRuns.add(id);
        return json({ data: { id } });
      }
      const run = url.match(/^\/v2\/actor-runs\/(run-\d+)/);
      if (run) return json({ data: { status: failedRuns.has(run[1]) ? "FAILED" : "SUCCEEDED", defaultDatasetId: run[1] } });
      if (req.method === "POST" && url === "/emails") {
        mails.push({ body: JSON.parse(body), idempotencyKey: req.headers["idempotency-key"] as string | undefined, authorization: req.headers.authorization });
        const status = resendStatuses.shift() ?? 200;
        res.statusCode = status;
        return json(status === 200 ? { id: `mail-${mails.length}` } : { name: "internal_server_error", message: "Panne simulée" });
      }
      const dataset = url.match(/^\/v2\/datasets\/(run-\d+)\/items/);
      if (dataset) return json(runs.get(dataset[1]) ?? []);
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        let content: unknown;
        if (request.messages[0].content.includes("Interprète une demande")) {
          content = { location: "Lille", intent: "rent", maxPrice: 900, radius: 5, keywords: "", uncertainChecks: [], places: [] };
        } else if (llmDown) {
          res.statusCode = 401;
          return json({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } });
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
  process.env.RESEND_BASE_URL = origin;
  process.env.PUBLIC_URL = "https://vitemonlogement.fr";
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
  const { createUser } = await import("../../lib/users");
  owner = (await createUser("suivi-lecture@example.com", "motdepasse-1"))!.id;
});
after(async () => {
  fake.close();
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});
beforeEach(() => {
  reads = []; llmListings = 0; failFromPage = null; llmDown = false; mails = []; resendStatuses = [];
  // E-mails : faux Resend ; chaque test qui en a besoin pose la clé.
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERT_EMAIL;
});

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

/** Recherche ponctuelle terminée (15 annonces), puis transformée en veille quotidienne et remontée sur 4 jours. */
async function followed(times = ["08:00", "18:00"]) {
  const { createSearch, startWatching } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max", owner);
  await settle(id);
  await startWatching(id, owner, times, Date.now() + HOUR);
  return id;
}

test("recherche ponctuelle : les 15 annonces les plus récentes, en une seule lecture, toutes analysées", async () => {
  market = makeMarket(120, 2);
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max", owner);
  const done = await settle(id);
  assert.equal(done.status, "completed");
  assert.deepEqual(reads, [{ page: 1, limit: 15 }]);
  const search = (await getSearch(id))!;
  assert.equal(search.listings.length, 15);
  assert.ok(search.listings.every(listing => listing.analyzed && listing.aiSummary), "15 ≤ 20 : toutes analysées d'emblée");
  assert.equal(llmListings, 15);
  // Dates : heure de Paris relue correctement (la plus récente a 10 minutes) ; ordre : les plus récentes d'abord.
  assert.ok(Math.abs(search.listings[0].refreshedAt! - (Date.now() - 10 * 60_000)) < 2 * 60_000);
  assert.equal(done.pagesRead, 0, "page lue en partie : « Étendre » la relira en entier");
  assert.ok(Math.abs(done.cursorAt! - search.listings[0].refreshedAt!) < 1000, "curseur : la mise à jour la plus récente lue");
});

test("création de la veille quotidienne : elle remonte 4 jours (page 1, puis juste ce qu'il faut de la page 2), sans compter ces annonces comme nouvelles", async () => {
  market = makeMarket(120, 2); // une annonce toutes les 2 h : 4 jours ≈ 48 annonces
  const id = await followed();
  assert.equal((await row(id)).task, "backfill");
  reads = []; llmListings = 0;
  await settle(id);
  // Page 1 : 35 annonces sur 68 h ; il reste ≈ 28 h jusqu'aux 4 jours, soit ≈ 14 annonces, + 30 % : 19, pas toute la page.
  assert.deepEqual(reads, [{ page: 1, limit: 35 }, { page: 2, limit: 19 }], "la page 2 atteint 4 jours : on s'arrête");
  const { getSearch } = await import("./store");
  const search = (await getSearch(id))!;
  assert.equal(search.listings.length, 54, "tout ce qui est lu (et payé) est gardé, sans doublon avec les 15 déjà là");
  assert.equal(llmListings, 20, "20 analysées d'emblée, les autres au défilement");
  assert.equal(search.listings.filter(listing => listing.analyzed).length, 35);
  assert.equal(search.unseenCount, 0, "l'utilisateur vient de la créer : rien de « nouveau »");
  assert.equal((await row(id)).pagesRead, 1, "la page 2, lue en partie, n'est pas comptée : « Étendre » la lirait en entier");
});

test("création de la veille quotidienne : au plus 3 pages (105 annonces), même si 4 jours ne sont pas atteints", async () => {
  market = makeMarket(200, 0.5); // très active : une annonce toutes les 30 min
  const id = await followed();
  reads = [];
  await settle(id);
  assert.deepEqual(reads.map(read => read.page), [1, 2, 3]);
});

test("petite ville : 12 annonces en tout, une seule page à chaque fois", async () => {
  market = makeMarket(12, 3);
  const id = await followed();
  assert.deepEqual(reads, [{ page: 1, limit: 15 }]);
  reads = [];
  await settle(id);
  assert.deepEqual(reads, [{ page: 1, limit: 35 }]);
  const { getSearch } = await import("./store");
  assert.equal((await getSearch(id))!.listings.length, 12);
});

test("passage suivi : lit juste ce qu'il faut, s'arrête au curseur ; une annonce remontée n'est pas « nouvelle » (ni plus tard)", async () => {
  market = makeMarket(30, 3, 1000);
  const id = await followed();
  await settle(id);
  const { getSearch, scheduleDueWatches } = await import("./store");
  // 4 nouvelles annonces ; une ancienne remontée en tête par son auteur.
  const now = Date.now();
  market = [...makeMarket(4, 0.2, 2000).map(ad => ({ ...ad, postedAt: now - 60_000, updatedAt: now - 60_000 })), ...market];
  const bumped = market[market.length - 1];
  market[market.length - 1] = { ...bumped, updatedAt: now - 30_000 };
  await setRow(id, { nextWatchAt: Date.now() - 1000 });
  reads = [];
  await scheduleDueWatches();
  assert.equal((await row(id)).task, "watch");
  await settle(id);
  assert.equal(reads.length, 1, "une seule lecture : le curseur est atteint dans la première page");
  assert.ok(reads[0].limit < 35 && reads[0].limit >= 10, `première page à la taille du débit observé (${reads[0].limit})`);
  let search = (await getSearch(id))!;
  assert.equal(search.unseenCount, 4, "4 nouvelles ; la remontée n'en est pas une");
  assert.deepEqual(search.listings.slice(0, 4).map(listing => listing.title).sort(), ["Appartement T2 n° 2000", "Appartement T2 n° 2001", "Appartement T2 n° 2002", "Appartement T2 n° 2003"],
    "les nouvelles en tête ; la remontée ne repasse pas devant");
  assert.ok((await row(id)).nextWatchAt! > Date.now(), "prochain passage programmé");
  // Heure de la relève : exactement la première lecture de ses annonces (le séparateur de la liste s'appuie dessus).
  const lastWatchAt = (await row(id)).lastWatchAt!;
  assert.ok(lastWatchAt > 0);
  assert.deepEqual(new Set(search.listings.filter(listing => listing.firstSeenAt! >= lastWatchAt).map(listing => listing.title)),
    new Set(["Appartement T2 n° 2000", "Appartement T2 n° 2001", "Appartement T2 n° 2002", "Appartement T2 n° 2003"]));
  // Passage suivant : la même annonce remontée encore une fois ne devient toujours pas nouvelle.
  await setRow(id, { lastVisitedAt: Date.now() });
  market[market.length - 1] = { ...bumped, updatedAt: Date.now() - 5_000 };
  await setRow(id, { nextWatchAt: Date.now() - 1000 });
  await scheduleDueWatches();
  await settle(id);
  search = (await getSearch(id))!;
  assert.equal(search.unseenCount, 0);
});

test("annonce supprimée puis republiée (nouvelle adresse, même contenu) : pas « nouvelle », le lien suit la nouvelle adresse", async () => {
  market = makeMarket(20, 3, 2500);
  const id = await followed();
  await settle(id);
  const { getSearch, scheduleDueWatches } = await import("./store");
  const gone = market[3];
  market = [{ ...gone, n: 2999, title: `Appartement T2 n° ${gone.n}`, postedAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000 }, ...market.filter(ad => ad !== gone)];
  await setRow(id, { nextWatchAt: Date.now() - 1000, lastVisitedAt: Date.now() });
  await scheduleDueWatches();
  await settle(id);
  const search = (await getSearch(id))!;
  assert.equal(search.unseenCount, 0, "republiée : pas nouvelle");
  assert.equal(search.listings.length, 20, "pas de doublon");
  assert.ok(search.listings.some(listing => listing.url.endsWith("/2999")), "le lien mène à la nouvelle annonce");
  assert.ok(!search.listings.some(listing => listing.url.endsWith(`/${gone.n}`)));
});

test("deux studios identiques d'une même résidence, lus ensemble : deux annonces, toutes deux nouvelles", async () => {
  market = makeMarket(10, 3, 2700);
  const id = await followed();
  await settle(id);
  const { getSearch, scheduleDueWatches } = await import("./store");
  const now = Date.now();
  market = [{ n: 2790, postedAt: now - 60_000, updatedAt: now - 60_000, title: "Studio résidence Gambetta" }, { n: 2791, postedAt: now - 50_000, updatedAt: now - 50_000, title: "Studio résidence Gambetta" }, ...market];
  await setRow(id, { nextWatchAt: Date.now() - 1000, lastVisitedAt: Date.now() });
  await scheduleDueWatches();
  await settle(id);
  assert.equal((await getSearch(id))!.unseenCount, 2);
});

test("passage suivi : plus de nouveautés que prévu → la page 1 est relue en entier, puis la page 2 si besoin", async () => {
  market = makeMarket(20, 6, 3000);
  const id = await followed(["08:00"]);
  await settle(id);
  const { getSearch, scheduleDueWatches } = await import("./store");
  await setRow(id, { nextWatchAt: Date.now() - 1000, lastVisitedAt: Date.now(), watchRate: 0.5 });
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

test("veille quotidienne : sans visite depuis 7 jours, elle se met en pause et ne coûte plus rien", async () => {
  market = makeMarket(5, 3, 5000);
  const id = await followed(["08:00"]);
  await settle(id);
  const { scheduleDueWatches } = await import("./store");
  await setRow(id, { nextWatchAt: Date.now() - 1000, lastVisitedAt: Date.now() - 8 * 24 * HOUR });
  reads = [];
  await scheduleDueWatches();
  const paused = await row(id);
  assert.equal(paused.watched, 2);
  assert.equal(paused.task, null);
  assert.equal(reads.length, 0);
});

test("passage manqué (serveur arrêté) : un seul rattrapage, puis le créneau suivant", async () => {
  market = makeMarket(5, 3, 6000);
  const id = await followed();
  await settle(id);
  const { scheduleDueWatches } = await import("./store");
  await setRow(id, { nextWatchAt: Date.now() - 3 * 24 * HOUR, lastVisitedAt: Date.now() });
  await scheduleDueWatches();
  await settle(id);
  const after = await row(id);
  assert.ok(after.nextWatchAt! > Date.now() && after.nextWatchAt! < Date.now() + 24 * HOUR, "prochain créneau, pas les passages manqués");
  await scheduleDueWatches();
  assert.equal((await row(id)).task, null, "pas de second passage");
});

test("une seule veille quotidienne par compte : en suivre une autre arrête la première", async () => {
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
  market = makeMarket(60, 1, 7000);
  market[55] = { ...market[55], title: "Studio privatif en résidence Coliving" };
  const id = await followed();
  await settle(id);
  const { getSearch, requestAnalysis } = await import("./store");
  const before = (await getSearch(id))!;
  const pending = before.listings.filter(listing => !listing.analyzed);
  assert.equal(pending.length, 25, "60 lues : 15 + 20 analysées d'emblée");
  const coliving = pending.find(listing => listing.title.includes("Coliving"))!;
  assert.ok(coliving, "la résidence coliving fait partie des annonces pas encore analysées");
  llmListings = 0;
  const asked = [...pending.filter(listing => listing !== coliving).slice(0, 7).map(listing => listing.id), coliving.id];
  assert.equal(await requestAnalysis(id, [...asked, before.listings[0].id, 999_999]), 8, "déjà analysée ou étrangère : ignorée");
  assert.equal((await row(id)).task, "analyze");
  await settle(id);
  const after = (await getSearch(id))!;
  assert.equal(llmListings, 8);
  assert.equal(after.listings.filter(listing => listing.analyzed).length, 35 + 7);
  assert.equal(after.listings.find(listing => listing.title.includes("Coliving")), undefined, "masquée après analyse");
  assert.equal(after.count, 59);
});

test("« Étendre » sur une recherche ponctuelle : la page 1 en entier, puis la page 2", async () => {
  market = makeMarket(120, 2, 8000);
  const { createSearch, getSearch, requestExtend } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max", owner);
  await settle(id);
  reads = [];
  assert.ok(await requestExtend(id));
  assert.equal(await requestExtend(id), false, "pas deux lectures à la fois");
  await settle(id);
  assert.ok(await requestExtend(id));
  await settle(id);
  assert.deepEqual(reads, [{ page: 1, limit: 35 }, { page: 2, limit: 35 }]);
  assert.equal((await getSearch(id))!.listings.length, 70);
  assert.equal((await row(id)).pagesRead, 2);
});

// --- Lecture au plus juste, pannes, état de la relève --------------------------------------------------------------

/** Veille quotidienne dont le dernier passage date d'environ `hoursAgo` heures (marché ancien, puis curseur). */
async function watchedSince(hoursAgo: number, start: number, watchRate: number) {
  market = makeMarket(20, 6, start).map(ad => ({ ...ad, postedAt: ad.postedAt - hoursAgo * HOUR, updatedAt: ad.updatedAt - hoursAgo * HOUR }));
  const id = await followed(["08:00"]);
  await settle(id);
  await setRow(id, { nextWatchAt: Date.now() - 1000, lastVisitedAt: Date.now(), watchRate });
  return id;
}
/** `count` nouvelles annonces, une toutes les `everyMinutes` minutes, la plus récente il y a une minute. */
const arrivals = (count: number, everyMinutes: number, start: number, title?: (i: number) => string) => Array.from({ length: count }, (_, i) => {
  const at = Date.now() - 60_000 - i * everyMinutes * 60_000;
  return { n: start + i, postedAt: at, updatedAt: at, ...(title ? { title: title(i) } : {}) };
});
/** Une relève : l'heure est passée, le worker la fait. */
async function pass(id: number) {
  const { scheduleDueWatches } = await import("./store");
  await setRow(id, { nextWatchAt: Date.now() - 1000 });
  reads = [];
  await scheduleDueWatches();
  return settle(id);
}

test("relève : plus de 30 annonces attendues → la page entière d'emblée, jamais lue en partie puis relue", async () => {
  const id = await watchedSince(3, 10_000, 8); // 8 par heure depuis ≈ 3 h 10, + 30 % : ≈ 33 attendues
  market = [...arrivals(30, 4, 10_100), ...market];
  await pass(id);
  assert.deepEqual(reads, [{ page: 1, limit: 35 }]);
  const { getSearch } = await import("./store");
  assert.equal((await getSearch(id))!.unseenCount, 30);
});

test("relève : une page relue en entier n'est pas comptée deux fois dans le débit observé", async () => {
  const id = await watchedSince(3, 11_000, 0.5); // débit sous-estimé : 10 lues, il en faut plus
  const cursor = (await row(id)).cursorAt!;
  market = [...arrivals(30, 4, 11_100), ...market];
  await pass(id);
  assert.deepEqual(reads, [{ page: 1, limit: 10 }, { page: 1, limit: 35 }]);
  const after = await row(id);
  const expected = 30 / ((after.lastWatchAt! - cursor) / HOUR); // 30 nouvelles depuis le curseur, pas 40
  assert.ok(Math.abs(after.watchRate! - expected) < 0.3, `débit ${after.watchRate} ≠ ${expected}`);
});

test("relève : la page 2 n'est lue que pour ce qu'il reste jusqu'au curseur", async () => {
  const id = await watchedSince(3, 12_000, 20);
  market = [...arrivals(45, 4, 12_100), ...market]; // la page 1 couvre ≈ 2 h 20 ; il reste ≈ 50 min, ≈ 13 annonces
  await pass(id);
  assert.equal(reads.length, 2);
  assert.deepEqual(reads[0], { page: 1, limit: 35 });
  assert.equal(reads[1].page, 2);
  assert.ok(reads[1].limit >= 10 && reads[1].limit < 35, `page 2 : ${reads[1].limit} annonces, pas toute la page`);
  const { getSearch } = await import("./store");
  assert.equal((await getSearch(id))!.unseenCount, 45, "aucune nouveauté perdue");
  assert.equal((await row(id)).lastWatchStatus, "ok");
});

test("panne de l'IA pendant une relève : la lecture est gardée (curseur, heure, état), les annonces seront analysées à l'affichage", async () => {
  const id = await watchedSince(3, 13_000, 2);
  const before = await row(id);
  market = [...arrivals(5, 10, 13_100), ...market];
  llmDown = true;
  await pass(id);
  const after = await row(id);
  assert.equal(after.task, null);
  assert.equal(after.lastWatchStatus, "ok");
  assert.ok(after.cursorAt! > before.cursorAt!, "le curseur avance : le passage suivant ne relira pas ces pages");
  assert.ok(after.lastWatchAt! > 0);
  assert.ok(after.nextWatchAt! > Date.now());
  const { getSearch } = await import("./store");
  const search = (await getSearch(id))!;
  assert.equal(search.unseenCount, 5);
  assert.equal(search.listings.filter(listing => listing.firstSeenAt === after.lastWatchAt && listing.analyzed === false).length, 5);
});

test("relève arrêtée au plafond de 3 pages : « partielle » (des annonces ont pu échapper), le débit ne baisse pas", async () => {
  const id = await watchedSince(72, 14_000, 1);
  market = [...arrivals(150, 20, 14_100), ...market];
  await pass(id);
  assert.deepEqual(reads.map(read => read.page), [1, 2, 3]);
  const after = await row(id);
  assert.equal(after.lastWatchStatus, "partial");
  assert.ok(after.watchRate! >= 1);
  const { getSearch } = await import("./store");
  assert.equal((await getSearch(id))!.lastWatchStatus, "partial", "exposé au navigateur");
});

test("page suivante en échec : les pages lues sont gardées, la relève est « partielle »", async () => {
  const id = await watchedSince(48, 15_000, 3);
  market = [...arrivals(80, 20, 15_100), ...market];
  failFromPage = 2;
  await pass(id);
  assert.deepEqual(reads.map(read => read.page), [1, 2]);
  assert.equal((await row(id)).lastWatchStatus, "partial");
  const { getSearch } = await import("./store");
  assert.equal((await getSearch(id))!.unseenCount, 35);
});

test("relève en échec : dite sur la page, reprogrammée ; au 3e échec d'affilée, le propriétaire du site est prévenu une fois", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.ALERT_EMAIL = "admin@example.com";
  const id = await watchedSince(3, 16_000, 2);
  failFromPage = 1;
  await pass(id);
  let after = await row(id);
  assert.equal(after.lastWatchStatus, "failed");
  assert.equal(after.watchFailures, 1);
  assert.ok(after.nextWatchAt! > Date.now(), "nouvel essai au créneau suivant");
  assert.equal(mails.length, 0);
  await pass(id);
  await pass(id);
  assert.equal((await row(id)).watchFailures, 3);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].body.to, ["admin@example.com"]);
  assert.match(mails[0].body.subject, /3 relèves en échec/);
  await pass(id);
  assert.equal(mails.length, 1, "une seule alerte par série d'échecs");
  failFromPage = null;
  market = [...arrivals(2, 10, 16_100), ...market];
  await pass(id);
  after = await row(id);
  assert.equal(after.lastWatchStatus, "ok");
  assert.equal(after.watchFailures, 0, "une relève réussie remet le compteur à zéro");
});

// --- E-mails de la veille quotidienne (faux Resend) -----------------------------------------------------------------

test("relève avec du nouveau : un e-mail récapitulatif à l'adresse du compte (5 annonces au plus, liens vers le site)", async () => {
  process.env.RESEND_API_KEY = "re_test";
  const id = await watchedSince(3, 17_000, 2);
  market = [...arrivals(7, 10, 17_100), ...market];
  await pass(id);
  assert.equal(mails.length, 1);
  const [mail] = mails;
  const after = await row(id);
  assert.deepEqual(mail.body.to, ["suivi-lecture@example.com"]);
  assert.equal(mail.body.from, "Vite mon logement <alertes@vitemonlogement.fr>");
  assert.equal(mail.authorization, "Bearer re_test");
  assert.equal(mail.idempotencyKey, `watch:${id}:${after.lastWatchAt}`, "même relève, même clé : jamais deux e-mails");
  assert.equal(mail.body.subject, "7 nouveaux logements à Lille");
  assert.ok(mail.body.html.includes(`https://vitemonlogement.fr/searches/${id}`));
  assert.ok(mail.body.html.includes("Voir les 7 nouveautés"));
  assert.ok(mail.body.html.includes("Et 2 autres sur le site."));
  assert.ok(mail.body.html.includes("Logement lumineux."), "le résumé de l'IA");
  assert.equal((mail.body.html.match(/Appartement T2 n° 171\d\d/g) ?? []).length, 5, "5 annonces montrées, pas 7");
  assert.match(mail.body.text, /Relève de \d{1,2} h/);
  assert.match(mail.body.headers!["List-Unsubscribe"], /^<https:\/\/vitemonlogement\.fr\/api\/mail\/unsubscribe\?u=\d+&t=[\w-]+>$/);
  assert.equal(mail.body.headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  // Relève suivante sans rien de nouveau : pas d'e-mail.
  await pass(id);
  assert.equal(mails.length, 1);
});

test("désinscrit des e-mails : plus d'e-mail, la veille continue ; réinscrit : les e-mails reprennent", async () => {
  process.env.RESEND_API_KEY = "re_test";
  const { setMailOptOut } = await import("../../lib/mail-outbox");
  const id = await watchedSince(3, 18_000, 2);
  await setMailOptOut(owner, true);
  market = [...arrivals(2, 10, 18_100), ...market];
  await pass(id);
  assert.equal(mails.length, 0);
  const { getSearch } = await import("./store");
  assert.equal((await getSearch(id))!.unseenCount, 2, "la pastille du site, elle, continue");
  await setMailOptOut(owner, false);
  market = [...arrivals(1, 10, 18_200), ...market];
  await pass(id);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].body.subject, "1 nouveau logement à Lille");
});

test("Resend en panne : nouvel essai plus tard avec la même clé, jamais deux e-mails", async () => {
  process.env.RESEND_API_KEY = "re_test";
  const { processOutbox } = await import("../../lib/mail-outbox");
  const id = await watchedSince(3, 19_000, 2);
  market = [...arrivals(2, 10, 19_100), ...market];
  resendStatuses = [500];
  await pass(id);
  assert.equal(mails.length, 1, "premier essai refusé");
  assert.equal(await processOutbox(Date.now()), 0, "pas tout de suite");
  assert.equal(await processOutbox(Date.now() + 61_000), 1);
  assert.equal(mails.length, 2);
  assert.equal(mails[1].idempotencyKey, mails[0].idempotencyKey);
  assert.equal(await processOutbox(Date.now() + 3 * HOUR), 0, "envoyé : plus rien à faire");
  assert.equal(mails.length, 2);
});

test("sans clé Resend : rien ne part, le site fonctionne pareil", async () => {
  const { db } = await import("../../lib/database");
  const { mailOutbox } = await import("@workspace/db");
  const id = await watchedSince(3, 20_000, 2);
  market = [...arrivals(2, 10, 20_100), ...market];
  await pass(id);
  assert.equal(mails.length, 0);
  const [queued] = await db().select().from(mailOutbox).where(eq(mailOutbox.key, `watch:${id}:${(await row(id)).lastWatchAt}`));
  assert.equal(queued.status, "skipped");
  assert.equal(queued.error, "RESEND_API_KEY absente");
});

test("mise en pause faute de visite : un e-mail pour la reprendre", async () => {
  process.env.RESEND_API_KEY = "re_test";
  const { scheduleDueWatches } = await import("./store");
  const { processOutbox } = await import("../../lib/mail-outbox");
  const id = await watchedSince(3, 21_000, 2);
  await setRow(id, { lastVisitedAt: Date.now() - 8 * 24 * HOUR });
  await scheduleDueWatches();
  assert.equal((await row(id)).watched, 2);
  await processOutbox();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].body.subject, "Votre veille quotidienne à Lille est en pause");
  assert.ok(mails[0].body.html.includes(`https://vitemonlogement.fr/searches/${id}`));
  assert.ok(mails[0].body.html.includes("Reprendre ma veille"));
});
