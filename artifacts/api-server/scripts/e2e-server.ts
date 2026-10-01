// Serveur pour les tests de bout en bout (pnpm test:e2e) : vraie API + front compilé, base PGlite jetable en mémoire,
// une ancienne recherche sans propriétaire (pour vérifier son adoption par le premier compte) et AUCUN accès à Apify/OpenAI.
// Google Routes est remplacé par un faux serveur local (trajet fixe) ; le géocodeur n'est jamais appelé (lieu déjà géocodé).
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { openDatabase } from "@workspace/db";
import { initDatabase } from "../src/lib/database";
import { completeSearch, createSearch, setCriteria } from "../src/routes/housing/store";

process.env.APIFY_BASE_URL = "http://127.0.0.1:1";
process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
process.env.APIFY_TOKEN = "e2e";
process.env.OPENAI_API_KEY = "e2e";
process.env.GEOCODER_BASE_URL = "http://127.0.0.1:1";
delete process.env.DATABASE_URL;

/** Encodage « polyline » de Google, pour que le faux serveur renvoie un vrai tracé. */
function encodePolyline(points: [number, number][]) {
  let out = "", prevLat = 0, prevLng = 0;
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const [a, b] = [Math.round(lat * 1e5), Math.round(lng * 1e5)];
    encode(a - prevLat); encode(b - prevLng);
    [prevLat, prevLng] = [a, b];
  }
  return out;
}
const home = { lat: 50.6408, lng: 3.0611 };
const work = { lat: 50.6366, lng: 3.0706 };
const path: [number, number][] = [[home.lat, home.lng], [50.6399, 3.0632], [50.6386, 3.0651], [50.6379, 3.0672], [50.6371, 3.0689], [work.lat, work.lng]];
// Durée selon le mode : 28 min à pied (trop long) → vélo 18 min (recommandé), transports 25 min, voiture 10 min proposés.
const SECONDS: Record<string, number> = { WALK: 1680, BICYCLE: 1080, TRANSIT: 1500, DRIVE: 600 };
const google = createServer((req, res) => {
  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    const mode = JSON.parse(body).travelMode as string;
    // Voiture : Google part de la rue la plus proche (le raccord en pointillés doit apparaître).
    const route = mode === "DRIVE" ? path.slice(1) : path;
    // Transports : marche, métro M1 (jaune), marche.
    const steps = mode === "TRANSIT" ? [
      { travelMode: "WALK", polyline: { encodedPolyline: encodePolyline(path.slice(0, 2)) } },
      { travelMode: "TRANSIT", polyline: { encodedPolyline: encodePolyline(path.slice(1, 5)) }, transitDetails: { transitLine: { nameShort: "M1", color: "#ffcc00", vehicle: { type: "SUBWAY" } } } },
      { travelMode: "WALK", polyline: { encodedPolyline: encodePolyline(path.slice(4)) } },
    ] : undefined;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ routes: [{ duration: `${SECONDS[mode]}s`, distanceMeters: 1400, polyline: { encodedPolyline: encodePolyline(route) }, legs: steps && [{ steps }] }] }));
  });
});
await new Promise<void>(resolve => google.listen(0, "127.0.0.1", resolve));
process.env.GOOGLE_ROUTES_BASE_URL = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
process.env.GOOGLE_MAPS_API_KEY = "e2e";

await initDatabase(await openDatabase({ dataDir: "memory://" }));
const id = await createSearch("Un studio à Lille, 700 € max, chat accepté");
await setCriteria(id, { location: "Lille", intent: "rent", maxPrice: 700, radius: 5, keywords: "", wishes: ["chat accepté"], checks: [{ id: "price", label: "Budget ≤ 700 €", availability: "api" }, { id: "wish-1", label: "chat accepté", availability: "description", apiField: null }],
  places: [{ id: "place-1", label: "Travail", kind: "work", address: "gare Lille Flandres", ...work, resolved: "Gare Lille Flandres, Lille" }] });
const listing = (n: number) => ({
  // Annonce 1 : Le Bon Coin ; annonce 2 : PAP (sources multiples).
  source: n === 1 ? "leboncoin" as const : "pap" as const,
  batch: "focused" as const, title: `Studio lumineux proche métro ${n}`, url: n === 1 ? `https://www.leboncoin.fr/ad/locations/${n}` : `https://www.pap.fr/annonces/-r44280300${n}`, description: "d", price: 590 + n * 10, area: 25, rooms: 1,
  location: "Lille", image: n === 1 ? "/favicon.svg?1" : null, images: n === 1 ? ["/favicon.svg?1", "/favicon.svg?2", "/favicon.svg?3"] : [], aiSummary: "Studio calme proche métro.", summaryEvidence: [], score: 80 - n,
  features: n === 1 ? [
    { label: "Meublé", value: "", source: "annonce" as const, evidence: "furnished: 1" },
    { label: "Étage", value: "3e sur 5", source: "annonce" as const, evidence: "floor_number: 3" },
    { label: "Balcon", value: "plein sud", source: "ia" as const, evidence: "un joli balcon plein sud donnant sur cour" },
    { label: "Cave", value: "", source: "ia" as const, evidence: "cave privative au sous-sol" },
    { label: "Chauffage", value: "gaz individuel", source: "ia" as const, evidence: "chauffage individuel au gaz" },
  ] : [],
  criterionResults: [
    { id: "price", label: "Budget ≤ 700 €", status: "confirmed" as const, source: "api" as const, value: "590 €", evidence: "" },
    { id: "wish-1", label: "chat accepté", status: "unknown" as const, source: "unknown" as const, value: "", evidence: "" },
  ],
  // Annonce 1 : adresse exacte (carte) ; annonce 2 : commune seulement (pas de carte).
  ...(n === 1 ? { ...home, geoPrecision: "streetNumber" as const } : { lat: 50.63, lng: 3.06, geoPrecision: "city" as const }),
});
await completeSearch(id, [listing(1), listing(2)], "focused");

const { default: app } = await import("../src/app");
app.listen(Number(process.env.PORT ?? 4180), () => console.log("prêt"));
