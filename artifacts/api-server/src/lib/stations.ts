import data from "../data/stations.json";

// Stations de métro et de tram de France (OpenStreetMap, voir scripts/build-stations.mjs), cherchées en mémoire :
// ~2 200 stations, pas de table, aucun appel extérieur. Données © les contributeurs d'OpenStreetMap (ODbL).
export type StopLine = { mode: "metro" | "tram"; name: string; color: string | null };
export type Station = { name: string; lat: number; lng: number; lines: StopLine[] };
export type NearestStop = Station & { distanceMeters: number; walkMinutes: number };

type Row = [string, number, number, string];

/** "m|1|#ffcd00;t|T2|" → lignes, sans doublon, métro d'abord puis ordre naturel (« 2 » avant « 10 »). */
export function parseLines(value: string): StopLine[] {
  const seen = new Set<string>();
  return value.split(";").filter(Boolean).flatMap(item => {
    const [mode, raw, color] = item.split("|");
    // « b » (Rennes) → « B » ; une même ligne saisie deux fois (une relation par sens, couleurs différentes) : la première.
    const name = raw.length === 1 ? raw.toUpperCase() : raw;
    const line = { mode: mode === "m" ? "metro" as const : "tram" as const, name, color: color || null };
    if (seen.has(`${line.mode}|${name}`)) return [];
    seen.add(`${line.mode}|${name}`);
    return [line];
  }).sort((a, b) => (a.mode === b.mode ? 0 : a.mode === "metro" ? -1 : 1) || a.name.localeCompare(b.name, "fr", { numeric: true }));
}

const stations: Station[] = (data as Row[]).map(([name, lat, lng, lines]) => ({ name, lat, lng, lines: parseLines(lines) }));

/** Distance à vol d'oiseau (haversine), en mètres. */
export function crowMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (value: number) => value * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Marche estimée sans itinéraire : la rue n'est jamais droite, on compte 1,3 fois la distance à vol d'oiseau (écart
 * moyen mesuré en ville entre trajet piéton et ligne droite), à 4,8 km/h (80 m par minute).
 */
export const DETOUR = 1.3;
export const WALK_METERS_PER_MINUTE = 80;
export const walkMinutes = (crow: number) => Math.max(1, Math.round(crow * DETOUR / WALK_METERS_PER_MINUTE));

/** Au-delà (≈ 30 min de marche estimée), on ne cite pas de station : elle n'est pas « à proximité ». */
export const MAX_STOP_METERS = 1_850;

/** Station de métro ou de tram la plus proche d'un point, ou null s'il n'y en a aucune à distance de marche. */
export function nearestStop(point: { lat: number; lng: number }, list: Station[] = stations): NearestStop | null {
  // Préfiltre grossier en degrés (1° de latitude ≈ 111 km) avant le calcul exact.
  const dLat = MAX_STOP_METERS / 111_000;
  const dLng = dLat / Math.max(0.2, Math.cos(point.lat * Math.PI / 180));
  let best: Station | null = null, distance = MAX_STOP_METERS;
  for (const station of list) {
    if (Math.abs(station.lat - point.lat) > dLat || Math.abs(station.lng - point.lng) > dLng) continue;
    const d = crowMeters(point, station);
    if (d <= distance) [best, distance] = [station, d];
  }
  return best && { ...best, distanceMeters: Math.round(distance), walkMinutes: walkMinutes(distance) };
}
