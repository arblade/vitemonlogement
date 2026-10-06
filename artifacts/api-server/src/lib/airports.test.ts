import assert from "node:assert/strict";
import test from "node:test";
import { AIRPORTS, matchAirport } from "./airports";
import { geocodeLandmark } from "./geocode";
import { resolvePlace } from "./places";

const name = (address: string, city = "") => {
  const match = matchAirport(address, city);
  return match.status === "found" ? match.airport.name : match.status;
};

test("matchAirport : « aéroport de Lyon » → Saint-Exupéry, pas Bron (que l'IGN renvoie) ; Bron seulement s'il est nommé", () => {
  assert.equal(name("aéroport de Lyon"), "Aéroport de Lyon-Saint-Exupéry");
  assert.equal(name("l'aéroport Saint-Exupéry"), "Aéroport de Lyon-Saint-Exupéry");
  assert.equal(name("aérodrome de Bron"), "Aéroport de Lyon-Bron");
});

test("matchAirport : « aéroport de Paris » est ambigu (Roissy ou Orly) ; Roissy, CDG ou Orly tranchent, même sans le mot « aéroport »", () => {
  const paris = matchAirport("aéroport de Paris");
  assert.equal(paris.status, "ambiguous");
  assert.deepEqual(paris.status === "ambiguous" && paris.candidates.map(airport => airport.name), ["Aéroport de Paris-Charles de Gaulle", "Aéroport de Paris-Orly"]);
  assert.equal(name("Roissy"), "Aéroport de Paris-Charles de Gaulle");
  assert.equal(name("Roissy-CDG"), "Aéroport de Paris-Charles de Gaulle");
  assert.equal(name("aéroport Charles-de-Gaulle"), "Aéroport de Paris-Charles de Gaulle");
  assert.equal(name("aéroport d'Orly"), "Aéroport de Paris-Orly");
});

test("matchAirport : noms qui ne correspondent pas mot pour mot (« aéroport Nantes », « aéroport de Bordeaux ») et accents ignorés", () => {
  assert.equal(name("aéroport Nantes"), "Aéroport de Nantes-Atlantique");
  assert.equal(name("AEROPORT DE BORDEAUX"), "Aéroport de Bordeaux-Mérignac");
  assert.equal(name("aéroport de Mérignac"), "Aéroport de Bordeaux-Mérignac");
  assert.equal(name("aéroport de Rennes"), "Aéroport de Rennes-Saint-Jacques");
});

test("matchAirport : « l'aéroport » tout court → celui de la ville recherchée ; un autre aéroport nommé ne prend jamais celui de la ville", () => {
  assert.equal(name("l'aéroport", "Toulouse"), "Aéroport de Toulouse-Blagnac");
  assert.equal(name("aéroport", "Lille"), "Aéroport de Lille-Lesquin");
  assert.equal(name("aéroport de Quimper", "Rennes"), "none", "Quimper n'est pas dans la table : recherche générale, pas Rennes");
  assert.equal(name("l'aéroport", "Quimper"), "none");
  assert.equal(name("l'aéroport", "Paris"), "ambiguous");
});

test("matchAirport : sans le mot « aéroport », ni une gare, ni une rue, ni une ville desservie ne sont des aéroports", () => {
  assert.equal(name("gare de Lyon"), "none");
  assert.equal(name("rue Saint-Exupéry"), "none");
  assert.equal(name("Bron"), "none");
  assert.equal(name("Lyon"), "none");
  assert.equal(name("gare de Lyon Part-Dieu", "Lyon"), "none");
});

test("AIRPORTS : chaque commune et chaque ville desservie est reconnue par la base des communes (la ville de recherche en dépend)", () => {
  for (const airport of AIRPORTS) {
    assert.equal(resolvePlace(`${airport.commune} (${airport.department})`).status, "resolved", airport.commune);
    for (const city of airport.serves) assert.notEqual(resolvePlace(city).status, "unknown", city);
    assert.ok(airport.lat > 41 && airport.lat < 51.2 && airport.lng > -5 && airport.lng < 9.6, `${airport.name} en France métropolitaine`);
  }
});

test("geocodeLandmark : un grand aéroport ne coûte aucun appel réseau et donne la ville desservie ; Paris ambigu → null, sans demander à l'IGN (Le Bourget)", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL) => { calls.push(String(input)); return Response.json({ features: [] }); }) as typeof fetch;
  assert.deepEqual(await geocodeLandmark("aéroport de Lyon", "", fetcher),
    { lat: 45.741353, lng: 5.077953, label: "Aéroport de Lyon-Saint-Exupéry, Colombier-Saugnieu", searchCity: "Lyon" });
  assert.equal((await geocodeLandmark("aéroport de Lille", "", fetcher))?.searchCity, "Lille");
  assert.equal(await geocodeLandmark("aéroport de Paris", "", fetcher), null);
  assert.deepEqual(calls, []);
});
