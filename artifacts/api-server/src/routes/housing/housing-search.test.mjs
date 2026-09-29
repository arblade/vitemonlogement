import assert from "node:assert/strict";
import test from "node:test";
import { actorRequest, housingActorInput, isHousingListingUrl, focusedSearchTerm, shouldRunBroad } from "./housing-search.ts";

test("focused parking search stays restricted to rentals, city and budget", () => {
  const criteria = {
    intent: "rent", location: "Quimper", keywords: "", radius: 5,
    minPrice: 400, maxPrice: 1200, minArea: 30, maxArea: 50, wishes: ["place de parking disponible"],
  };
  const input = housingActorInput(criteria);
  assert.equal(input.category, "10");
  assert.equal(input.location, "Quimper");
  assert.equal(input.price_min_filter, 400);
  assert.equal(input.price_max_filter, 1200);
  assert.equal(input.adLimit, 10);
  assert.equal(input.searchQuery, "parking");
  assert.equal("minArea" in input, false);
  const broad = housingActorInput(criteria, "broad");
  assert.equal("searchQuery" in broad, false);
  assert.equal(broad.category, input.category);
  assert.equal(broad.price_max_filter, input.price_max_filter);
});

test("even a purchase-like request uses rental category and prioritizes a wish", () => {
  const input = housingActorInput({
    intent: "buy", location: "Nantes", keywords: "maison avec jardin", wishes: ["garage"],
  });
  assert.equal(input.category, "10");
  assert.equal(input.searchQuery, "garage");
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
  assert.equal(JSON.parse(focused.input).searchQuery, "parking");
  assert.equal(JSON.parse(broad.input).searchQuery, undefined);
  assert.equal(JSON.parse(broad.input).price_max_filter, 1200);
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