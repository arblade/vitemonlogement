import assert from "node:assert/strict";
import test from "node:test";
import { geocode, locatePlaces } from "./geocode";
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
    { id: "place-1", label: "Travail", kind: "work", address: "20 place des Lices", mode: "transit" },
    { id: "place-2", label: "École", kind: "school", address: "introuvable", mode: "walk" },
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
