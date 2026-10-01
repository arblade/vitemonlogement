import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { closeDatabase } from "./database";
import { useMemoryDatabase } from "../test/helpers";
import { commuteOptions, COMMUTE, crowDistance, decodePolyline, nextTuesdayNineParis, routeKey, RoutingQuotaError, simplifyPath, transitSegments, travelRoute } from "./travel";

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
  assert.deepEqual(route, { durationSeconds: 1534, distanceMeters: 5210, path: [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]], segments: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:1/directions/v2:computeRoutes");
  assert.equal(calls[0].headers.get("X-Goog-Api-Key"), "cle-de-test");
  assert.equal(calls[0].headers.get("X-Goog-FieldMask"), "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.travelMode,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.transitDetails.transitLine");
  assert.equal(calls[0].body.polylineQuality, "HIGH_QUALITY", "tracé précis, pas le tracé simplifié par défaut");
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
  assert.ok(calls.every(call => call.body.polylineQuality === "HIGH_QUALITY"));
  assert.ok(calls.every(call => call.headers.get("X-Goog-FieldMask") === "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"), "étapes demandées seulement en transports");
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

// Polylines encodées de deux points : A→B, B→C, C→D, D→E.
const A_B = "_p~iF~ps|U_ulLnnqC", B_C = "_mqlG~usyU_mqNvxq`@";
const transitSteps = [
  { travelMode: "WALK", polyline: { encodedPolyline: A_B } },
  { travelMode: "WALK", polyline: { encodedPolyline: B_C } },
  { travelMode: "TRANSIT", polyline: { encodedPolyline: B_C }, transitDetails: { transitLine: { nameShort: "M1", name: "Métro 1", color: "#FFCC00", vehicle: { type: "SUBWAY" } } } },
  { travelMode: "TRANSIT", polyline: { encodedPolyline: A_B }, transitDetails: { transitLine: { name: "Liane 5", color: "red;background:url(x)", vehicle: { type: "BUS" } } } },
  { travelMode: "WALK", polyline: { encodedPolyline: "" } },
];

test("transitSegments : marches consécutives fusionnées, une étape par ligne (nom court, couleur validée, véhicule)", () => {
  const segments = transitSegments(transitSteps);
  assert.deepEqual(segments.map(segment => [segment.mode, segment.line]), [
    ["walk", null],
    ["transit", { name: "M1", color: "#ffcc00", vehicle: "SUBWAY" }],
    ["transit", { name: "Liane 5", color: null, vehicle: "BUS" }],
  ]);
  assert.equal(segments[0].path.length, 3, "A→B puis B→C, le point B n'est pas dupliqué");
  assert.deepEqual(transitSegments([]), []);
});

test("travelRoute : en transports, les étapes sont renvoyées et relues depuis le cache", async () => {
  const { fetcher, calls } = fakeGoogle({ routes: [{ duration: "1500s", distanceMeters: 4000, polyline: { encodedPolyline: A_B }, legs: [{ steps: transitSteps }] }] });
  const to = { lat: 48.7, lng: -1.7 };
  const fresh = await travelRoute("transit", home, to, fetcher);
  assert.deepEqual(fresh?.segments.map(segment => segment.line?.name ?? segment.mode), ["walk", "M1", "Liane 5"]);
  assert.deepEqual(await travelRoute("transit", home, to, fetcher), fresh);
  assert.equal(calls.length, 1);
});

test("simplifyPath : points alignés retirés, virages gardés, écarts de moins de 5 m gommés", () => {
  const straight: [number, number][] = Array.from({ length: 101 }, (_, index) => [48 + index * 1e-5, -1.6]);
  assert.deepEqual(simplifyPath(straight), [straight[0], straight[100]]);
  const corner: [number, number][] = [[48, -1.6], [48.001, -1.6], [48.002, -1.6], [48.002, -1.598], [48.002, -1.596]];
  assert.deepEqual(simplifyPath(corner), [[48, -1.6], [48.002, -1.6], [48.002, -1.596]]);
  const wobble: [number, number][] = [[48, -1.6], [48.001, -1.60003], [48.002, -1.6]]; // ≈ 2 m de côté
  assert.equal(simplifyPath(wobble).length, 2);
  const detour: [number, number][] = [[48, -1.6], [48.001, -1.5998], [48.002, -1.6]]; // ≈ 15 m de côté
  assert.equal(simplifyPath(detour).length, 3);
  assert.deepEqual(simplifyPath([[48, -1.6], [48.1, -1.6]]), [[48, -1.6], [48.1, -1.6]]);
});

test("travelRoute : le tracé haute précision est allégé avant d'être stocké et renvoyé", async () => {
  const dense: [number, number][] = Array.from({ length: 400 }, (_, index) => [47 + index * 1e-5, index < 200 ? -1.6 : -1.6 + (index - 200) * 1e-5]);
  let encoded = "", prevLat = 0, prevLng = 0;
  const push = (value: number) => { let v = value < 0 ? ~(value << 1) : value << 1; while (v >= 0x20) { encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } encoded += String.fromCharCode(v + 63); };
  for (const [lat, lng] of dense) { const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5); push(a - prevLat); push(b - prevLng); [prevLat, prevLng] = [a, b]; }
  const { fetcher } = fakeGoogle({ routes: [{ duration: "600s", distanceMeters: 800, polyline: { encodedPolyline: encoded } }] });
  const route = await travelRoute("bike", home, { lat: 47.5, lng: -1.7 }, fetcher);
  assert.equal(decodePolyline(encoded).length, 400);
  assert.ok(route!.path.length <= 4, `${route!.path.length} points gardés sur 400`);
  assert.deepEqual(route!.path[0], [47, -1.6]);
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

const summary = (options: { mode: string; recommended: boolean }[]) => options.map(option => option.recommended ? `${option.mode}*` : option.mode);

test("commuteOptions : à pied si ≤ 20 min, seul (un seul appel, rien à choisir)", async () => {
  const { fetcher, modes } = googleByMode({ WALK: 15 });
  assert.deepEqual(summary(await commuteOptions(start(), at(1_000), null, fetcher)), ["walk*"]);
  assert.deepEqual(modes, ["WALK"]);
  assert.deepEqual(summary(await commuteOptions(start(), at(1_500), null, googleByMode({ WALK: 20 }).fetcher)), ["walk*"], "20 min pile : encore à pied");
});

test("commuteOptions : marche > 20 min → vélo, transports et voiture calculés tous les trois ; vélo ≤ 40 min recommandé", async () => {
  const { fetcher, modes } = googleByMode({ WALK: 25, BICYCLE: 9, TRANSIT: 14, DRIVE: 6 });
  const options = await commuteOptions(start(), at(1_800), null, fetcher);
  assert.deepEqual(summary(options), ["bike*", "transit", "drive"]);
  assert.deepEqual(options.map(option => option.durationSeconds), [540, 840, 360]);
  assert.deepEqual(modes.sort(), ["BICYCLE", "DRIVE", "TRANSIT", "WALK"]);
  assert.ok(options.every(option => option.path.length > 1), "chaque mode a son tracé");
  assert.deepEqual(summary(await commuteOptions(start(), at(1_500), null, googleByMode({ WALK: 21, BICYCLE: 40, TRANSIT: 20, DRIVE: 5 }).fetcher)), ["bike*", "transit", "drive"], "40 min pile : vélo");
});

test("commuteOptions : les trois appels partent en parallèle, pas l'un après l'autre", async () => {
  let inFlight = 0, peak = 0;
  const fetcher = (async (_input: string | URL, init?: RequestInit) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 20));
    inFlight--;
    const mode = JSON.parse(String(init?.body)).travelMode;
    return Response.json({ routes: [{ duration: mode === "BICYCLE" ? "600s" : "900s", distanceMeters: 1, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" } }] });
  }) as typeof fetch;
  assert.equal((await commuteOptions(start(), at(5_000), null, fetcher)).length, 3);
  assert.equal(peak, 3);
});

test("commuteOptions : au-delà de 2 km, marche non demandée ; vélo > 40 min → transports recommandés", async () => {
  const { fetcher, modes } = googleByMode({ WALK: 5, BICYCLE: 45, TRANSIT: 30, DRIVE: 15 });
  assert.deepEqual(summary(await commuteOptions(start(), at(5_000), null, fetcher)), ["bike", "transit*", "drive"]);
  assert.ok(!modes.includes("WALK"));
});

test("commuteOptions : pas de transport en commun → proposé seulement vélo et voiture, voiture recommandée", async () => {
  assert.deepEqual(summary(await commuteOptions(start(), at(20_000), null, googleByMode({ BICYCLE: 70, TRANSIT: null, DRIVE: 12 }).fetcher)), ["bike", "drive*"]);
});

test("commuteOptions : un moyen dit par l'utilisateur est recommandé, même si la marche suffirait", async () => {
  const { fetcher, modes } = googleByMode({ WALK: 10, BICYCLE: 4, TRANSIT: 8, DRIVE: 3 });
  assert.deepEqual(summary(await commuteOptions(start(), at(800), "drive", fetcher)), ["bike", "transit", "drive*"]);
  assert.ok(!modes.includes("WALK"));
  assert.deepEqual(summary(await commuteOptions(start(), at(3_000), "walk", googleByMode({ WALK: 40, BICYCLE: 10 }).fetcher)), ["walk*"], "« à pied » dit : la marche, même longue");
  assert.deepEqual(summary(await commuteOptions(start(), at(3_000), "transit", googleByMode({ BICYCLE: 25, TRANSIT: null, DRIVE: 9 }).fetcher)), ["bike*", "drive"], "pas de transports : choix de l'app");
});

test("commuteOptions : aucun itinéraire → [] ; marche longue mais seule possible → la marche", async () => {
  assert.deepEqual(await commuteOptions(start(), at(20_000), null, googleByMode({}).fetcher), []);
  assert.deepEqual(summary(await commuteOptions(start(), at(1_900), null, googleByMode({ WALK: 24 }).fetcher)), ["walk*"]);
  assert.deepEqual([COMMUTE.walkMaxSeconds, COMMUTE.bikeMaxSeconds], [1200, 2400]);
  assert.ok(Math.abs(crowDistance({ lat: 45, lng: 5 }, { lat: 45 + 1_000 / 111_320, lng: 5 }) - 1_000) < 10);
});

test("commuteOptions : un mode en erreur n'empêche pas les autres ; tout en erreur → exception", async () => {
  const partly = (async (_input: string | URL, init?: RequestInit) => JSON.parse(String(init?.body)).travelMode === "TRANSIT"
    ? new Response("boom", { status: 500 })
    : Response.json({ routes: [{ duration: "600s", distanceMeters: 1, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" } }] })) as typeof fetch;
  assert.deepEqual(summary(await commuteOptions(start(), at(5_000), null, partly)), ["bike*", "drive"]);
  const broken = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(commuteOptions(start(), at(5_000), null, broken), /Google Routes \(500\)/);
});
