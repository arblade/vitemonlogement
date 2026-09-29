import assert from "node:assert/strict";
import test from "node:test";
import { housingActorInput, isHousingListingUrl } from "./housing-search.ts";

test("a parking wish never becomes a broad product search", () => {
  const input = housingActorInput({
    intent: "rent", location: "Quimper", keywords: "", radius: 5,
    minPrice: 400, maxPrice: 1200, minArea: 30, maxArea: 50, wishes: ["place de parking disponible"],
  });
  assert.equal(input.category, "10");
  assert.equal(input.location, "Quimper");
  assert.equal(input.price_min_filter, 400);
  assert.equal(input.price_max_filter, 1200);
  assert.equal(input.adLimit, 10);
  assert.equal("searchQuery" in input, false);
  assert.equal("minArea" in input, false);
});

test("even a purchase-like request uses rental category and only housing terms", () => {
  const input = housingActorInput({
    intent: "buy", location: "Nantes", keywords: "maison avec jardin", wishes: ["garage"],
  });
  assert.equal(input.category, "10");
  assert.equal(input.searchQuery, "maison");
});

test("rejects products and sales while keeping rental listings", () => {
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/jeux_jouets/3195605873"), false);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/ameublement/3274278581"), false);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/locations/3266176799"), true);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/colocations/3259546204"), true);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/ventes_immobilieres/123"), false);
  assert.equal(isHousingListingUrl("https://leboncoin.fr.evil.test/ad/locations/123"), false);
});