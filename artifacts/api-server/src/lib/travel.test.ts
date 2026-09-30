import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { closeDatabase } from "./database";
import { useMemoryDatabase } from "../test/helpers";
import { commute, COMMUTE, crowDistance, decodePolyline, nextTuesdayNineParis, routeKey, RoutingQuotaError, travelRoute } from "./travel";

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

/** Faux Google dont la durée dépend du mode (null = aucun itinéraire). Mémorise les modes demandés. */
function googleByMode(minutes: Partial<Record<"WALK" | "BICYCLE" | "TRANSIT" | "DRIVE", number | null>>) {
  const modes: string[] = [];
  const fetcher = (async (_input: string | URL, init?: RequestInit) => {
    const mode = JSON.parse(String(init?.body)).travelMode as keyof typeof minutes;
    modes.push(mode);
    const value = minutes[mode];
    return Response.json(value == null ? {} : { routes: [{ duration: `${value * 60}s`, distanceMeters: 1000, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" } }] });
  }) as typeof fetch;
  return { fetcher, modes };
}
let unique = 0;
/** Destination à `meters` au nord de `start`, jamais la même (le cache ne doit pas fausser le test). */
const at = (meters: number) => ({ lat: 45 + meters / 111_320, lng: 5 + ++unique * 1e-4 });
const start = () => ({ lat: 45, lng: 5 + unique * 1e-4 });

test("commute : à pied si ≤ 20 min (un seul appel)", async () => {
  const { fetcher, modes } = googleByMode({ WALK: 15 });
  const to = at(1_000);
  assert.equal((await commute(start(), to, fetcher))?.mode, "walk");
  assert.deepEqual(modes, ["WALK"]);
});

test("commute : 20 min pile à pied, c'est encore à pied ; 40 min pile à vélo, encore à vélo", async () => {
  assert.equal((await commute(start(), at(1_500), googleByMode({ WALK: 20 }).fetcher))?.mode, "walk");
  assert.equal((await commute(start(), at(1_500), googleByMode({ WALK: 21, BICYCLE: 40 }).fetcher))?.mode, "bike");
});

test("commute : marche trop longue → vélo si ≤ 40 min", async () => {
  const { fetcher, modes } = googleByMode({ WALK: 25, BICYCLE: 9 });
  const route = await commute(start(), at(1_800), fetcher);
  assert.deepEqual([route?.mode, route?.durationSeconds], ["bike", 540]);
  assert.deepEqual(modes, ["WALK", "BICYCLE"]);
});

test("commute : au-delà de 2 km à vol d'oiseau, la marche n'est même pas demandée ; vélo > 40 min → transports", async () => {
  const { fetcher, modes } = googleByMode({ WALK: 5, BICYCLE: 45, TRANSIT: 30 });
  assert.equal((await commute(start(), at(5_000), fetcher))?.mode, "transit");
  assert.deepEqual(modes, ["BICYCLE", "TRANSIT"]);
});

test("commute : pas de transport en commun → voiture", async () => {
  const { fetcher, modes } = googleByMode({ BICYCLE: 50, TRANSIT: null, DRIVE: 12 });
  assert.equal((await commute(start(), at(8_000), fetcher))?.mode, "drive");
  assert.deepEqual(modes, ["BICYCLE", "TRANSIT", "DRIVE"]);
});

test("commute : au-delà de 12 km, ni marche ni vélo ; transports d'abord", async () => {
  const { fetcher, modes } = googleByMode({ TRANSIT: 55 });
  assert.equal((await commute(start(), at(20_000), fetcher))?.mode, "transit");
  assert.deepEqual(modes, ["TRANSIT"]);
});

test("commute : aucun itinéraire d'aucune sorte → null ; seuils et distance cohérents", async () => {
  assert.equal(await commute(start(), at(20_000), googleByMode({}).fetcher), null);
  assert.deepEqual([COMMUTE.walkMaxSeconds, COMMUTE.bikeMaxSeconds], [1200, 2400]);
  assert.ok(Math.abs(crowDistance({ lat: 45, lng: 5 }, { lat: 45 + 1_000 / 111_320, lng: 5 }) - 1_000) < 10);
});
