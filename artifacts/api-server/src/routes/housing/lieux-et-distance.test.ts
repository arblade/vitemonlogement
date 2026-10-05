import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { fatihRecord } from "../../test/fatih";
import { analyze, parsePlaces, type JsonLlm } from "./ai";
import { checksFor, evaluateStructured, withPlaceChecks } from "./criteria";
import { housingActorInput, searchZone } from "./housing-search";
import { resolvePlace } from "../../lib/places";
import type { Criteria, Listing, Place } from "./store";

const lille = (resolvePlace("Lille") as { commune: { lat: number; lon: number } }).commune;
// Coordonnées IGN de Lille-Lesquin : celles de la table des grands aéroports (airports.ts), qui sert de bout en bout.
const AIRPORT = { lat: 50.566266, lng: 3.102332 };
const airport = (over: Partial<Place> = {}): Place => ({ id: "place-1", label: "Aéroport de Lille", kind: "other", address: "aéroport de Lille", mode: null, ...AIRPORT, resolved: "Aéroport de Lille-Lesquin", ...over });
const criteriaOf = (places: Place[], radius = 5): Criteria => ({ location: "Lille", intent: "rent", keywords: "", radius, places });
const urlOf = (criteria: Criteria) => new URL(String((housingActorInput(criteria).input as { startUrls: string[] }).startUrls[0])).searchParams;

test("parsePlaces : maxKm, maxMinutes et centered lus du LLM, bornés ; un seul lieu centré", () => {
  const places = parsePlaces([
    { label: "Aéroport", address: "aéroport de Rennes", maxMinutes: 30, maxKm: "12,5", centered: true },
    { label: "Gare", address: "gare de Rennes", maxMinutes: -5, maxKm: 9999, centered: true },
    { label: "Travail", address: "20 place des Lices", maxMinutes: "beaucoup", centered: "oui" },
  ]);
  assert.deepEqual(places.map(place => [place.maxMinutes, place.maxKm, place.centered]), [[30, 12.5, true], [null, null, false], [null, null, false]]);
});

test("searchZone : sans lieu contraint, la commune et son rayon ; lieu sans contrainte ou non géocodé : rien ne change", () => {
  const city = { lat: lille.lat, lon: lille.lon, radiusKm: 5 };
  assert.deepEqual(searchZone(criteriaOf([]), lille), city);
  assert.deepEqual(searchZone(criteriaOf([airport()]), lille), city);
  assert.deepEqual(searchZone(criteriaOf([airport({ maxKm: 2, lat: null, lng: null })]), lille), city);
});

test("searchZone : « autour de l'aéroport » → cercle autour du lieu (sa distance, sinon le rayon demandé) ; la ville ne compte plus", () => {
  assert.deepEqual(searchZone(criteriaOf([airport({ centered: true, maxKm: 3 })]), lille), { lat: AIRPORT.lat, lon: AIRPORT.lng, radiusKm: 3 });
  assert.deepEqual(searchZone(criteriaOf([airport({ centered: true })], 8), lille), { lat: AIRPORT.lat, lon: AIRPORT.lng, radiusKm: 8 });
  const byTime = searchZone(criteriaOf([airport({ centered: true, maxMinutes: 30 })]), lille);
  assert.ok(byTime.radiusKm > 15 && byTime.radiusKm < 20, "30 min en voiture ≈ 17 km à vol d'oiseau");
});

test("searchZone : « à Lille ET à moins de X de l'aéroport » → le plus petit des deux cercles (il contient tout logement qui respecte les deux)", () => {
  assert.deepEqual(searchZone(criteriaOf([airport({ maxKm: 20 })]), lille), { lat: lille.lat, lon: lille.lon, radiusKm: 5 }, "ville plus petite : on la garde");
  assert.deepEqual(searchZone(criteriaOf([airport({ maxKm: 2 })]), lille), { lat: AIRPORT.lat, lon: AIRPORT.lng, radiusKm: 2 }, "lieu plus petit : cercle du lieu");
  const two = searchZone(criteriaOf([airport({ maxKm: 4 }), airport({ id: "place-2", lat: 50.6, lng: 3.0, maxKm: 1.5 })]), lille);
  assert.deepEqual(two, { lat: 50.6, lon: 3.0, radiusKm: 1.5 }, "plusieurs lieux : le plus serré");
  assert.equal(searchZone(criteriaOf([airport({ maxKm: 5000 })], 500), lille).radiusKm, 200, "plafonné comme le rayon");
});

test("URL Le Bon Coin : la zone recentrée y figure (coordonnées et rayon en mètres)", () => {
  assert.match(urlOf(criteriaOf([airport({ centered: true, maxKm: 3 })])).get("locations") ?? "", /__50\.56627_3\.10233_3000$/);
  assert.match(urlOf(criteriaOf([airport({ maxKm: 20 })])).get("locations") ?? "", new RegExp(`__${lille.lat.toFixed(5)}_${lille.lon.toFixed(5)}_5000$`));
});

test("withPlaceChecks : un critère de proximité par lieu contraint ; la ville cède la place quand la recherche est centrée ; sans doublon", () => {
  const base = criteriaOf([airport({ maxMinutes: 30 })]);
  const double = withPlaceChecks(base);
  assert.deepEqual(double.checks?.map(check => check.id), ["location", "distance-place-1"]);
  assert.equal(double.checks?.at(-1)?.label, "À moins de 30 min en voiture · Aéroport de Lille");
  assert.deepEqual(withPlaceChecks(double).checks?.map(check => check.id), ["location", "distance-place-1"], "rappliqué : pas de doublon");
  const centered = withPlaceChecks(criteriaOf([airport({ maxKm: 3, centered: true })]));
  assert.deepEqual(centered.checks?.map(check => check.id), ["distance-place-1"]);
  const notFound = withPlaceChecks(criteriaOf([airport({ maxKm: 3, centered: true, lat: null, lng: null })]));
  assert.deepEqual(notFound.checks?.map(check => check.id), ["location", "distance-place-1"], "lieu introuvable : la ville reste le critère");
  assert.deepEqual(withPlaceChecks(criteriaOf([airport()])).checks?.map(check => check.id), ["location"], "lieu sans contrainte : aucun critère");
});

const basics = { price: 600, area: 30, rooms: 2, location: "Lille" };

test("evaluateStructured : proximité calculée depuis la position de l'annonce ; sans position → « à vérifier »", () => {
  const criteria = withPlaceChecks(criteriaOf([airport({ maxKm: 5 })]));
  const result = (listing: Partial<Listing>) => evaluateStructured(criteria, { ...basics, ...listing }, {}).find(check => check.id === "distance-place-1");
  assert.equal(result({ lat: 50.57, lng: 3.09, geoPrecision: "street" })?.status, "confirmed");
  assert.equal(result({ lat: lille.lat, lng: lille.lon, geoPrecision: "street" })?.status, "contradicted");
  assert.equal(result({})?.status, "unknown");
  assert.equal(result({ lat: lille.lat, lng: lille.lon, geoPrecision: "city" })?.status, "contradicted", "la commune est à ~8 km : même avec 2 km de marge, trop loin");
});

test("analyze : le critère de proximité est calculé, jamais demandé au LLM", async () => {
  const criteria = withPlaceChecks({ ...criteriaOf([airport({ maxKm: 5 })]), wishes: ["balcon"], checks: [...checksFor({ ...criteriaOf([]), wishes: ["balcon"] })] });
  criteria.places = [airport({ maxKm: 5 })];
  const withDistance = withPlaceChecks(criteria);
  const listing: Listing = {
    id: 1, source: "leboncoin", batch: "focused", title: "T2", url: "https://www.leboncoin.fr/ad/locations/1", description: "T2 avec balcon.", ...basics,
    image: null, images: [], aiSummary: null, summaryEvidence: [], score: 60, features: [],
    criterionResults: evaluateStructured(withDistance, basics, {}), lat: null, lng: null, geoPrecision: null,
  };
  const asked: string[][] = [];
  const llm: JsonLlm = async (_system, user) => {
    const { listings } = JSON.parse(user) as { listings: { id: number; toVerify: { id: string }[] }[] };
    asked.push(listings.flatMap(item => item.toVerify.map(check => check.id)));
    return { items: listings.map(item => ({ id: item.id, checks: [] })) };
  };
  const [result] = await analyze([listing], withDistance, { llm, jev: null });
  assert.deepEqual(asked.flat(), ["wish-1"]);
  assert.equal(result.criterionResults.find(check => check.id === "distance-place-1")?.status, "unknown");
});

// --- De bout en bout : demande → interprétation → géocodage → zone lue chez Le Bon Coin → critères par annonce ---

const ads = [
  fatihRecord({ url: "https://www.leboncoin.fr/ad/locations/1", title: "T2 près de l'aéroport", description: "T2 calme. Loyer 600 €.", price: 600, area: 40, rooms: 2, lat: 50.57, lng: 3.09, type: "streetNumber" }),
  fatihRecord({ url: "https://www.leboncoin.fr/ad/locations/2", title: "T2 Lille centre", description: "T2 en ville. Loyer 650 €.", price: 650, area: 42, rooms: 2, lat: lille.lat, lng: lille.lon, type: "city" }),
];
const runInputs: { startUrls: string[] }[] = [];
const toVerifyIds: string[] = [];
let fake: Server;

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/acts/fatihtahta~leboncoin-fr-scraper/runs")) { runInputs.push(JSON.parse(body)); return json({ data: { id: "run-1" } }); }
      if (url.startsWith("/v2/actor-runs/")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds-1" } });
      if (url.startsWith("/v2/datasets/")) return json(ads);
      if (url.startsWith("/geocodage/search")) {
        const poiOnly = new URL(url, "http://x").searchParams.get("index") === "poi";
        return json({ features: poiOnly ? [{ geometry: { coordinates: [AIRPORT.lng, AIRPORT.lat] }, properties: { toponym: "Aéroport de Lille-Lesquin", category: ["aérodrome", "transport"], city: ["Lesquin"], score: 0.85 } }] : [] });
      }
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        let content: unknown;
        if (request.messages[0].content.includes("Interprète une demande")) {
          const user = request.messages[1].content;
          const near = { label: "Aéroport de Lille", kind: "other", address: "aéroport de Lille", maxKm: 3, maxMinutes: null };
          content = user.includes("de voiture de l'aéroport")
            // Réponse observée 2 fois sur 3 en réel (05/10) : l'aéroport vu comme un lieu, aucune ville.
            ? { location: "", intent: "rent", radius: 5, keywords: "", uncertainChecks: [], propertyType: "house",
              places: [{ label: "Aéroport", kind: "other", address: "aéroport de Lille", mode: "drive", maxKm: null, maxMinutes: 30, centered: false }] }
            : { location: "Lille", intent: "rent", radius: 5, keywords: "", uncertainChecks: [],
              places: [user.includes("autour de") ? { ...near, centered: true } : { ...near, maxKm: 20, centered: false }] };
        } else {
          const { listings } = JSON.parse(request.messages[1].content) as { listings: { id: number; toVerify: { id: string }[] }[] };
          for (const item of listings) toVerifyIds.push(...item.toVerify.map(check => check.id));
          content = { items: listings.map(item => ({ id: item.id, checks: [], summary: "T2.", summaryEvidence: ["T2"], features: [] })) };
        }
        return json({ id: "x", object: "chat.completion", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }] });
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  Object.assign(process.env, { APIFY_BASE_URL: origin, APIFY_TOKEN: "test", OPENAI_BASE_URL: `${origin}/v1`, OPENAI_API_KEY: "test", GEOCODER_BASE_URL: `${origin}/geocodage` });
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
});
after(async () => {
  fake.close();
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});

async function runToCompletion(id: number) {
  const { createWorker } = await import("../../lib/worker");
  const { db } = await import("../../lib/database");
  const worker = createWorker({ owner: "lieux" });
  for (let i = 0; i < 6; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    if (row.status !== "running" && !row.task) return row;
  }
  throw new Error("La recherche ne se termine pas");
}

test("« autour de l'aéroport de Lille, à moins de 3 km » : recherche centrée sur l'aéroport, la ville n'est plus un critère, chaque annonce est jugée sur sa distance", async () => {
  const { createSearch, getSearch } = await import("./store");
  runInputs.length = 0; toVerifyIds.length = 0;
  const id = await createSearch("Un T2 autour de l'aéroport de Lille, à moins de 3 km");
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  const place = search?.criteria.places?.[0];
  assert.deepEqual([place?.lat, place?.lng, place?.resolved, place?.maxKm, place?.centered], [AIRPORT.lat, AIRPORT.lng, "Aéroport de Lille-Lesquin, Fretin", 3, true]);
  assert.match(new URL(runInputs[0].startUrls[0]).searchParams.get("locations") ?? "", /__50\.56627_3\.10233_3000$/, "zone lue : 3 km autour de l'aéroport, pas autour du centre de Lille");
  assert.deepEqual(search?.criteria.checks?.map(check => check.id), ["distance-place-1"], "plus de critère « Lieu : Lille »");
  const near = search?.listings.find(item => item.url.endsWith("/1"))?.criterionResults.find(check => check.id === "distance-place-1");
  const far = search?.listings.find(item => item.url.endsWith("/2"))?.criterionResults.find(check => check.id === "distance-place-1");
  assert.equal(near?.status, "confirmed");
  assert.equal(far?.status, "contradicted");
  assert.deepEqual(toVerifyIds, [], "le LLM n'a rien à vérifier pour la proximité");
});

test("« à Lille, à moins de 20 km de l'aéroport » : double contrainte, zone = la ville (le plus petit cercle), ville ET distance vérifiées", async () => {
  const { createSearch, getSearch } = await import("./store");
  runInputs.length = 0;
  const id = await createSearch("Un T2 à Lille, à moins de 20 km de l'aéroport");
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  assert.match(new URL(runInputs[0].startUrls[0]).searchParams.get("locations") ?? "", new RegExp(`__${lille.lat.toFixed(5)}_${lille.lon.toFixed(5)}_5000$`));
  assert.deepEqual(search?.criteria.checks?.map(check => check.id), ["location", "distance-place-1"]);
  for (const listing of search?.listings ?? []) assert.equal(listing.criterionResults.find(check => check.id === "distance-place-1")?.status, "confirmed", listing.url);
});

test("« une maison à moins de 30 min de voiture de l'aéroport de Lille », sans ville comprise par le LLM : la ville vient de l'aéroport, recherche centrée dessus", async () => {
  const { createSearch, getSearch } = await import("./store");
  runInputs.length = 0;
  const id = await createSearch("Une maison à moins de 30 min de voiture de l'aéroport de Lille, moins de 1000 € de loyer");
  const row = await runToCompletion(id);
  assert.equal(row.status, "completed", "plus d'échec « Indiquez une ville »");
  const search = await getSearch(id);
  assert.equal(search?.criteria.location, "Lille");
  assert.equal(search?.criteria.places?.[0].centered, true);
  const zone = new URL(runInputs[0].startUrls[0]).searchParams.get("locations") ?? "";
  assert.match(zone, /^Lille_\d{5}__50\.56627_3\.10233_(\d+)$/, "zone centrée sur l'aéroport");
  const radius = Number(zone.split("_").at(-1));
  assert.ok(radius > 15_000 && radius < 20_000, `30 min en voiture ≈ 17 km autour de l'aéroport (${radius} m), pas 5 km autour de Lille`);
  assert.deepEqual(search?.criteria.checks?.map(check => check.id), ["distance-place-1"]);
});
