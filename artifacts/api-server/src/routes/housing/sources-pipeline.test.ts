import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";

// Bout en bout, piloté par le vrai worker : Le Bon Coin, SeLoger et PAP lancés ensemble, annonces mélangées,
// location uniquement. Faux serveurs Apify et OpenAI locaux.
const sample = (name: string) => JSON.parse(readFileSync(new URL(`../../test/${name}`, import.meta.url), "utf8")) as Record<string, unknown>[];
const pap = sample("pap-sample.json");
const seloger = sample("seloger-sample.json");
const lbc = [1, 2, 3].map(n => ({
  url: `https://www.leboncoin.fr/ad/locations/77${n}`, subject: `Appartement T2 Lille ${n}`, body: `Appartement T2 ${n}, loyer charges comprises.`,
  price_euros: 600 + n * 10, square: 40 + n, rooms: 2, real_estate_type: "Appartement", location: { city: "Lille" },
}));

const datasets: Record<string, unknown[]> = {
  "ds-lbc": lbc,
  // Une vente glissée dans les résultats PAP, une autre dans SeLoger : jamais retenues.
  "ds-pap": [...pap, { ...pap[0], detailUrl: "https://www.pap.fr/annonces/-r999", product: "vente", priceValue: 650 }],
  "ds-seloger": [...seloger, { ...seloger[0], url: "https://www.seloger.com/annonce/achat/hauts-de-france/nord-59/lille-59000/26SALE", transactionType: "Buy" }],
};
let runStatus: Record<string, string[]> = {};
let started: string[] = [];
let datasetReads: string[] = [];
let interpretation: Record<string, unknown> = {};
let fake: Server;

beforeEach(() => {
  started = [];
  datasetReads = [];
  interpretation = { location: "Lille", intent: "rent", maxPrice: 900, minRooms: 1, maxRooms: 2, radius: 5, keywords: "", uncertainChecks: [], places: [] };
  // PAP : encore en cours au premier contrôle, la recherche doit l'attendre.
  runStatus = { "run-lbc": ["SUCCEEDED"], "run-pap": ["RUNNING", "SUCCEEDED"], "run-seloger": ["SUCCEEDED"] };
});

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/")) {
        const actor = url.match(/^\/v2\/acts?(?:ors)?\/([^/]+)\/runs/)?.[1] ?? url;
        started.push(actor);
        if (actor === "clearpath~leboncoin-api") return json({ data: { id: "run-lbc" } });
        if (actor === "clearpath~pap-scraper") return json({ data: { id: "run-pap" } });
        if (actor === "silentflow~seloger-scraper-ppr") return json({ data: { id: "run-seloger" } });
        if (actor === "abotapi~seloger-france-scraper") return json({ data: { id: "run-resolve" } });
      }
      if (url.startsWith("/v2/actor-runs/run-resolve/log")) {
        res.setHeader("content-type", "text/plain");
        return res.end("[apify] INFO  Location resolved: 'Lille' -> AD08FR23619 (Lille (59))\n");
      }
      const run = url.match(/^\/v2\/actor-runs\/(run-[a-z]+)$/)?.[1];
      if (run) {
        const states = runStatus[run];
        const status = states.length > 1 ? states.shift()! : states[0];
        return json({ data: { status, defaultDatasetId: `ds-${run.slice(4)}` } });
      }
      const dataset = url.match(/^\/v2\/datasets\/(ds-[a-z]+)\/items/)?.[1];
      if (dataset) { datasetReads.push(dataset); return json(datasets[dataset]); }
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        const content = request.messages[0].content.includes("Interprète une demande")
          ? interpretation
          : { items: (JSON.parse(request.messages[1].content) as { listings: { id: number; title: string; wantGeneral: boolean }[] }).listings
            .map(item => ({ id: item.id, checks: [], ...(item.wantGeneral ? { summary: "Logement.", summaryEvidence: [], features: [], offer: "entire" } : {}) })) };
        return json({ id: "x", object: "chat.completion", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }] });
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
  process.env.APIFY_RESULT_LIMIT = "9";
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
});
after(async () => {
  fake.close();
  delete process.env.APIFY_RESULT_LIMIT;
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});

async function runToCompletion(id: number) {
  const { createWorker } = await import("../../lib/worker");
  const { db } = await import("../../lib/database");
  const worker = createWorker({ owner: "test" });
  for (let i = 0; i < 8; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    if (row.status !== "running") return row;
  }
  throw new Error("La recherche ne se termine pas");
}

test("trois sources : lancées ensemble, PAP attendu, annonces alternées, aucune vente ni colocation, source enregistrée", async () => {
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("Un T1 ou T2 à Lille, 900 € max");
  assert.equal((await runToCompletion(id)).status, "completed");
  assert.deepEqual(started.sort(), ["abotapi~seloger-france-scraper", "clearpath~leboncoin-api", "clearpath~pap-scraper", "silentflow~seloger-scraper-ppr"]);

  const search = await getSearch(id);
  const listings = search?.listings ?? [];
  assert.equal(listings.length, 9);
  const bySource = (source: string) => listings.filter(listing => listing.source === source).length;
  assert.deepEqual([bySource("leboncoin"), bySource("seloger"), bySource("pap")], [3, 3, 3], "trois sites à tour de rôle");
  assert.ok(listings.every(listing => !/achat|-r999|colocation/i.test(`${listing.url} ${listing.title}`)), "ni vente ni colocation");
  assert.ok(listings.filter(listing => listing.source === "pap").every(listing => listing.url.startsWith("https://www.pap.fr/annonces/")));
  assert.ok(listings.filter(listing => listing.source === "seloger").every(listing => /^https:\/\/www\.seloger\.com\/annonces?\/locations?\//.test(listing.url)));
  assert.ok(listings.every(listing => listing.rooms == null || listing.rooms <= 2), "fourchette de pièces appliquée à toutes les sources");
  assert.deepEqual(search?.searchRequests?.map(request => request.source ?? "leboncoin").sort(), ["leboncoin", "pap", "seloger"]);
});

test("une source en échec (SeLoger) ne fait pas échouer la recherche : Le Bon Coin et PAP suffisent", async () => {
  runStatus["run-seloger"] = ["FAILED"];
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("T2 à Lille 900 euros max");
  assert.equal((await runToCompletion(id)).status, "completed");
  const sources = new Set((await getSearch(id))?.listings.map(listing => listing.source));
  assert.deepEqual([...sources].sort(), ["leboncoin", "pap"]);
});

test("LISTING_SOURCES=leboncoin : ni PAP ni SeLoger ne sont lancés", async () => {
  process.env.LISTING_SOURCES = "leboncoin";
  try {
    const { createSearch, getSearch } = await import("./store");
    const id = await createSearch("Studio ou T2 à Lille, 900 € max");
    assert.equal((await runToCompletion(id)).status, "completed");
    assert.deepEqual(started, ["clearpath~leboncoin-api"]);
    assert.ok((await getSearch(id))?.listings.every(listing => listing.source === "leboncoin"));
  } finally {
    delete process.env.LISTING_SOURCES;
  }
});

test("phase élargie (Le Bon Coin sans mot-clé) : PAP et SeLoger ne sont ni relancés ni relus, leurs requêtes restent au suivi", async () => {
  interpretation = { ...interpretation, uncertainChecks: [{ label: "balcon", availability: "description", apiField: null }] };
  runStatus["run-lbc"] = ["SUCCEEDED"];
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("T2 à Lille avec balcon, 900 € max");
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  assert.equal(search?.phase, "broad", "moins de 40 annonces : la recherche élargie a eu lieu");
  assert.equal(started.filter(actor => actor === "clearpath~leboncoin-api").length, 2);
  assert.equal(started.filter(actor => actor === "clearpath~pap-scraper").length, 1);
  assert.deepEqual([datasetReads.filter(d => d === "ds-pap").length, datasetReads.filter(d => d === "ds-seloger").length], [1, 1]);
  assert.deepEqual(search?.searchRequests?.map(request => `${request.source ?? "leboncoin"}/${request.batch}`).sort(),
    ["leboncoin/broad", "leboncoin/focused", "pap/focused", "seloger/focused"]);
});
