import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { closeDatabase } from "./database";
import { useMemoryDatabase } from "../test/helpers";
import { encodePoiTile, type TilePoint } from "../test/vector-tile";
import { accessKey, computeAccess, ensureAccess, storedAccess, walkMatrix } from "./access";
import { busStopsNear, busStopsOfTile, resetBusStopCache, tilePosition } from "./bus-stops";

// Logement à Lille (rue Nationale) : Rihour (métro 1) à ~600 m, deux arrêts de bus inventés autour.
const home = { lat: 50.6408, lng: 3.0611 };
const busStops: TilePoint[] = [
  { lat: 50.6412, lng: 3.0618, properties: { class: "bus", subclass: "bus_stop", name: "Colpin" } },
  { lat: 50.6414, lng: 3.0620, properties: { class: "bus", subclass: "bus_stop", name: "Colpin" } }, // l'autre côté de la rue
  { lat: 50.6440, lng: 3.0580, properties: { class: "bus", subclass: "bus_stop", name: "Champ de Mars" } },
  { lat: 50.6600, lng: 3.0611, properties: { class: "bus", subclass: "bus_stop", name: "Trop loin" } },
  { lat: 50.6409, lng: 3.0612, properties: { class: "bus", subclass: "bus_stop", name: "" } }, // sans nom : ignoré
  { lat: 50.6410, lng: 3.0613, properties: { class: "shop", subclass: "bakery", name: "Boulangerie" } },
];

type Call = { url: string; body?: { locations: number[][]; destinations: number[] }; auth?: string };
let calls: Call[] = [];
let orsStatus = 200;
let tilesUp = true;
/** Faux OpenFreeMap (TileJSON + tuiles) et faux OpenRouteService : marche = 1,25 × la ligne droite à 5 km/h. */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/planet")) {
    calls.push({ url });
    return new Response(JSON.stringify({ tiles: ["https://tuiles.test/v1/{z}/{x}/{y}.pbf"] }), { status: tilesUp ? 200 : 503 });
  }
  const tile = url.match(/tuiles\.test\/v1\/14\/(\d+)\/(\d+)\.pbf$/);
  if (tile) {
    calls.push({ url });
    const [x, y] = [Number(tile[1]), Number(tile[2])];
    const inside = busStops.filter(stop => { const p = tilePosition(stop); return Math.floor(p.x) === x && Math.floor(p.y) === y; });
    return new Response(encodePoiTile(inside, x, y), { status: 200 });
  }
  if (url.endsWith("/v2/matrix/foot-walking")) {
    const body = JSON.parse(String(init?.body)) as { locations: number[][]; destinations: number[] };
    calls.push({ url, body, auth: (init?.headers as Record<string, string>).Authorization });
    if (orsStatus !== 200) return new Response("{}", { status: orsStatus });
    const [from, ...to] = body.locations;
    const meters = to.map(([lng, lat]) => {
      const dy = (lat - from[1]) * 110_540, dx = (lng - from[0]) * 111_320 * Math.cos(from[1] * Math.PI / 180);
      return Math.hypot(dx, dy) * 1.25;
    });
    return new Response(JSON.stringify({ durations: [meters.map(m => m / (5000 / 3600))], distances: [meters] }), { status: 200 });
  }
  throw new Error(`appel inattendu : ${url}`);
};

before(async () => { await useMemoryDatabase(); });
after(async () => { await closeDatabase(); });
beforeEach(() => {
  calls = []; orsStatus = 200; tilesUp = true; resetBusStopCache();
  process.env.ORS_API_KEY = "cle-ors-test";
  process.env.ORS_BASE_URL = "https://ors.test";
});

test("tuile vectorielle : seuls les arrêts de bus nommés sont lus, à leur position", () => {
  const { x, y } = tilePosition(home);
  const tile = encodePoiTile(busStops.slice(0, 1).concat(busStops.slice(4)), Math.floor(x), Math.floor(y));
  const stops = busStopsOfTile(tile, Math.floor(x), Math.floor(y));
  assert.equal(stops.length, 1);
  assert.equal(stops[0].name, "Colpin");
  assert.ok(Math.abs(stops[0].lat - 50.6412) < 1e-4 && Math.abs(stops[0].lng - 3.0618) < 1e-4, JSON.stringify(stops[0]));
});

test("busStopsNear : un arrêt par nom (le côté le plus proche), dans un rayon de 800 m, le plus proche d'abord ; tuiles gardées", async () => {
  const stops = await busStopsNear(home, 3, fakeFetch);
  assert.deepEqual(stops.map(stop => stop.name), ["Colpin", "Champ de Mars"]);
  assert.ok(stops[0].distanceMeters < 80, String(stops[0].distanceMeters));
  const tileCalls = calls.filter(call => call.url.includes("/14/")).length;
  assert.ok(tileCalls >= 1 && tileCalls <= 4, String(tileCalls));
  calls = [];
  await busStopsNear(home, 3, fakeFetch);
  assert.equal(calls.length, 0, "tuiles et adresse du jour déjà connues : aucun appel");
});

test("walkMatrix : une requête à pied, logement → candidats, en [lng, lat], avec la clé ORS", async () => {
  const result = await walkMatrix(home, [{ lat: 50.6357, lng: 3.0630 }, { lat: 50.6412, lng: 3.0618 }], fakeFetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://ors.test/v2/matrix/foot-walking");
  assert.equal(calls[0].auth, "cle-ors-test");
  assert.deepEqual(calls[0].body?.locations[0], [home.lng, home.lat]);
  assert.deepEqual(calls[0].body?.destinations, [1, 2]);
  assert.ok(result[0] && result[1] && result[0][0] > result[1][0]);
});

test("computeAccess : vraie marche ORS pour le métro (Rihour, ligne 1) et le bus (Colpin), une seule matrice", async () => {
  const access = await computeAccess(home, fakeFetch);
  assert.equal(access.routed, true);
  assert.equal(access.metro?.name, "Rihour");
  assert.ok(access.metro?.lines.some(line => line.mode === "metro" && line.name === "1"));
  assert.equal(access.metro?.estimated, false);
  assert.ok(access.metro!.walkMinutes >= 6 && access.metro!.walkMinutes <= 12, String(access.metro?.walkMinutes));
  assert.equal(access.bus?.name, "Colpin");
  assert.deepEqual(access.bus?.lines, []);
  assert.equal(calls.filter(call => call.url.includes("matrix")).length, 1);
});

test("computeAccess : sans clé ORS ou ORS en panne → marche estimée (vol d'oiseau × 1,3), signalée comme telle", async () => {
  for (const setup of [() => { delete process.env.ORS_API_KEY; }, () => { orsStatus = 503; }]) {
    calls = []; setup();
    const access = await computeAccess(home, fakeFetch);
    assert.equal(access.routed, false);
    assert.equal(access.metro?.name, "Rihour");
    assert.equal(access.metro?.estimated, true);
    assert.equal(access.bus?.estimated, true);
    process.env.ORS_API_KEY = "cle-ors-test"; orsStatus = 200;
  }
});

test("computeAccess : rien à distance de marche (campagne) → ni métro ni bus, aucun appel ORS", async () => {
  const access = await computeAccess({ lat: 48.2, lng: -3.5 }, fakeFetch);
  assert.deepEqual([access.metro, access.bus], [null, null]);
  assert.equal(calls.filter(call => call.url.includes("matrix")).length, 0);
});

test("ensureAccess : calcule une fois puis garde en base ; une estimation est refaite quand ORS revient ; tuiles en panne → rien de gardé", async () => {
  delete process.env.ORS_API_KEY;
  await ensureAccess([home], fakeFetch);
  assert.equal((await storedAccess([home])).get(accessKey(home))?.routed, false);
  process.env.ORS_API_KEY = "cle-ors-test";
  await ensureAccess([home], fakeFetch);
  assert.equal((await storedAccess([home])).get(accessKey(home))?.routed, true);
  calls = [];
  await ensureAccess([home, { ...home }], fakeFetch);
  assert.equal(calls.length, 0, "déjà calculé : aucun appel");

  const other = { lat: 50.6295, lng: 3.0573 };
  resetBusStopCache(); tilesUp = false;
  await ensureAccess([other], fakeFetch);
  assert.equal((await storedAccess([other])).size, 0, "résultat incomplet : rien n'est gardé, ce sera retenté");
});

test("ensureAccess : plafond quotidien ORS atteint → estimation, jamais d'erreur", async () => {
  process.env.ORS_MATRIX_PER_DAY = "1";
  try {
    await walkMatrix(home, [{ lat: 50.6357, lng: 3.0630 }], fakeFetch).catch(() => undefined); // au moins 1 appel aujourd'hui
    calls = [];
    const access = await computeAccess({ lat: 50.6366, lng: 3.0706 }, fakeFetch);
    assert.equal(access.routed, false);
    assert.equal(calls.filter(call => call.url.includes("matrix")).length, 0);
  } finally {
    delete process.env.ORS_MATRIX_PER_DAY;
  }
});
