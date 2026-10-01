import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import type { Criteria } from "./store";

// Annonces réelles récupérées le 01/10/2026 (Lille), coordonnées des annonceurs remplacées par des valeurs factices.
const sample = (name: string) => JSON.parse(readFileSync(new URL(`../../test/${name}`, import.meta.url), "utf8")) as Record<string, unknown>[];
const pap = sample("pap-sample.json");
const seloger = sample("seloger-sample.json");
const criteria: Criteria = { location: "Lille", intent: "rent", keywords: "", radius: 5 };

let fake: Server;
const calls: string[] = [];
before(async () => {
  fake = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url?.startsWith("/v2/acts/abotapi~seloger-france-scraper/runs")) {
      res.end(JSON.stringify({ data: { id: "resolve-1" } }));
    } else if (req.url?.startsWith("/v2/actor-runs/resolve-1/log")) {
      res.setHeader("content-type", "text/plain");
      res.end("2026-10-01T11:24:52.137Z [apify] INFO  Location resolved: 'Lille' -> AD08FR23619 (Lille (59))\n2026-10-01T11:24:53Z [apify] INFO  Total available: 314\n");
    } else {
      res.statusCode = 404; res.end("{}");
    }
  });
  await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
  process.env.APIFY_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.APIFY_TOKEN = "test";
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
});
after(async () => {
  fake.close();
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});

test("adresses : PAP et SeLoger reconnus, SeLoger seulement en location ; jamais un faux domaine ni du http", async () => {
  const { extraSourceOf } = await import("./sources");
  const { isHousingListingUrl } = await import("./housing-search");
  assert.equal(extraSourceOf("https://www.pap.fr/annonces/-r442803002"), "pap");
  assert.equal(extraSourceOf("https://www.seloger.com/annonce/location/hauts-de-france/nord-59/lille-59000/26ABC"), "seloger");
  assert.equal(extraSourceOf("https://www.seloger.com/annonces/locations/appartement/lille-59/252788015.htm"), "seloger");
  for (const url of [
    "https://www.seloger.com/annonce/achat/hauts-de-france/nord-59/lille-59000/26ABC",
    "https://www.seloger.com/annonces/achat/appartement/lille-59/1.htm",
    "https://www.seloger.com/annonces/viagers/appartement/lille-59/1.htm",
    "http://www.pap.fr/annonces/-r1",
    "https://www.pap.fr.evil.test/annonces/-r1",
    "https://www.acceslogement.fr/annonces/location-hallennes-r1",
  ]) {
    assert.equal(extraSourceOf(url), null, url);
    assert.equal(isHousingListingUrl(url), false, url);
  }
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/locations/1"), true);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/ventes_immobilieres/1"), false);
});

test("PAP, 10 vraies annonces : 6 appartements gardés ; 3 colocations et 1 logement social redirigé écartés ; téléphone jamais repris", async () => {
  const { normalizePap } = await import("./sources");
  const kept = pap.map(item => normalizePap(item, "focused")).filter(item => item !== null);
  assert.equal(kept.length, 6);
  assert.ok(kept.every(({ listing }) => listing.source === "pap" && listing.url.startsWith("https://www.pap.fr/annonces/")));
  const first = kept[0].listing;
  assert.deepEqual([first.title, first.price, first.area, first.rooms, first.location], ["Appartement 2 pièces 44 m²", 650, 44, 2, "Lille"]);
  assert.equal(first.geoPrecision, "district", "PAP ne dit pas si le point est exact : zone");
  assert.ok(first.images.length > 0 && first.description.length > 50);
  assert.deepEqual(first.features.map(feature => `${feature.label} ${feature.value}`), ["Classe énergie E", "Émissions GES D"]);
  assert.ok(!JSON.stringify(kept).includes("06 00 00 00 00"), "le numéro renvoyé par l'acteur n'est pas enregistré");
});

test("PAP : seule une location passe ; vente, vacances, produit absent ou inconnu → écartée", async () => {
  const { normalizePap } = await import("./sources");
  const home = pap[0];
  assert.ok(normalizePap(home, "focused"));
  for (const product of ["vente", "vacances", "acceslogement", undefined, "LOCATION"]) {
    assert.equal(normalizePap({ ...home, product }, "focused"), null, String(product));
  }
  assert.equal(normalizePap({ ...home, propertyType: "garage-parking" }, "focused"), null);
  assert.equal(normalizePap({ ...home, detailUrl: "https://www.acceslogement.fr/annonces/r1" }, "focused"), null);
});

test("SeLoger, 14 vraies annonces : les 4 « Colocation à louer » écartées, 10 logements gardés ; contact jamais repris", async () => {
  const { normalizeSeloger } = await import("./sources");
  const kept = seloger.map(item => normalizeSeloger(item, "focused")).filter(item => item !== null);
  assert.equal(kept.length, 10);
  assert.ok(kept.every(({ listing }) => listing.source === "seloger" && listing.price! > 0 && listing.area! > 0));
  const first = kept[0].listing;
  assert.deepEqual([first.title, first.price, first.area, first.rooms], ["Appartement 2 pièces 38 m²", 750, 38, 2]);
  assert.match(String(first.location), /^Lille/);
  assert.equal(normalizeSeloger({ ...seloger[0], surface: 41.99, rooms: 2 }, "focused")?.listing.title, "Appartement 2 pièces 42 m²");
  assert.equal(normalizeSeloger({ ...seloger[0], surface: 43.51, rooms: 2 }, "focused")?.listing.title, "Appartement 2 pièces 43,5 m²");
  assert.equal(first.geoPrecision, "street", "point précis (13 à 15 décimales)");
  assert.ok(!JSON.stringify(kept).includes("+33100000000"));
});

test("SeLoger : seule une location passe ; achat (champ ou URL), parking, colocation → écartés", async () => {
  const { normalizeSeloger } = await import("./sources");
  const home = seloger[0];
  assert.ok(normalizeSeloger(home, "focused"));
  for (const transactionType of ["Buy", "Sale", "Life_Annuity", undefined, "rent"]) {
    assert.equal(normalizeSeloger({ ...home, transactionType }, "focused"), null, String(transactionType));
  }
  assert.equal(normalizeSeloger({ ...home, url: String(home.url).replace("/annonce/location/", "/annonce/achat/") }, "focused"), null,
    "même avec « Rent », une URL d'achat est écartée");
  assert.equal(normalizeSeloger({ ...home, propertyType: "Parking" }, "focused"), null);
  assert.equal(normalizeSeloger({ ...home, title: "Colocation à louer - Lille" }, "focused"), null);
});

test("SeLoger : meublé, ascenseur, parking vérifiés sans IA quand l'annonce les affirme ; un « non » muet reste à vérifier", async () => {
  const { normalizeExtra } = await import("./sources");
  const wishes: Criteria = { ...criteria, wishes: ["meublé", "parking", "ascenseur"] };
  const results = (raw: Record<string, unknown>) =>
    Object.fromEntries(normalizeExtra("seloger", raw, wishes, "focused", () => 60)!.criterionResults.map(check => [check.label, `${check.status}/${check.source}`]));
  const yes = results({ ...seloger[0], isFurnished: true, hasElevator: true, hasParking: true });
  assert.deepEqual([yes["meublé"], yes["parking"], yes["ascenseur"]], ["confirmed/api", "confirmed/api", "confirmed/api"]);
  const silent = results({ ...seloger[0], isFurnished: false, hasElevator: false, hasParking: false, hasGarage: false });
  assert.deepEqual([silent["meublé"], silent["parking"], silent["ascenseur"]], ["unknown/unknown", "unknown/unknown", "unknown/unknown"]);
  const listing = normalizeExtra("seloger", { ...seloger[0], hasBalcony: true, hasParking: true }, wishes, "focused", () => 60)!;
  assert.ok(listing.features.some(feature => feature.label === "Balcon"));
  assert.ok(!listing.features.some(feature => feature.label === "Stationnement"), "déjà dans les critères demandés");
});

test("requêtes : PAP en location, appartement ou maison, avec fourchettes ; SeLoger en location (Rent) avec le code de la ville", async () => {
  const { sourceRequest, selogerSearchUrl } = await import("./sources");
  const wanted: Criteria = { ...criteria, minRooms: 1, maxRooms: 2, maxPrice: 700, minArea: 20 };
  const papRequest = await sourceRequest("pap", wanted, 10, "0.10", 120);
  assert.match(String(papRequest?.path), /^\/v2\/acts\/clearpath~pap-scraper\/runs\?maxItems=10&maxTotalChargeUsd=0\.10&timeout=120$/);
  assert.deepEqual(JSON.parse(String(papRequest?.input)), {
    product: "location", locations: ["Lille (59)"], propertyTypes: ["appartement", "maison"], maxResults: 10,
    nbPiecesMin: 1, nbPiecesMax: 2, priceMax: 700, surfaceMin: 20,
  });
  const url = new URL(selogerSearchUrl(wanted, "AD08FR23619"));
  assert.equal(url.origin + url.pathname, "https://www.seloger.com/classified-search");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    distributionTypes: "Rent", estateTypes: "Apartment,House", locations: "AD08FR23619",
    numberOfRoomsMin: "1", numberOfRoomsMax: "2", priceMax: "700", spaceMin: "20",
  });
  for (const location of ["Finistère", "Saint-Denis"]) {
    assert.equal(await sourceRequest("pap", { ...wanted, location }, 10, "0.10", 120), null, `${location} : ville non reconnue → source sautée`);
  }
});

test("code de lieu SeLoger : lu dans le journal de l'acteur, vérifié (département), gardé en base, plus jamais redemandé", async () => {
  const { parseSelogerResolution, selogerLocationCode, sourceRequest } = await import("./sources");
  const { resolvePlace } = await import("../../lib/places");
  const line = "2026-10-01T11:24:52Z [apify] INFO  Location resolved: 'Saint-Denis' -> AD08FR111 (Saint-Denis (974))\n";
  assert.deepEqual(parseSelogerResolution(line, { department: "974" }), { code: "AD08FR111", label: "Saint-Denis (974)" });
  assert.equal(parseSelogerResolution(line, { department: "93" }), null, "homonyme d'un autre département");
  assert.equal(parseSelogerResolution("Total available: 0", { department: "59" }), null);

  const lille = resolvePlace("Lille");
  assert.equal(lille.status, "resolved");
  if (lille.status !== "resolved") return;
  calls.length = 0;
  assert.equal(await selogerLocationCode(lille.commune), "AD08FR23619");
  assert.equal(await selogerLocationCode(lille.commune), "AD08FR23619");
  assert.equal(calls.filter(call => call.startsWith("POST")).length, 1, "un seul run de résolution, puis la base");
  const request = await sourceRequest("seloger", { ...criteria, maxPrice: 700 }, 10, "0.10", 120);
  const input = JSON.parse(String(request?.input)) as { startUrls: string[]; deepScrape: boolean };
  assert.equal(input.deepScrape, true, "sans le détail : ni description ni coordonnées");
  assert.equal(new URL(input.startUrls[0]).searchParams.get("locations"), "AD08FR23619");
  assert.equal(new URL(input.startUrls[0]).searchParams.get("distributionTypes"), "Rent");
});

test("mélange des sources : une annonce de chaque site à tour de rôle, doublons entre sites retirés", async () => {
  const { interleave, sameHome } = await import("./sources");
  const home = (name: string, price: number, area: number, lat: number | null = null, rooms: number | null = 1) => ({ name, price, area, rooms, lat, lng: lat == null ? null : 3.06 });
  const merged = interleave([
    [home("lbc-1", 600, 30, 50.630), home("lbc-2", 561, 23), home("lbc-3", 561, 23)],
    [home("sl-1", 700, 40), home("sl-2", 600, 30.5, 50.6301), home("sl-3", 561, 23)],
    [home("pap-1", 550, 25)],
  ]);
  assert.deepEqual(merged.map(item => item.name), ["lbc-1", "sl-1", "pap-1", "lbc-2", "lbc-3"],
    "sl-2 = lbc-1 et sl-3 = lbc-2 republiées sur SeLoger ; lbc-2 et lbc-3, deux studios identiques d'un même site, gardés");
  assert.equal(sameHome(home("a", 600, 30, 50.63), home("b", 600, 30, 50.66)), false, "même loyer et surface mais à 3 km");
  assert.equal(sameHome(home("a", 600, 30), home("b", 610, 30)), false);
  assert.equal(sameHome(home("a", 600, 30, null, 1), home("b", 600, 30, null, 2)), false, "sans position : pièces différentes");
});

test("LISTING_SOURCES coupe une source sans changer le code ; toutes actives par défaut", async () => {
  const { enabledExtraSources } = await import("./sources");
  const previous = process.env.LISTING_SOURCES;
  try {
    delete process.env.LISTING_SOURCES;
    assert.deepEqual(enabledExtraSources(), ["seloger", "pap"]);
    process.env.LISTING_SOURCES = "leboncoin, PAP";
    assert.deepEqual(enabledExtraSources(), ["pap"]);
    process.env.LISTING_SOURCES = "leboncoin";
    assert.deepEqual(enabledExtraSources(), []);
  } finally {
    if (previous === undefined) delete process.env.LISTING_SOURCES; else process.env.LISTING_SOURCES = previous;
  }
});
