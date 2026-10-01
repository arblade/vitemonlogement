import assert from "node:assert/strict";
import test from "node:test";
import { actorRequest, housingActorInput, isHousingListingUrl, focusedSearchTerm, shouldRunBroad } from "./housing-search.ts";

const url = input => new URL(input.searchUrl);

test("ville reconnue : URL Le Bon Coin limitée aux appartements et maisons, pièces, surface, budget, ville avec coordonnées", () => {
  const criteria = {
    intent: "rent", location: "Quimper", keywords: "", radius: 5,
    minPrice: 400, maxPrice: 1200, minArea: 30, maxArea: 50, minRooms: 1, maxRooms: 2, wishes: ["place de parking disponible"],
  };
  const input = housingActorInput(criteria);
  const params = url(input).searchParams;
  assert.equal(url(input).origin + url(input).pathname, "https://www.leboncoin.fr/recherche");
  assert.equal(params.get("category"), "10");
  assert.equal(params.get("real_estate_type"), "1,2", "jamais de parking, terrain ni « autre »");
  assert.match(params.get("locations"), /^Quimper_29000__47\.\d{5}_-4\.\d{5}_5000$/);
  assert.equal(params.get("rooms"), "1-2");
  assert.equal(params.get("square"), "30-50");
  assert.equal(params.get("price"), "400-1200");
  assert.equal(params.get("text"), "parking");
  assert.deepEqual([input.adLimit, input.mode, input.includeSeller, input.includePhone, input.shippable], [10, "standard", false, false, false]);
  assert.equal("location" in input || "category" in input || "searchQuery" in input, false, "les champs manuels seraient ignorés");
  const broad = url(housingActorInput(criteria, "broad")).searchParams;
  assert.equal(broad.get("text"), null);
  assert.equal(broad.get("price"), "400-1200");
});

test("bornes ouvertes : « min » / « max » ; aucune borne → paramètre absent ; rayon en mètres", () => {
  const params = url(housingActorInput({ intent: "rent", location: "Lille", keywords: "", radius: 10, minRooms: 2, maxPrice: 700 })).searchParams;
  assert.equal(params.get("rooms"), "2-max");
  assert.equal(params.get("price"), "min-700");
  assert.equal(params.get("square"), null);
  assert.match(params.get("locations"), /_10000$/);
  const exact = url(housingActorInput({ intent: "rent", location: "Rennes", keywords: "", minRooms: 2, maxRooms: 2 })).searchParams;
  assert.equal(exact.get("rooms"), "2-2");
});

test("ville non reconnue (département, homonyme) : repli sur la requête par champs, toujours en location", () => {
  for (const location of ["Finistère", "Saint-Denis"]) {
    const input = housingActorInput({ intent: "buy", location, keywords: "maison avec jardin", wishes: ["garage"], minPrice: 400, maxPrice: 1200 });
    assert.equal(input.searchUrl, undefined, location);
    assert.equal(input.category, "10");
    assert.equal(input.location, location);
    assert.equal(input.searchQuery, "garage");
    assert.equal(input.price_max_filter, 1200);
  }
});

test("a second pass is conditional on 40 valid focused matches and a real broadening", () => {
  assert.equal(shouldRunBroad(0, true), true);
  assert.equal(shouldRunBroad(39, true), true);
  assert.equal(shouldRunBroad(40, true), false);
  assert.equal(shouldRunBroad(100, true), false);
  assert.equal(shouldRunBroad(5, false), false);
  assert.equal(focusedSearchTerm({ intent: "rent", location: "Paris", keywords: "", wishes: ["balcon", "parking"] }), "balcon");
});

test("debug trace captures the exact focused and broad actor payloads", () => {
  const criteria = { intent: "rent", location: "Quimper", radius: 5, minPrice: 400, maxPrice: 1200, keywords: "", wishes: ["parking"] };
  const focused = actorRequest(criteria, "focused", 10, "0.10", 120);
  const broad = actorRequest(criteria, "broad", 10, "0.10", 120);
  assert.match(focused.path, /maxItems=10&maxTotalChargeUsd=0\.10&timeout=120/);
  assert.equal(new URL(JSON.parse(focused.input).searchUrl).searchParams.get("text"), "parking");
  assert.equal(new URL(JSON.parse(broad.input).searchUrl).searchParams.get("text"), null);
  assert.equal(new URL(JSON.parse(broad.input).searchUrl).searchParams.get("price"), "400-1200");
  assert.equal(focused.batch, "focused");
  assert.equal(broad.batch, "broad");
});
test("rejects products and sales while keeping rental listings", () => {
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/jeux_jouets/3195605873"), false);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/ameublement/3274278581"), false);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/locations/3266176799"), true);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/colocations/3259546204"), true);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/ventes_immobilieres/123"), false);
  assert.equal(isHousingListingUrl("https://leboncoin.fr.evil.test/ad/locations/123"), false);
});