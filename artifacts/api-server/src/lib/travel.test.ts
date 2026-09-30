import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { closeDatabase } from "./database";
import { useMemoryDatabase } from "../test/helpers";
import { decodePolyline, nextTuesdayNineParis, routeKey, RoutingQuotaError, travelRoute } from "./travel";

before(async () => { await useMemoryDatabase(); });
after(async () => { await closeDatabase(); });
beforeEach(() => { process.env.GOOGLE_MAPS_API_KEY = "cle-de-test"; delete process.env.GOOGLE_ROUTES_PER_DAY; });

const home = { lat: 48.1135, lng: -1.6828 };
const work = { lat: 48.1207, lng: -1.7035 };

/** Faux Google Routes : mémorise chaque requête (URL, en-têtes, corps). */
function fakeGoogle(reply: unknown = { routes: [{ duration: "1534s", distanceMeters: 5210, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }] }) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return Response.json(reply);
  }) as typeof fetch;
  return { fetcher, calls };
}

test("decodePolyline : exemple officiel de Google", () => {
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  assert.deepEqual(decodePolyline(""), []);
});

test("nextTuesdayNineParis : mardi suivant 9 h de Paris, en heure d'hiver comme d'été", () => {
  assert.equal(nextTuesdayNineParis(new Date("2026-09-30T10:00:00Z")), "2026-10-06T07:00:00.000Z"); // mercredi → mardi 6, UTC+2
  assert.equal(nextTuesdayNineParis(new Date("2026-12-01T10:00:00Z")), "2026-12-08T08:00:00.000Z"); // un mardi → le suivant, UTC+1
});

test("travelRoute : requête Google conforme (clé, masque de champs, transport en commun arrivée mardi 9 h) et réponse décodée", async () => {
  const { fetcher, calls } = fakeGoogle();
  const route = await travelRoute("transit", home, work, fetcher);
  assert.deepEqual(route, { durationSeconds: 1534, distanceMeters: 5210, path: [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:1/directions/v2:computeRoutes");
  assert.equal(calls[0].headers.get("X-Goog-Api-Key"), "cle-de-test");
  assert.equal(calls[0].headers.get("X-Goog-FieldMask"), "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline");
  assert.equal(calls[0].body.travelMode, "TRANSIT");
  assert.match(String(calls[0].body.arrivalTime), /^\d{4}-\d\d-\d\dT0[78]:00:00\.000Z$/);
  assert.equal(calls[0].body.routingPreference, undefined, "interdit en transport en commun");
  assert.deepEqual(calls[0].body.origin, { location: { latLng: { latitude: home.lat, longitude: home.lng } } });
});

test("travelRoute : voiture sans trafic (tarif le plus bas), vélo et marche sans horaire", async () => {
  const { fetcher, calls } = fakeGoogle();
  await travelRoute("drive", home, { lat: 48.2, lng: -1.7 }, fetcher);
  await travelRoute("bike", home, { lat: 48.21, lng: -1.7 }, fetcher);
  await travelRoute("walk", home, { lat: 48.22, lng: -1.7 }, fetcher);
  assert.deepEqual(calls.map(call => [call.body.travelMode, call.body.routingPreference, call.body.arrivalTime]),
    [["DRIVE", "TRAFFIC_UNAWARE", undefined], ["BICYCLE", undefined, undefined], ["WALK", undefined, undefined]]);
});

test("travelRoute : un trajet déjà calculé est relu en base, sans nouvel appel payant", async () => {
  const { fetcher, calls } = fakeGoogle();
  const to = { lat: 48.3, lng: -1.7 };
  const first = await travelRoute("walk", home, to, fetcher);
  const again = await travelRoute("walk", { lat: home.lat + 0.000001, lng: home.lng }, to, fetcher); // même point à 10 cm près
  assert.deepEqual(again, first);
  assert.equal(calls.length, 1);
  await travelRoute("bike", home, to, fetcher);
  assert.equal(calls.length, 2, "un autre mode est un autre trajet");
});

test("travelRoute : « aucun itinéraire » est mémorisé (null) et n'est pas redemandé", async () => {
  const { fetcher, calls } = fakeGoogle({});
  const far = { lat: 48.4, lng: -1.7 };
  assert.equal(await travelRoute("transit", home, far, fetcher), null);
  assert.equal(await travelRoute("transit", home, far, fetcher), null);
  assert.equal(calls.length, 1);
});

test("travelRoute : erreur Google → exception, rien n'est mis en cache", async () => {
  const failing = (async () => new Response("quota", { status: 403 })) as unknown as typeof fetch;
  const to = { lat: 48.5, lng: -1.7 };
  await assert.rejects(travelRoute("drive", home, to, failing), /Google Routes \(403\)/);
  const { fetcher, calls } = fakeGoogle();
  assert.ok(await travelRoute("drive", home, to, fetcher));
  assert.equal(calls.length, 1);
});

test("travelRoute : au-delà du plafond quotidien, plus aucun appel Google ; le cache reste servi", async () => {
  process.env.GOOGLE_ROUTES_PER_DAY = "1";
  const { fetcher, calls } = fakeGoogle();
  const cachedTarget = { lat: 48.3, lng: -1.7 }; // déjà en cache (test précédent, mode walk)
  await assert.rejects(travelRoute("drive", home, { lat: 48.6, lng: -1.7 }, fetcher), RoutingQuotaError);
  assert.equal(calls.length, 0);
  assert.ok(await travelRoute("walk", home, cachedTarget, fetcher));
});

test("routeKey : arrondi à 5 décimales, mode inclus", () => {
  assert.equal(routeKey("walk", { lat: 48.1234567, lng: -1.1 }, { lat: 1, lng: 2 }), "walk|48.12346,-1.10000|1.00000,2.00000");
});
