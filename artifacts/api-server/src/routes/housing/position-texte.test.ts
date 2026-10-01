import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { fatihRecord } from "../../test/fatih";

// Annonces d'agences sans position précise (Le Bon Coin ne donne que le quartier) dont la description cite l'adresse.
// Textes réels relevés le 01/10/2026 (features/position-depuis-la-description.md).
const SALINIERES = "Appartement Situé dans Bordeaux centre au 21 quai des Salinières – BORDEAUX Appartement T2 Bis / T3 non meublé de 61,02m² situé au 4ème étage.";
const BENATTE = "Idéalement situé rue de la Benatte (proche boulevard), Appartement non meublé au 3 eme étage (dernier) d'un bel immeuble bordelais.";
const AGENCE = "Studio lumineux proche des quais. CARNET DE L'IMMOBILIER BORDELAIS - 26, rue Fondaudège - 33000 BORDEAUX. Honoraires : 200 €.";

test("validAddress : voie et numéro retenus seulement s'ils sont dans une citation exacte de l'annonce", async () => {
  const { validAddress } = await import("./ai");
  assert.deepEqual(validAddress({ address: { street: "quai des Salinières", number: "21", evidence: "Situé dans Bordeaux centre au 21 quai des Salinières" } }, SALINIERES),
    { street: "quai des Salinières", number: "21", evidence: "Situé dans Bordeaux centre au 21 quai des Salinières" });
  assert.deepEqual(validAddress({ address: { street: "rue de la Benatte (proche boulevard)", number: null, evidence: "rue de la Benatte (proche boulevard)" } }, BENATTE),
    { street: "rue de la Benatte", number: null, evidence: "rue de la Benatte (proche boulevard)" }, "parenthèse retirée de la voie");
  assert.equal(validAddress({ address: { street: "quai des Salinières", number: 21, evidence: "au 21 quai des Salinières" } }, SALINIERES)?.number, "21", "numéro donné en nombre");
  // Citation inventée, voie absente de la citation, numéro absent de la citation, quartier ou station au lieu d'une voie.
  assert.equal(validAddress({ address: { street: "quai des Salinières", number: "21", evidence: "au 21 quai des Salinières, Bordeaux" } }, SALINIERES), null);
  assert.equal(validAddress({ address: { street: "quai de Bacalan", number: null, evidence: "Situé dans Bordeaux centre" } }, SALINIERES), null);
  assert.equal(validAddress({ address: { street: "quai des Salinières", number: "48", evidence: "au 21 quai des Salinières" } }, SALINIERES)?.number, null, "numéro non cité : rue seule");
  assert.equal(validAddress({ address: { street: "Bordeaux centre", number: null, evidence: "Situé dans Bordeaux centre" } }, SALINIERES), null, "pas une voie");
  assert.equal(validAddress({ address: { street: "métro Gambetta", number: null, evidence: "métro Gambetta" } }, "Studio au pied du métro Gambetta"), null);
  assert.equal(validAddress({ address: null }, SALINIERES), null);
  assert.equal(validAddress({}, SALINIERES), null);
  assert.deepEqual(validAddress({ address: { street: "allée des Tilleuls", number: "3", evidence: "3 allée des Tilleuls" } }, "Maison 3 allée des Tilleuls")?.street, "allée des Tilleuls", "voie à accent final");
});

// --- Faux services : Apify, OpenAI, IGN ---
type Ign = { label: string; city: string; postcode: string; type: string; score: number; lng: number; lat: number };
let ignAnswers: (params: URLSearchParams) => Ign[] = () => [];
const ignQueries: URLSearchParams[] = [];
let dataset: unknown[] = [];
let addresses: Record<string, unknown> = {};
let fake: Server;

beforeEach(() => { ignQueries.length = 0; });

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/acts/fatihtahta~leboncoin-fr-scraper/runs")) return json({ data: { id: "run-1" } });
      if (url.startsWith("/v2/actor-runs/")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds-1" } });
      if (url.startsWith("/v2/datasets/")) return json(dataset);
      if (url.startsWith("/geocodage/search")) {
        const params = new URL(url, "http://x").searchParams;
        ignQueries.push(params);
        return json({ features: ignAnswers(params).map(({ lng, lat, ...properties }) => ({ geometry: { coordinates: [lng, lat] }, properties })) });
      }
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        const content = request.messages[0].content.includes("Interprète une demande")
          ? { location: "Bordeaux", intent: "rent", maxPrice: 1200, radius: 5, keywords: "", uncertainChecks: [], places: [] }
          : { items: (JSON.parse(request.messages[1].content) as { listings: { id: number; title: string; wantGeneral: boolean }[] }).listings
            .map(item => ({ id: item.id, checks: [], ...(item.wantGeneral ? { summary: "Logement.", summaryEvidence: [], features: [], offer: "entire", address: addresses[item.title] ?? null } : {}) })) };
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
  process.env.GEOCODER_BASE_URL = `${origin}/geocodage`;
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
});
after(async () => {
  fake.close();
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});

const salinieres: Ign = { label: "21 Quai des Salinières 33000 Bordeaux", city: "Bordeaux", postcode: "33000", type: "housenumber", score: 0.97, lng: -0.5683, lat: 44.8361 };

test("géocodage : requête dans le code postal de l'annonce ; numéro trouvé = adresse exacte, sinon rue", async () => {
  const { geocodeListingAddress } = await import("../../lib/geocode");
  ignAnswers = () => [salinieres];
  assert.deepEqual(await geocodeListingAddress({ street: "quai des Salinières", number: "21" }, "Bordeaux", "33000"),
    { lat: 44.8361, lng: -0.5683, precision: "streetNumber", label: "21 Quai des Salinières 33000 Bordeaux" });
  assert.equal(ignQueries[0].get("q"), "21 quai des Salinières, Bordeaux");
  assert.equal(ignQueries[0].get("postcode"), "33000");
  assert.equal(ignQueries[0].get("index"), "address");
  ignAnswers = () => [{ ...salinieres, type: "street", label: "Quai des Salinières 33000 Bordeaux" }];
  assert.equal((await geocodeListingAddress({ street: "quai des Salinières", number: "21" }, "Bordeaux", "33000"))?.precision, "street", "numéro inconnu de l'IGN");
  ignAnswers = () => [salinieres];
  assert.equal((await geocodeListingAddress({ street: "quai des Salinières", number: null }, "Bordeaux", "33000"))?.precision, "street", "pas de numéro dans le texte");
});

test("géocodage : rien plutôt qu'une erreur — autre commune, score bas, rue homonyme d'un autre arrondissement, simple commune, IGN en panne", async () => {
  const { geocodeListingAddress } = await import("../../lib/geocode");
  const addr = { street: "quai des Salinières", number: "21" };
  ignAnswers = () => [{ ...salinieres, city: "Bègles", postcode: "33130" }];
  assert.equal(await geocodeListingAddress(addr, "Bordeaux", "33000"), null, "autre commune");
  ignAnswers = () => [{ ...salinieres, score: 0.6 }];
  assert.equal(await geocodeListingAddress(addr, "Bordeaux", "33000"), null, "score 0,6 : ni filtré (≥ 0,7) ni repli (≥ 0,9)");
  // Cas réel : « Quai du Rhône » à Lyon 1er ; sans filtre, l'IGN propose le Quai du Commerce (Lyon 9e).
  ignAnswers = params => params.get("postcode") ? [{ label: "Quai André Lassagne 69001 Lyon", city: "Lyon", postcode: "69001", type: "street", score: 0.33, lng: 4.83, lat: 45.77 }]
    : [{ label: "Quai du Commerce 69009 Lyon", city: "Lyon", postcode: "69009", type: "street", score: 0.95, lng: 4.80, lat: 45.78 }];
  assert.equal(await geocodeListingAddress({ street: "Quai du Rhône", number: null }, "Lyon", "69001"), null, "homonyme hors du code postal refusé");
  ignAnswers = () => [{ ...salinieres, type: "municipality", label: "Bordeaux" }];
  assert.equal(await geocodeListingAddress(addr, "Bordeaux", "33000"), null, "une commune n'est pas une adresse");
  const previous = process.env.GEOCODER_BASE_URL;
  process.env.GEOCODER_BASE_URL = "http://127.0.0.1:1";
  try { assert.equal(await geocodeListingAddress(addr, "Bordeaux", "33000"), null); } finally { process.env.GEOCODER_BASE_URL = previous; }
});

test("géocodage : repli sans code postal accepté seulement à score ≥ 0,9 dans le même code postal ; sans code postal connu, score ≥ 0,9", async () => {
  const { geocodeListingAddress } = await import("../../lib/geocode");
  const addr = { street: "quai des Salinières", number: "21" };
  ignAnswers = params => params.get("postcode") ? [] : [salinieres];
  assert.equal((await geocodeListingAddress(addr, "Bordeaux", "33000"))?.precision, "streetNumber");
  ignAnswers = params => params.get("postcode") ? [] : [{ ...salinieres, postcode: "33800" }];
  assert.equal(await geocodeListingAddress(addr, "Bordeaux", "33000"), null);
  ignAnswers = () => [salinieres];
  assert.equal((await geocodeListingAddress(addr, "Bordeaux", null))?.precision, "streetNumber");
  assert.equal(ignQueries.at(-1)?.get("postcode"), null);
  ignAnswers = () => [{ ...salinieres, score: 0.8 }];
  assert.equal(await geocodeListingAddress(addr, "Bordeaux", null), null);
});

async function runToCompletion(id: number) {
  const { createWorker } = await import("../../lib/worker");
  const { db } = await import("../../lib/database");
  const worker = createWorker({ owner: "test" });
  for (let i = 0; i < 6; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    if (row.status !== "running" && !row.task) return row; // terminée, et plus aucune tâche en cours
  }
  throw new Error("La recherche ne se termine pas");
}

test("bout en bout : l'annonce d'agence placée au quartier reçoit l'adresse de sa description ; les autres gardent la leur", async () => {
  const quarter = { lat: 44.8411, lng: -0.5735, type: "district", city: "Bordeaux", zipcode: "33000" };
  dataset = [
    fatihRecord({ url: "https://www.leboncoin.fr/ad/locations/501", title: "Appartement T2 Salinières", description: SALINIERES, price: 900, area: 61, rooms: 2, ...quarter }),
    fatihRecord({ url: "https://www.leboncoin.fr/ad/locations/502", title: "Studio agence", description: AGENCE, price: 600, area: 20, rooms: 1, ...quarter }),
    fatihRecord({ url: "https://www.leboncoin.fr/ad/locations/503", title: "T2 particulier", description: "T2 au 4 rue Sainte-Catherine.", price: 800, area: 40, rooms: 2,
      lat: 44.8400, lng: -0.5730, type: "streetNumber", city: "Bordeaux", zipcode: "33000" }),
    fatihRecord({ url: "https://www.leboncoin.fr/ad/locations/504", title: "T2 Benatte", description: BENATTE, price: 700, area: 35, rooms: 2, ...quarter }),
  ];
  addresses = {
    "Appartement T2 Salinières": { street: "quai des Salinières", number: "21", evidence: "Situé dans Bordeaux centre au 21 quai des Salinières" },
    // L'IA se trompe et rend l'adresse de l'agence, avec une citation inventée : refusée par la validation.
    "Studio agence": { street: "rue Fondaudège", number: "26", evidence: "situé 26 rue Fondaudège" },
    "T2 particulier": { street: "rue Sainte-Catherine", number: "4", evidence: "4 rue Sainte-Catherine" },
    "T2 Benatte": { street: "rue de la Benatte", number: null, evidence: "rue de la Benatte (proche boulevard)" },
  };
  ignAnswers = params => (params.get("q") ?? "").includes("Salinières") ? [salinieres]
    : (params.get("q") ?? "").includes("Benatte") ? [] // introuvable : la zone reste
    : [{ label: "?", city: "Bordeaux", postcode: "33000", type: "housenumber", score: 0.99, lng: 0, lat: 0 }];
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("Un appartement à Bordeaux, 1200 € max");
  assert.equal((await runToCompletion(id)).status, "completed");
  const listings = (await getSearch(id))!.listings;
  const byTitle = (title: string) => listings.find(listing => listing.title === title)!;
  assert.deepEqual(byTitle("Appartement T2 Salinières"), { ...byTitle("Appartement T2 Salinières"), lat: 44.8361, lng: -0.5683, geoPrecision: "streetNumber",
    geoSource: "description", geoEvidence: "Situé dans Bordeaux centre au 21 quai des Salinières" });
  for (const [title, at] of [["Studio agence", quarter], ["T2 Benatte", quarter]] as const) {
    const listing = byTitle(title);
    assert.deepEqual([listing.lat, listing.lng, listing.geoPrecision, listing.geoSource], [at.lat, at.lng, "district", null], title);
  }
  const owner = byTitle("T2 particulier");
  assert.deepEqual([owner.lat, owner.lng, owner.geoPrecision, owner.geoSource], [44.84, -0.573, "streetNumber", null], "position déjà précise : jamais remplacée");
  assert.ok(ignQueries.every(params => !(params.get("q") ?? "").includes("Sainte-Catherine") && !(params.get("q") ?? "").includes("Fondaudège")),
    "ni la position précise ni l'adresse refusée ne sont géocodées");

  // « Étendre » (page suivante) : l'annonce déjà placée n'est pas réanalysée et garde sa position lue dans le texte, même IGN en panne.
  ignAnswers = () => [];
  const { requestExtend } = await import("./store");
  assert.ok(await requestExtend(id));
  assert.equal((await runToCompletion(id)).status, "completed");
  const again = (await getSearch(id))!.listings.find(listing => listing.title === "Appartement T2 Salinières")!;
  assert.deepEqual([again.lat, again.lng, again.geoPrecision, again.geoSource, again.geoEvidence], [44.8361, -0.5683, "streetNumber", "description", "Situé dans Bordeaux centre au 21 quai des Salinières"]);
});
