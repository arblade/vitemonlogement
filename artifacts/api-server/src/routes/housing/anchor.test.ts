import assert from "node:assert/strict";
import test from "node:test";
import { cityOnlyNamesPlace, placeCriteria } from "./anchor";
import type { Criteria, Place } from "./store";

const PROMPT = "Une maison à moins de 30 min de voiture de l'aéroport de Rennes, moins de 1000 € de loyer, un DPE de minimum D";
const airport = (over: Partial<Place> = {}): Place => ({ id: "place-1", label: "Aéroport", kind: "other", address: "aéroport de Rennes", mode: "drive", maxMinutes: 30, lat: null, lng: null, resolved: null, centered: false, ...over });
const criteriaOf = (location: string, places: Place[]): Criteria => ({ location, intent: "rent", keywords: "", radius: 5, places });
/** Aucun appel réseau attendu (aéroports de la table) : un appel ferait échouer le test. */
const noNetwork = (async (input: string | URL) => { throw new Error(`appel réseau inattendu : ${input}`); }) as typeof fetch;

test("cityOnlyNamesPlace : « …de l'aéroport de Rennes » → Rennes nomme l'aéroport ; « à Rennes, … de l'aéroport » → vraie contrainte de ville", () => {
  assert.equal(cityOnlyNamesPlace(PROMPT, "Rennes", airport()), true);
  assert.equal(cityOnlyNamesPlace("T3 près de l'aéroport Rennes, 30 min max", "Rennes", airport({ address: "aéroport Rennes" })), true);
  assert.equal(cityOnlyNamesPlace("Une maison à Rennes, à moins de 30 min de l'aéroport de Rennes", "Rennes", airport()), false);
  assert.equal(cityOnlyNamesPlace("Un T2 à Rennes, à moins de 20 km de l'aéroport", "Rennes", airport()), false);
  assert.equal(cityOnlyNamesPlace("Un T2 à Bruz, à moins de 20 km de l'aéroport de Rennes", "Bruz", airport()), false, "la ville n'est pas dans le nom du lieu");
});

test("placeCriteria : ville vide (le LLM a vu l'aéroport comme un lieu) → la ville desservie, recherche centrée sur l'aéroport, sans critère « Lieu »", async () => {
  const result = await placeCriteria(PROMPT, criteriaOf("", [airport()]), noNetwork);
  assert.equal(result.location, "Rennes");
  const [place] = result.places!;
  assert.deepEqual([place.lat, place.lng, place.centered, place.resolved], [48.070897, -1.733001, true, "Aéroport de Rennes-Saint-Jacques, Saint-Jacques-de-la-Lande"]);
  assert.deepEqual(result.checks?.map(check => check.id), ["distance-place-1"]);
});

test("placeCriteria : location = Rennes tirée du nom de l'aéroport → recherche centrée sur l'aéroport (plus bloquée dans les 5 km autour de Rennes)", async () => {
  const result = await placeCriteria(PROMPT, criteriaOf("Rennes", [airport()]), noNetwork);
  assert.equal(result.places?.[0].centered, true);
  assert.deepEqual(result.checks?.map(check => check.id), ["distance-place-1"]);
});

test("placeCriteria : « à Rennes, à moins de 30 min de l'aéroport de Rennes » garde la double contrainte (ville ET aéroport)", async () => {
  const result = await placeCriteria("Une maison à Rennes, à moins de 30 min de l'aéroport de Rennes", criteriaOf("Rennes", [airport()]), noNetwork);
  assert.equal(result.places?.[0].centered, false);
  assert.deepEqual(result.checks?.map(check => check.id), ["location", "distance-place-1"]);
});

test("placeCriteria : ville vide et lieu introuvable (ou ambigu : aéroport de Paris) → ville toujours vide, la recherche échouera comme avant", async () => {
  const empty = (async () => Response.json({ features: [] })) as unknown as typeof fetch;
  assert.equal((await placeCriteria("Près de l'aéroport de Paris, 20 min", criteriaOf("", [airport({ address: "aéroport de Paris" })]), noNetwork)).location, "");
  assert.equal((await placeCriteria("À 10 km du CHU", criteriaOf("", [airport({ address: "CHU inconnu", maxKm: 10 })]), empty)).location, "");
});

test("placeCriteria : un lieu de vie sans contrainte ne donne jamais la ville ; sans lieu, rien ne change", async () => {
  const work: Place = { id: "place-1", label: "Travail", kind: "work", address: "20 place des Lices, Rennes" };
  assert.equal((await placeCriteria("Près de mon travail 20 place des Lices", criteriaOf("", [work]), noNetwork)).location, "");
  const plain = criteriaOf("Lille", []);
  assert.equal(await placeCriteria("T2 à Lille", plain, noNetwork), plain);
});
