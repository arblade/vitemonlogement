import assert from "node:assert/strict";
import test from "node:test";
import { geocode, geocodeLandmark, locatePlaces } from "./geocode";
import type { Place } from "../routes/housing/store";

/** Faux géocodeur : répond selon l'index demandé et mémorise les requêtes. */
function fakeGeocoder(replies: Partial<Record<"address" | "poi", unknown>> | { status: number }) {
  const calls: URL[] = [];
  const fetcher = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    if ("status" in replies) return new Response("{}", { status: replies.status as number });
    const index = url.searchParams.get("index") as "address" | "poi";
    return Response.json(replies[index] ?? { features: [] });
  }) as typeof fetch;
  return { fetcher, calls };
}

const address = (type: string, score: number, label = "20 Place des Lices 35000 Rennes") =>
  ({ features: [{ geometry: { coordinates: [-1.682821, 48.113521] }, properties: { type, score, label } }] });
const poi = { features: [{ geometry: { coordinates: [-1.70349, 48.120667] }, properties: { toponym: "Université Rennes 2 Haute Bretagne", city: ["Rennes"], score: 0.84 } }] };

test("geocode : une adresse exacte est retenue telle quelle, avec la ville ajoutée à la requête", async () => {
  const { fetcher, calls } = fakeGeocoder({ address: address("housenumber", 0.97) });
  assert.deepEqual(await geocode("20 place des Lices", "Rennes", fetcher), { lat: 48.113521, lng: -1.682821, label: "20 Place des Lices 35000 Rennes" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("q"), "20 place des Lices, Rennes");
  assert.equal(calls[0].origin + calls[0].pathname, "http://127.0.0.1:1/search", "passe par GEOCODER_BASE_URL (neutralisé en test)");
});

test("geocode : la ville n'est pas répétée si l'adresse la contient déjà", async () => {
  const { fetcher, calls } = fakeGeocoder({ address: address("street", 0.9) });
  await geocode("rue de Paris à Rennes", "Rennes", fetcher);
  assert.equal(calls[0].searchParams.get("q"), "rue de Paris à Rennes");
});

test("geocode : une simple commune n'est pas une adresse → on cherche un lieu nommé (université, gare…)", async () => {
  const { fetcher, calls } = fakeGeocoder({ address: address("municipality", 0.95, "Rennes"), poi });
  assert.deepEqual(await geocode("Université Rennes 2", "Rennes", fetcher), { lat: 48.120667, lng: -1.70349, label: "Université Rennes 2 Haute Bretagne, Rennes" });
  assert.deepEqual(calls.map(url => url.searchParams.get("index")), ["address", "poi"]);
});

test("geocode : score trop faible, réponse vide ou erreur réseau → null, jamais d'exception", async () => {
  assert.equal(await geocode("n'importe quoi", "", fakeGeocoder({ address: address("housenumber", 0.2) }).fetcher), null);
  assert.equal(await geocode("n'importe quoi", "", fakeGeocoder({}).fetcher), null);
  assert.equal(await geocode("12 rue X", "", fakeGeocoder({ status: 500 }).fetcher), null);
  assert.equal(await geocode("12 rue X", ""), null, "vrai fetch vers le port mort du garde-fou hors-ligne");
});

test("locatePlaces : chaque lieu reçoit ses coordonnées et l'adresse retrouvée ; un lieu introuvable reste sans coordonnées", async () => {
  const places: Place[] = [
    { id: "place-1", label: "Travail", kind: "work", address: "20 place des Lices" },
    { id: "place-2", label: "École", kind: "school", address: "introuvable" },
  ];
  const fetcher = (async (input: string | URL) => {
    const q = new URL(String(input)).searchParams.get("q") ?? "";
    return Response.json(q.startsWith("20 place") ? address("housenumber", 0.97) : { features: [] });
  }) as typeof fetch;
  const [work, school] = await locatePlaces(places, "Rennes", fetcher);
  assert.equal(work.lat, 48.113521);
  assert.equal(work.resolved, "20 Place des Lices 35000 Rennes");
  assert.equal(school.lat, undefined);
  assert.equal(school.address, "introuvable");
});


// --- Lieux repères (aéroport, gare, hôpital…) : IGN « poi », puis adresse, puis OpenStreetMap ---

// Quimper : absent de la table des grands aéroports (airports.ts), il passe par l'index des lieux de l'IGN.
const airportPoi = (over: Record<string, unknown> = {}) => ({ geometry: { coordinates: [-4.167786, 47.974957] }, properties: {
  toponym: "Aéroport de Quimper-Bretagne", category: ["aérodrome", "transport"], city: ["Pluguffan"], depcode: ["29"], score: 0.85, ...over } });

/** Faux IGN (poi / address) et faux Nominatim, dans un même fetcher : on voit qui est appelé et dans quel ordre. */
function fakeServices(replies: { poi?: unknown[]; address?: unknown[]; nominatim?: unknown[] | { status: number } }) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/search") && url.searchParams.get("format")) {
      calls.push(`nominatim:${url.searchParams.get("q")}`);
      if (replies.nominatim && "status" in replies.nominatim) return new Response("{}", { status: replies.nominatim.status });
      return Response.json(replies.nominatim ?? []);
    }
    const index = url.searchParams.get("index") as "poi" | "address";
    calls.push(`${index}:${url.searchParams.get("q")}`);
    return Response.json({ features: replies[index] ?? [] });
  }) as typeof fetch;
  return { fetcher, calls };
}

test("geocodeLandmark : « aéroport de Quimper » → l'aérodrome de l'index des lieux, nom seul (la ville ajoutée fait échouer la recherche), avec sa commune", async () => {
  const { fetcher, calls } = fakeServices({ poi: [airportPoi()] });
  assert.deepEqual(await geocodeLandmark("aéroport de Quimper", "Quimper", fetcher),
    { lat: 47.974957, lng: -4.167786, label: "Aéroport de Quimper-Bretagne, Pluguffan", searchCity: "Pluguffan (29)" });
  assert.deepEqual(calls, ["poi:aéroport de Quimper"]);
});

test("geocodeLandmark : un quartier ou un résultat dont le nom ne correspond pas n'est jamais pris (« Sud Gare » n'est pas la gare)", async () => {
  const sudGare = { geometry: { coordinates: [-1.67, 48.1] }, properties: { toponym: "Sud Gare", category: ["quartier", "zone d'habitation"], city: ["Rennes"], score: 0.39 } };
  const gare = { geometry: { coordinates: [-1.672023, 48.103421] }, properties: { toponym: "Rennes", category: ["gare voyageurs et fret", "transport"], city: ["Rennes"], score: 0.35 } };
  const homonym = { geometry: { coordinates: [2, 47] }, properties: { toponym: "Parc des expositions", category: ["équipement"], city: ["Lyon"], score: 0.9 } };
  const found = await geocodeLandmark("gare de Rennes", "Rennes", fakeServices({ poi: [sudGare, gare] }).fetcher);
  assert.deepEqual(found, { lat: 48.103421, lng: -1.672023, label: "gare de Rennes", searchCity: "Rennes" }, "la gare s'appelle « Rennes » dans la base : on garde le nom demandé");
  assert.equal(await geocodeLandmark("gare de Rennes", "", fakeServices({ poi: [sudGare] }).fetcher), null);
  assert.equal(await geocodeLandmark("gare de Rennes", "", fakeServices({ poi: [homonym] }).fetcher), null);
});

test("geocodeLandmark : sans réponse de l'IGN « poi », l'adresse ordinaire puis OpenStreetMap, dans cet ordre", async () => {
  const hospital = { lat: "48.1207424", lon: "-1.6948572", category: "amenity", type: "hospital", display_name: "Hôpital Pontchaillou, 2, Rue Henri Le Guilloux, Rennes, Ille-et-Vilaine" };
  const { fetcher, calls } = fakeServices({ nominatim: [hospital] });
  assert.deepEqual(await geocodeLandmark("CHU de Rennes", "Rennes", fetcher), { lat: 48.1207424, lng: -1.6948572, label: "Hôpital Pontchaillou" });
  assert.deepEqual(calls, ["poi:CHU de Rennes", "address:CHU de Rennes", "nominatim:CHU de Rennes"]);
});

test("geocodeLandmark : OpenStreetMap n'est cru que pour de vrais équipements, dans la ville recherchée (pas un arrêt de bus, pas un homonyme)", async () => {
  const busStop = { lat: "47.97", lon: "-4.16", category: "highway", type: "bus_stop", display_name: "Aéroport, Bus, Quimper" };
  const elsewhere = { lat: "45.7", lon: "5.0", category: "aeroway", type: "aerodrome", display_name: "Aéroport de Lyon, Colombier-Saugnieu, Rhône" };
  const rightOne = { lat: "47.975", lon: "-4.1678", category: "aeroway", type: "aerodrome", display_name: "Aéroport de Quimper Bretagne, Pluguffan, Quimper, Finistère" };
  assert.equal(await geocodeLandmark("aéroport", "Quimper", fakeServices({ nominatim: [busStop, elsewhere] }).fetcher), null);
  assert.deepEqual(await geocodeLandmark("aéroport", "Quimper", fakeServices({ nominatim: [busStop, elsewhere, rightOne] }).fetcher), { lat: 47.975, lng: -4.1678, label: "Aéroport de Quimper Bretagne" });
});

test("geocodeLandmark : une panne (IGN ou OpenStreetMap, limite de débit 429) donne null, jamais d'exception ; User-Agent envoyé à Nominatim", async () => {
  assert.equal(await geocodeLandmark("aéroport de Quimper", "Quimper", fakeServices({ nominatim: { status: 429 } }).fetcher), null);
  assert.equal(await geocodeLandmark("aéroport de Quimper", "Quimper"), null, "vrai fetch vers le port mort du garde-fou hors-ligne");
  let agent = "";
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    if (new URL(String(input)).searchParams.get("format")) agent = String((init?.headers as Record<string, string>)["User-Agent"]);
    return Response.json(new URL(String(input)).searchParams.get("format") ? [] : { features: [] });
  }) as typeof fetch;
  await geocodeLandmark("CHU", "", fetcher);
  assert.match(agent, /^vitemonlogement\//);
});

test("locatePlaces : un lieu avec contrainte de distance passe par la recherche de lieux repères, un lieu de vie ordinaire par la recherche d'adresse", async () => {
  const places: Place[] = [
    { id: "place-1", label: "Aéroport de Quimper", kind: "other", address: "aéroport de Quimper", maxMinutes: 30 },
    { id: "place-2", label: "Travail", kind: "work", address: "20 place des Lices" },
  ];
  const { fetcher, calls } = fakeServices({ poi: [airportPoi()], address: [{ geometry: { coordinates: [-1.682821, 48.113521] }, properties: { type: "housenumber", score: 0.97, label: "20 Place des Lices 35000 Rennes" } }] });
  const [airport, work] = await locatePlaces(places, "Rennes", fetcher);
  assert.deepEqual([airport.lat, airport.lng, airport.resolved], [47.974957, -4.167786, "Aéroport de Quimper-Bretagne, Pluguffan"]);
  assert.equal(airport.maxMinutes, 30, "la contrainte est conservée");
  assert.equal(work.lat, 48.113521);
  assert.deepEqual(calls.sort(), ["address:20 place des Lices, Rennes", "poi:aéroport de Quimper"]);
});
