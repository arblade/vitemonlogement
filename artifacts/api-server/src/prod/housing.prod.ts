import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { closeDatabase, db } from "../lib/database";
import { airKm } from "../lib/distance";
import { createWorker } from "../lib/worker";
import { interpret } from "../routes/housing/ai";
import { isHousingListingUrl } from "../routes/housing/housing-search";
import { createSearch, getSearch } from "../routes/housing/store";
import { useMemoryDatabase } from "../test/helpers";

// Tests « prod » : vrais OpenAI et Apify (coût réel, ~0,02 € au total). À lancer explicitement : pnpm test:prod.
const PROMPT = "Un studio à Lille, 700 € maximum, avec un balcon";

before(async () => { await useMemoryDatabase(); });
after(async () => { await closeDatabase(); });

test("prod : OpenAI interprète une demande en critères structurés", async () => {
  const criteria = await interpret(PROMPT);
  assert.match(criteria.location, /lille/i);
  assert.equal(criteria.intent, "rent");
  assert.equal(criteria.maxPrice, 700);
  assert.ok((criteria.wishes ?? []).some(wish => /balcon/i.test(wish)), `souhait « balcon » attendu, reçu : ${(criteria.wishes ?? []).join(", ")}`);
});

test("prod : recherche complète Apify + analyse OpenAI, de bout en bout", { timeout: 240_000 }, async () => {
  const id = await createSearch(PROMPT);
  const worker = createWorker({ owner: "prod-e2e" });
  let status = "running";
  for (let i = 0; i < 40 && status === "running"; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    status = row.status;
    if (status === "running") await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  const search = await getSearch(id);
  assert.equal(status, "completed", `recherche non terminée : ${status} ${search ? "" : "(introuvable)"}`);
  assert.ok(search && search.listings.length > 0, "au moins une annonce attendue");
  assert.ok(search.listings.length <= 35, "une seule page lue (35 annonces au plus)");
  assert.ok(search.listings.filter(listing => listing.analyzed).length <= 5, "5 analyses IA au plus");
  for (const listing of search.listings) {
    assert.ok(isHousingListingUrl(listing.url), `URL non locative : ${listing.url}`);
    if (listing.price !== null) assert.ok(listing.price <= 700, `budget dépassé : ${listing.price} €`);
    assert.ok(listing.criterionResults.length > 0, "chaque annonce a des vérifications de critères");
  }
  assert.ok(search.listings.some(listing => listing.aiSummary), "au moins un résumé IA est produit");
  console.log(`# prod : ${search.listings.length} annonces, statut ${status}`);
});

test("prod : « à Rennes, à moins de 30 min de l'aéroport » (double contrainte) et « autour de l'aéroport » (centré) sont bien lus par OpenAI", async () => {
  const double = (await interpret("Une maison à Rennes, à moins de 30 min en voiture de l'aéroport de Rennes")).places?.[0];
  assert.match(double?.address ?? "", /a[ée]roport/i);
  assert.equal(double?.maxMinutes, 30);
  assert.equal(double?.centered, false, "la ville est aussi une contrainte");
  const around = (await interpret("Un appartement autour de l'aéroport de Rennes, à moins de 5 km")).places?.[0];
  assert.match(around?.address ?? "", /a[ée]roport/i);
  assert.equal(around?.maxKm, 5);
  assert.equal(around?.centered, true, "recherche centrée sur le lieu");
});

test("prod : recherche centrée sur l'aéroport de Rennes, les annonces sont bien lues autour de l'aéroport (URL Le Bon Coin réelle)", { timeout: 240_000 }, async () => {
  const id = await createSearch("Un logement à louer autour de l'aéroport de Rennes, à moins de 5 km");
  const worker = createWorker({ owner: "prod-airport" });
  let status = "running";
  for (let i = 0; i < 40 && status === "running"; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    status = row.status;
    if (status === "running") await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  const search = await getSearch(id);
  assert.equal(status, "completed", `recherche non terminée : ${status}`);
  const place = search?.criteria.places?.[0];
  assert.ok(place?.lat != null && place.lng != null, "aéroport géocodé");
  assert.ok(airKm({ lat: place.lat!, lng: place.lng! }, { lat: 48.0709, lng: -1.733 }) < 1.5, `aéroport mal placé : ${place.resolved}`);
  assert.ok(search && search.listings.length > 0, "au moins une annonce attendue");
  const placed = search.listings.filter(listing => listing.lat != null && listing.lng != null && (listing.geoPrecision === "street" || listing.geoPrecision === "streetNumber"));
  const distances = placed.map(listing => Math.round(airKm({ lat: listing.lat!, lng: listing.lng! }, { lat: place.lat!, lng: place.lng! }) * 10) / 10);
  console.log(`# prod aéroport : ${search.listings.length} annonces, ${placed.length} à position précise, distances à l'aéroport (km) : ${distances.join(", ")}`);
  console.log(`# prod aéroport : villes des annonces : ${[...new Set(search.listings.map(listing => listing.location))].join(", ")}`);
  console.log(`# prod aéroport : critères ${JSON.stringify(search.criteria.checks?.map(check => check.label))}`);
  // Cercle de 5 km autour de l'aéroport, positions floues d'environ 1 km : tout près de l'aéroport…
  assert.ok(placed.length > 0 && placed.every((_, index) => distances[index] <= 7), `annonces trop loin de l'aéroport : ${distances.join(", ")}`);
  // …et pas un cercle autour du centre de Rennes (à ~6 km de l'aéroport) : des annonces en sortent.
  const rennesCentre = { lat: 48.1114, lng: -1.6794 };
  const outside = search.listings.filter(listing => listing.lat != null && listing.lng != null && airKm({ lat: listing.lat, lng: listing.lng }, rennesCentre) > 5);
  assert.ok(outside.length > 0, "toutes les annonces sont dans les 5 km du centre de Rennes : la zone n'a pas bougé");
});
