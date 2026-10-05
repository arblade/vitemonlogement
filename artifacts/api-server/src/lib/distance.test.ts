import assert from "node:assert/strict";
import test from "node:test";
import { airKm, estimateMinutes, evaluatePlace, placeCheckLabel, placeReachKm, reachKm } from "./distance";
import type { Place } from "../routes/housing/store";

const airport: Place = { id: "place-1", label: "Aéroport de Rennes", kind: "other", address: "aéroport de Rennes", lat: 48.0709, lng: -1.733, resolved: "Aéroport de Rennes-Saint-Jacques" };
// Points à ~ 6 km de l'aéroport (centre de Rennes) et ~ 25 km (Vitré).
const rennes = { lat: 48.1113, lng: -1.6794 };
const vitre = { lat: 48.1245, lng: -1.2075 };

test("airKm : distance à vol d'oiseau (Rennes centre ↔ aéroport ≈ 6 km, Rennes ↔ Paris ≈ 308 km)", () => {
  assert.ok(Math.abs(airKm(rennes, airport as { lat: number; lng: number }) - 6) < 0.3);
  assert.ok(Math.abs(airKm(rennes, { lat: 48.8566, lng: 2.3522 }) - 308) < 4);
  assert.equal(airKm(rennes, rennes), 0);
});

test("durée estimée et rayon d'atteinte sont réciproques ; le moyen de transport change la vitesse", () => {
  for (const mode of ["drive", "transit", "bike", "walk"] as const) assert.ok(Math.abs(estimateMinutes(reachKm(30, mode), mode) - 30) < 1e-9, mode);
  assert.ok(reachKm(30, "drive") > reachKm(30, "bike") && reachKm(30, "bike") > reachKm(30, "walk"));
});

test("placeReachKm : le plus strict de la distance et de la durée ; null sans contrainte", () => {
  assert.equal(placeReachKm({ maxKm: 5, maxMinutes: null }), 5);
  assert.equal(placeReachKm({ maxKm: null, maxMinutes: 30 }), reachKm(30, "drive"));
  assert.equal(placeReachKm({ maxKm: 50, maxMinutes: 30, mode: "bike" }), reachKm(30, "bike"));
  assert.equal(placeReachKm({ maxKm: null, maxMinutes: null }), null);
});

test("placeCheckLabel : durée avec le moyen de transport (voiture par défaut) et/ou distance", () => {
  assert.equal(placeCheckLabel({ ...airport, maxMinutes: 30 }), "À moins de 30 min en voiture · Aéroport de Rennes");
  assert.equal(placeCheckLabel({ ...airport, maxKm: 10 }), "À moins de 10 km à vol d'oiseau · Aéroport de Rennes");
  assert.equal(placeCheckLabel({ ...airport, maxMinutes: 20, mode: "bike", maxKm: 4 }), "À moins de 20 min à vélo et 4 km à vol d'oiseau · Aéroport de Rennes");
});

const check = (place: Place, listing: Parameters<typeof evaluatePlace>[3]) => evaluatePlace("distance-place-1", "critère", place, listing);

test("evaluatePlace (km) : adresse précise tranchée sur la ligne droite", () => {
  const near = check({ ...airport, maxKm: 8 }, { ...rennes, geoPrecision: "streetNumber" });
  assert.equal(near.status, "confirmed");
  assert.match(near.value, /^6(,\d)? km à vol d'oiseau$/);
  assert.match(near.evidence, /l'adresse de l'annonce/);
  assert.equal(check({ ...airport, maxKm: 3 }, { ...rennes, geoPrecision: "street" }).status, "contradicted");
  assert.equal(check({ ...airport, maxKm: 3 }, { ...vitre, geoPrecision: "street" }).status, "contradicted");
});

test("evaluatePlace : position approximative (quartier, commune) → marge de 2 km, « à vérifier » près de la limite", () => {
  const limit = airKm(rennes, airport as { lat: number; lng: number });
  assert.equal(check({ ...airport, maxKm: limit + 3 }, { ...rennes, geoPrecision: "district" }).status, "confirmed");
  assert.equal(check({ ...airport, maxKm: limit + 1 }, { ...rennes, geoPrecision: "district" }).status, "unknown");
  assert.equal(check({ ...airport, maxKm: limit - 1 }, { ...rennes, geoPrecision: "district" }).status, "unknown");
  assert.equal(check({ ...airport, maxKm: limit - 3 }, { ...rennes, geoPrecision: "city" }).status, "contradicted");
  assert.match(check({ ...airport, maxKm: 30 }, { ...rennes, geoPrecision: "district" }).evidence, /zone de l'annonce \(position approximative\)/);
});

test("evaluatePlace (minutes) : tranché loin de la limite, « à vérifier » dans la zone d'incertitude, durée estimée affichée", () => {
  const exact = { ...rennes, geoPrecision: "street" };
  const estimate = estimateMinutes(airKm(rennes, airport as { lat: number; lng: number }), "drive");
  assert.equal(check({ ...airport, maxMinutes: 30 }, exact).status, "confirmed");
  assert.equal(check({ ...airport, maxMinutes: Math.ceil(estimate * 1.1) }, exact).status, "unknown");
  assert.equal(check({ ...airport, maxMinutes: Math.floor(estimate * 0.7) }, exact).status, "contradicted");
  const result = check({ ...airport, maxMinutes: 30 }, exact);
  assert.match(result.value, /≈ \d+ min en voiture/);
  assert.match(result.evidence, /estimation, sans trafic réel/);
  assert.equal(check({ ...airport, maxMinutes: 30, mode: "walk" }, exact).status, "contradicted", "à pied, 30 min ne suffisent pas pour 6 km");
});

test("evaluatePlace : distance ET durée, une seule contradiction suffit ; jamais d'invention sans position", () => {
  const exact = { ...rennes, geoPrecision: "street" };
  assert.equal(check({ ...airport, maxKm: 2, maxMinutes: 60 }, exact).status, "contradicted");
  assert.equal(check({ ...airport, maxKm: 20, maxMinutes: 60 }, exact).status, "confirmed");
  assert.equal(check({ ...airport, maxKm: 20 }, { lat: null, lng: null, geoPrecision: null }).status, "unknown");
  assert.equal(check({ ...airport, lat: null, lng: null, maxKm: 20 }, exact).status, "unknown", "lieu non géocodé");
  assert.equal(check(airport, exact).status, "unknown", "aucune limite : rien à vérifier");
});
