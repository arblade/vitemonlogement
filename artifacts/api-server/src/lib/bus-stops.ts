import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { crowMeters } from "./stations";
import { logger } from "./logger";

// Arrêts de bus lus dans les tuiles OpenFreeMap (OpenStreetMap, schéma OpenMapTiles, couche « poi », classe « bus »),
// les mêmes que le fond de carte : gratuit, sans clé. Une tuile de zoom 14 couvre ~1,5 à 2,5 km de côté.
export type BusStop = { name: string; lat: number; lng: number };
export const BUS_ZOOM = 14;
/** Au-delà, l'arrêt n'est plus « à proximité » (≈ 10 à 15 min à pied). */
export const MAX_BUS_METERS = 800;

const base = () => process.env.OPENFREEMAP_URL || "https://tiles.openfreemap.org";

// Adresse des tuiles du jour (elle change à chaque mise à jour de la carte), relue toutes les 6 heures.
let template: { url: string; at: number } | null = null;
async function tileTemplate(fetcher: typeof fetch) {
  if (template && Date.now() - template.at < 6 * 3_600_000) return template.url;
  const response = await fetcher(`${base()}/planet`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OpenFreeMap a répondu ${response.status}`);
  const url = ((await response.json()) as { tiles?: string[] }).tiles?.[0];
  if (!url) throw new Error("OpenFreeMap : pas d'adresse de tuiles");
  template = { url, at: Date.now() };
  return url;
}

// Arrêts déjà lus par tuile (petits tableaux) : une ville entière ne demande ses tuiles qu'une fois.
const tiles = new Map<string, BusStop[]>();
const MAX_TILES = 3_000;

export function resetBusStopCache() { tiles.clear(); template = null; }

/** Arrêts de bus d'une tuile (vector tile décodée). Sans nom : ignorés (on ne saurait pas quoi afficher). */
export function busStopsOfTile(buffer: Uint8Array, x: number, y: number, z = BUS_ZOOM): BusStop[] {
  const layer = new VectorTile(new Pbf(buffer)).layers.poi;
  const stops: BusStop[] = [];
  for (let i = 0; layer && i < layer.length; i++) {
    const feature = layer.feature(i);
    const { class: kind, subclass, name } = feature.properties;
    if (kind !== "bus" || (subclass !== "bus_stop" && subclass !== "bus_station") || typeof name !== "string" || !name.trim()) continue;
    const geometry = feature.toGeoJSON(x, y, z).geometry;
    if (geometry.type !== "Point") continue;
    const [lng, lat] = geometry.coordinates;
    stops.push({ name: name.trim(), lat, lng });
  }
  return stops;
}

async function tileStops(x: number, y: number, fetcher: typeof fetch) {
  const key = `${x}/${y}`;
  const known = tiles.get(key);
  if (known) return known;
  const url = (await tileTemplate(fetcher)).replace("{z}", String(BUS_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
  const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`tuile ${key} : ${response.status}`);
  const stops = busStopsOfTile(new Uint8Array(await response.arrayBuffer()), x, y);
  if (tiles.size >= MAX_TILES) tiles.delete(tiles.keys().next().value!);
  tiles.set(key, stops);
  return stops;
}

/** Position d'un point en tuiles (fractionnaire) au zoom donné (projection Web Mercator). */
export function tilePosition({ lat, lng }: { lat: number; lng: number }, z = BUS_ZOOM) {
  const n = 2 ** z, rad = lat * Math.PI / 180;
  return { x: (lng + 180) / 360 * n, y: (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n };
}

/**
 * Arrêts de bus à moins de MAX_BUS_METERS, les plus proches d'abord, un par nom (les deux côtés de la rue portent le
 * même nom : on garde le plus proche). Lit la tuile du logement et ses voisines si le rayon déborde. Lève une erreur si
 * une tuile est injoignable (le résultat serait incomplet : rien n'est mis en cache).
 */
export async function busStopsNear(point: { lat: number; lng: number }, limit = 3, fetcher: typeof fetch = fetch): Promise<(BusStop & { distanceMeters: number })[]> {
  const { x, y } = tilePosition(point);
  const tileMeters = 40_075_016 * Math.cos(point.lat * Math.PI / 180) / 2 ** BUS_ZOOM;
  const reach = MAX_BUS_METERS / tileMeters;
  const keys: [number, number][] = [];
  for (let tx = Math.floor(x - reach); tx <= Math.floor(x + reach); tx++) {
    for (let ty = Math.floor(y - reach); ty <= Math.floor(y + reach); ty++) keys.push([tx, ty]);
  }
  const all = (await Promise.all(keys.map(([tx, ty]) => tileStops(tx, ty, fetcher)))).flat();
  const byName = new Map<string, BusStop & { distanceMeters: number }>();
  for (const stop of all) {
    const distanceMeters = Math.round(crowMeters(point, stop));
    if (distanceMeters > MAX_BUS_METERS) continue;
    const key = stop.name.toLocaleLowerCase("fr");
    const known = byName.get(key);
    if (!known || distanceMeters < known.distanceMeters) byName.set(key, { ...stop, distanceMeters });
  }
  const found = [...byName.values()].sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, limit);
  logger.debug({ tiles: keys.length, found: found.length }, "Bus stops read from tiles");
  return found;
}
