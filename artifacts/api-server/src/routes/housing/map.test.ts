import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { issueSession, SESSION_COOKIE, visitorIdForUser } from "../../lib/auth";
import { closeDatabase } from "../../lib/database";
import { createUser } from "../../lib/users";
import { useMemoryDatabase } from "../../test/helpers";
import { parsePlaces } from "./ai";
import { listingPosition, normalize } from "./apify";
import { completeSearch, createSearch, getSearch, isPrecise, setCriteria, type Criteria, type Listing, type Place } from "./store";

process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";

let app: Server;
let google: Server;
let base = "";
let googleCalls = 0;
let googleStatus = 200;
let googleModes: string[] = [];
let noRouteFor = new Set<string>();

before(async () => {
  await useMemoryDatabase();
  google = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      googleCalls++;
      const mode = JSON.parse(body).travelMode as string;
      googleModes.push(mode);
      res.statusCode = googleStatus;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(noRouteFor.has(mode) ? {} : { routes: [{ duration: "1534s", distanceMeters: 5210, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }] }));
    });
  });
  await new Promise<void>(resolve => google.listen(0, "127.0.0.1", resolve));
  process.env.GOOGLE_ROUTES_BASE_URL = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
  const { default: express } = await import("../../app");
  app = express.listen(0);
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api`;
});
after(async () => { app.close(); google.close(); await closeDatabase(); });
beforeEach(() => { process.env.GOOGLE_MAPS_API_KEY = "cle-de-test"; googleCalls = 0; googleStatus = 200; googleModes = []; noRouteFor = new Set(); });

test("listingPosition : garde les coordonnées Le Bon Coin et leur précision", () => {
  assert.deepEqual(listingPosition({ location: { city: "Rennes", lat: 48.11, lng: -1.68, type: "streetNumber" } }), { lat: 48.11, lng: -1.68, geoPrecision: "streetNumber" });
  assert.deepEqual(listingPosition({ location: { lat: "48.1", lng: "-1.6", origin_type: "district" } }), { lat: 48.1, lng: -1.6, geoPrecision: "district" });
  assert.deepEqual(listingPosition({ location: { lat: 48.1, lng: -1.6, type: "inconnu" } }), { lat: 48.1, lng: -1.6, geoPrecision: null });
  for (const location of [{ city: "Rennes" }, { lat: 0, lng: 0, type: "street" }, { lat: 120, lng: 3, type: "street" }, "Rennes"]) {
    assert.deepEqual(listingPosition({ location }), { lat: null, lng: null, geoPrecision: null }, JSON.stringify(location));
  }
});

test("normalize : une annonce Apify ressort avec sa position", () => {
  const criteria: Criteria = { location: "Rennes", intent: "rent", keywords: "", radius: 5 };
  const listing = normalize({ url: "https://www.leboncoin.fr/ad/locations/9", title: "T2", description: "d", price_euros: 600,
    location: { city: "Rennes", lat: 48.11, lng: -1.68, type: "street" } }, criteria);
  assert.equal(listing?.location, "Rennes");
  assert.deepEqual([listing?.lat, listing?.lng, listing?.geoPrecision], [48.11, -1.68, "street"]);
});

test("isPrecise : seules l'adresse exacte et la rue vont sur la carte", () => {
  const at = (geoPrecision: Listing["geoPrecision"], lat: number | null = 48) => ({ lat, lng: -1, geoPrecision });
  assert.equal(isPrecise(at("streetNumber")), true);
  assert.equal(isPrecise(at("street")), true);
  assert.equal(isPrecise(at("district")), false);
  assert.equal(isPrecise(at("city")), false);
  assert.equal(isPrecise(at(null)), false);
  assert.equal(isPrecise(at("street", null)), false);
});

test("parsePlaces : lieux de vie bornés (3 max), type validé, libellé par défaut ; moyen de transport gardé seulement s'il est valide", () => {
  const places = parsePlaces([
    { label: "Travail", kind: "work", address: " 20 place des Lices ", mode: "bike" },
    { kind: "school", address: "Université Rennes 2", mode: "fusée" },
    { label: "Sans adresse", kind: "work" },
    { label: "x", kind: "martien", address: "12 rue X" },
    { label: "y", kind: "other", address: "14 rue Y" },
  ]);
  assert.deepEqual(places.map(place => [place.id, place.label, place.kind, place.address, place.mode]), [
    ["place-1", "Travail", "work", "20 place des Lices", "bike"],
    ["place-2", "École", "school", "Université Rennes 2", null],
    ["place-3", "x", "other", "12 rue X", null],
  ]);
  assert.deepEqual(parsePlaces(undefined), []);
  assert.deepEqual(parsePlaces("Rennes"), []);
});

const ad = (n: number, position: Partial<Listing> = {}): Omit<Listing, "id"> => ({
  batch: "focused", title: `T2 ${n}`, url: `https://www.leboncoin.fr/ad/locations/${100 + n}`, description: "d", price: 600, area: 40, rooms: 2,
  location: "Rennes", image: null, images: [], aiSummary: null, summaryEvidence: [], score: 70, features: [], criterionResults: [],
  lat: null, lng: null, geoPrecision: null, ...position,
});
const workPlace = { id: "place-1", label: "Travail", kind: "work" as const, address: "20 place des Lices", lat: 48.1135, lng: -1.6828, resolved: "20 Place des Lices 35000 Rennes" };

async function searchFor(email: string, places: Place[] = [workPlace]) {
  const user = await createUser(email, "motdepasse-long");
  const id = await createSearch("Un T2 à Rennes, je travaille au 20 place des Lices", user!.id);
  await setCriteria(id, { location: "Rennes", intent: "rent", keywords: "", radius: 5, places });
  await completeSearch(id, [ad(1, { lat: 48.11, lng: -1.67, geoPrecision: "streetNumber" }), ad(2, { lat: 48.1, lng: -1.6, geoPrecision: "city" })], "focused");
  const search = await getSearch(id);
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(issueSession(Date.now(), visitorIdForUser(user!.id)))}`;
  const [precise, vague] = search!.listings;
  return { id, cookie, precise, vague };
}

test("la position et les lieux de vie sont enregistrés en base et relus avec la recherche", async () => {
  const { id, precise, vague } = await searchFor("carte-1@test.fr");
  const search = await getSearch(id);
  assert.deepEqual([precise.lat, precise.lng, precise.geoPrecision], [48.11, -1.67, "streetNumber"]);
  assert.equal(vague.geoPrecision, "city");
  assert.deepEqual(search?.criteria.places, [workPlace]);
  assert.equal(search?.routingAvailable, true);
  // Un rafraîchissement qui ne renvoie plus la position ne l'efface pas.
  await completeSearch(id, [ad(1)], "focused");
  assert.equal((await getSearch(id))?.listings.find(item => item.id === precise.id)?.geoPrecision, "streetNumber");
});

const path = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
const route = (mode: string, recommended: boolean) => ({ placeId: "place-1", mode, recommended, durationSeconds: 1534, distanceMeters: 5210, path, segments: [] });

test("GET …/routes : à pied 25 min → vélo, transports et voiture proposés (vélo recommandé), puis resservis depuis la base", async () => {
  const { id, cookie, precise } = await searchFor("carte-2@test.fr");
  const url = `${base}/housing/searches/${id}/listings/${precise.id}/routes`;
  const response = await fetch(url, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { routes: [route("bike", true), route("transit", false), route("drive", false)] });
  assert.equal(googleCalls, 4, "marche (trop longue) puis les trois autres modes");
  await fetch(url, { headers: { cookie } });
  assert.equal(googleCalls, 4, "le 2e affichage ne recoûte rien");
});

test("GET …/routes : annonce approximative ou lieu non géocodé → aucun trajet, aucun appel", async () => {
  const { id, cookie, vague } = await searchFor("carte-3@test.fr");
  const response = await fetch(`${base}/housing/searches/${id}/listings/${vague.id}/routes`, { headers: { cookie } });
  assert.deepEqual(await response.json(), { routes: [] });
  const other = await searchFor("carte-4@test.fr", [{ ...workPlace, lat: null, lng: null }]);
  assert.deepEqual(await (await fetch(`${base}/housing/searches/${other.id}/listings/${other.precise.id}/routes`, { headers: { cookie: other.cookie } })).json(), { routes: [] });
  assert.equal(googleCalls, 0);
});

test("GET …/routes : sans clé Google → 503 et routingAvailable=false (le front n'affiche rien)", async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  const { id, cookie, precise } = await searchFor("carte-5@test.fr");
  assert.equal((await fetch(`${base}/housing/searches/${id}/listings/${precise.id}/routes`, { headers: { cookie } })).status, 503);
  const detail = await (await fetch(`${base}/housing/searches/${id}`, { headers: { cookie } })).json() as { routingAvailable: boolean };
  assert.equal(detail.routingAvailable, false);
  assert.equal(googleCalls, 0);
});

test("GET …/routes : recherche d'un autre compte ou annonce inconnue → 404 ; erreur Google → liste vide, pas de plantage", async () => {
  const mine = await searchFor("carte-6@test.fr", [{ ...workPlace, lat: 48.2 }]); // trajet jamais calculé (hors cache)
  const theirs = await searchFor("carte-7@test.fr");
  assert.equal((await fetch(`${base}/housing/searches/${theirs.id}/listings/${theirs.precise.id}/routes`, { headers: { cookie: mine.cookie } })).status, 404);
  assert.equal((await fetch(`${base}/housing/searches/${mine.id}/listings/${theirs.precise.id}/routes`, { headers: { cookie: mine.cookie } })).status, 404);
  assert.equal((await fetch(`${base}/housing/searches/${mine.id}/listings/${mine.precise.id}/routes`)).status, 401);
  googleStatus = 500;
  const failed = await fetch(`${base}/housing/searches/${mine.id}/listings/${mine.precise.id}/routes`, { headers: { cookie: mine.cookie } });
  assert.equal(failed.status, 200);
  assert.deepEqual(await failed.json(), { routes: [] });
});

test("GET …/routes : un moyen de transport dit par l'utilisateur est recommandé ; les autres restent proposés", async () => {
  const { id, cookie, precise } = await searchFor("carte-8@test.fr", [{ ...workPlace, lat: 48.12, mode: "drive" }]);
  const body = await (await fetch(`${base}/housing/searches/${id}/listings/${precise.id}/routes`, { headers: { cookie } })).json() as { routes: { mode: string; recommended: boolean }[] };
  assert.deepEqual(body.routes.map(item => [item.mode, item.recommended]), [["bike", false], ["transit", false], ["drive", true]]);
  assert.ok(!googleModes.includes("WALK"), "marche non demandée : l'utilisateur a dit « en voiture »");
});

test("GET …/routes : mode dit par l'utilisateur mais sans itinéraire (pas de transports) → l'app recommande", async () => {
  noRouteFor = new Set(["TRANSIT"]);
  const { id, cookie, precise } = await searchFor("carte-9@test.fr", [{ ...workPlace, lat: 48.13, mode: "transit" }]);
  const body = await (await fetch(`${base}/housing/searches/${id}/listings/${precise.id}/routes`, { headers: { cookie } })).json() as { routes: { mode: string; recommended: boolean }[] };
  assert.deepEqual(body.routes.map(item => [item.mode, item.recommended]), [["bike", true], ["drive", false]]);
});

test("GET …/routes : plusieurs lieux (travail, école, travail du conjoint) → des trajets pour chacun", async () => {
  const places: Place[] = [
    { ...workPlace, lat: 48.14 },
    { ...workPlace, id: "place-2", label: "École", kind: "school", lat: 48.15 },
    { ...workPlace, id: "place-3", label: "Travail de Léa", lat: 48.16 },
  ];
  const { id, cookie, precise } = await searchFor("carte-10@test.fr", places);
  const body = await (await fetch(`${base}/housing/searches/${id}/listings/${precise.id}/routes`, { headers: { cookie } })).json() as { routes: { placeId: string; recommended: boolean }[] };
  for (const placeId of ["place-1", "place-2", "place-3"]) {
    const mine = body.routes.filter(item => item.placeId === placeId);
    assert.equal(mine.length, 3, placeId);
    assert.equal(mine.filter(item => item.recommended).length, 1, placeId);
  }
  assert.equal(googleCalls, 9);
});
