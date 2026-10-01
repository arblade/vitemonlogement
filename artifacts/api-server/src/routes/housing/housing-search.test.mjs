import assert from "node:assert/strict";
import test from "node:test";
import { actorRequest, housingActorInput, isHousingListingUrl, focusedSearchTerm, LEBONCOIN_ACTORS } from "./housing-search.ts";

const url = request => new URL(request.input.startUrls[0]);

test("ville reconnue : acteur fatihtahta, URL limitée aux appartements et maisons, pièces, surface, budget, ville avec coordonnées", () => {
  const criteria = {
    intent: "rent", location: "Quimper", keywords: "", radius: 5,
    minPrice: 400, maxPrice: 1200, minArea: 30, maxArea: 50, minRooms: 1, maxRooms: 2, wishes: ["place de parking disponible"],
  };
  const request = housingActorInput(criteria);
  assert.equal(request.actor, "fatihtahta~leboncoin-fr-scraper");
  assert.deepEqual(Object.keys(request.input).sort(), ["limit", "startUrls"]);
  assert.equal(request.input.limit, 10);
  const params = url(request).searchParams;
  assert.equal(url(request).origin + url(request).pathname, "https://www.leboncoin.fr/recherche");
  assert.equal(params.get("category"), "10", "catégorie Locations : jamais de vente");
  assert.equal(params.get("real_estate_type"), "1,2", "jamais de parking, terrain ni « autre »");
  assert.match(params.get("locations"), /^Quimper_29000__47\.\d{5}_-4\.\d{5}_5000$/);
  assert.equal(params.get("rooms"), "1-2");
  assert.equal(params.get("square"), "30-50");
  assert.equal(params.get("price"), "400-1200");
  assert.equal(params.get("text"), "parking");
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

test("ville non reconnue (département, homonyme) : repli sur clearpath, qui cherche un lieu par son nom, toujours en location", () => {
  for (const location of ["Finistère", "Saint-Denis"]) {
    const { actor, input } = housingActorInput({ intent: "buy", location, keywords: "maison avec jardin", wishes: ["garage"], minPrice: 400, maxPrice: 1200 });
    assert.equal(actor, LEBONCOIN_ACTORS.byName, location);
    assert.equal(input.category, "10");
    assert.equal(input.location, location);
    assert.equal(input.searchQuery, "garage");
    assert.equal(input.price_max_filter, 1200);
    assert.equal(input.adLimit, 10, "minimum imposé par clearpath");
  }
});

test("mot-clé : le premier équipement explicite", () => {
  assert.equal(focusedSearchTerm({ intent: "rent", location: "Paris", keywords: "", wishes: ["balcon", "parking"] }), "balcon");
});

test("suivi : requête unique (plus de recherche élargie), chemin de l'acteur et paramètres exacts", () => {
  const criteria = { intent: "rent", location: "Quimper", radius: 5, minPrice: 400, maxPrice: 1200, keywords: "", wishes: ["parking"] };
  const request = actorRequest(criteria, 10, "0.10", 120);
  assert.equal(request.path, "/v2/acts/fatihtahta~leboncoin-fr-scraper/runs?maxItems=10&maxTotalChargeUsd=0.10&timeout=120");
  assert.equal(request.batch, "focused");
  assert.equal(new URL(JSON.parse(request.input).startUrls[0]).searchParams.get("text"), "parking");
  const fallback = actorRequest({ ...criteria, location: "Finistère" }, 10, "0.10", 120);
  assert.match(fallback.path, /^\/v2\/acts\/clearpath~leboncoin-api\/runs\?/);
});

test("rejects products and sales while keeping rental listings", () => {
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/jeux_jouets/3195605873"), false);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/ameublement/3274278581"), false);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/locations/3266176799"), true);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/colocations/3259546204"), true);
  assert.equal(isHousingListingUrl("https://www.leboncoin.fr/ad/ventes_immobilieres/123"), false);
  assert.equal(isHousingListingUrl("https://leboncoin.fr.evil.test/ad/locations/123"), false);
});