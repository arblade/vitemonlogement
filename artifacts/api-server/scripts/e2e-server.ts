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
// Durée selon le mode : 28 min à pied (trop long) puis 18 min à vélo → l'app doit choisir le vélo.
const google = createServer((req, res) => {
  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    const seconds = JSON.parse(body).travelMode === "WALK" ? 1680 : 1080;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ routes: [{ duration: `${seconds}s`, distanceMeters: 1400, polyline: { encodedPolyline: encodePolyline(path) } }] }));
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
  batch: "focused" as const, title: `Studio lumineux proche métro ${n}`, url: `https://www.leboncoin.fr/ad/locations/${n}`, description: "d", price: 590 + n * 10, area: 25, rooms: 1,
  location: "Lille", image: n === 1 ? "/favicon.svg?1" : null, images: n === 1 ? ["/favicon.svg?1", "/favicon.svg?2", "/favicon.svg?3"] : [], aiSummary: "Studio calme proche métro.", summaryEvidence: [], score: 80 - n, features: [],
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
