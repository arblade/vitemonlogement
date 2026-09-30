import { eq } from "drizzle-orm";
import { travelRoutes } from "@workspace/db";
import { db } from "./database";
import { intEnv } from "./env";
import { consume } from "./quota";
import type { TravelMode } from "../routes/housing/store";

/** Trajets Google Routes : disponibles seulement quand GOOGLE_MAPS_API_KEY est définie. */
export const routingAvailable = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

const baseUrl = () => process.env.GOOGLE_ROUTES_BASE_URL || "https://routes.googleapis.com";

export type Point = { lat: number; lng: number };
export type TravelRoute = { durationSeconds: number; distanceMeters: number; path: [number, number][] };

export class RoutingQuotaError extends Error {}

const GOOGLE_MODE: Record<TravelMode, string> = { transit: "TRANSIT", drive: "DRIVE", bike: "BICYCLE", walk: "WALK" };

/** Algorithme « encoded polyline » de Google (précision 1e-5) → [[lat, lng], …]. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  const next = () => {
    let result = 0, shift = 0, byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Prochain mardi 9 h, heure de Paris : un horaire de semaine fixe, pour des temps de transport comparables. */
export function nextTuesdayNineParis(now = new Date()): string {
  const day = new Date(now);
  day.setUTCDate(day.getUTCDate() + (((2 - day.getUTCDay()) + 7) % 7 || 7));
  const date = day.toISOString().slice(0, 10);
  // Décalage de Paris ce jour-là (+01:00 ou +02:00).
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find(part => part.type === "timeZoneName")?.value.replace("GMT", "") || "+01:00";
  return new Date(`${date}T09:00:00${offset}`).toISOString();
}

const round = (value: number) => value.toFixed(5);
export const routeKey = (mode: TravelMode, from: Point, to: Point) =>
  `${mode}|${round(from.lat)},${round(from.lng)}|${round(to.lat)},${round(to.lng)}`;

async function callGoogle(mode: TravelMode, from: Point, to: Point, fetcher: typeof fetch): Promise<TravelRoute | null> {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode: GOOGLE_MODE[mode],
    languageCode: "fr-FR",
    units: "METRIC",
  };
  if (mode === "drive") body.routingPreference = "TRAFFIC_UNAWARE";
  if (mode === "transit") body.arrivalTime = nextTuesdayNineParis();
  const response = await fetcher(`${baseUrl()}/directions/v2:computeRoutes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY ?? "",
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Google Routes (${response.status}) : ${(await response.text()).slice(0, 200)}`);
  const route = (await response.json() as { routes?: { duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }[] }).routes?.[0];
  // Aucun itinéraire (ex. pas de transport en commun) : réponse vide, pas une erreur.
  if (!route?.duration) return null;
  return {
    durationSeconds: Math.round(Number.parseFloat(route.duration)),
    distanceMeters: route.distanceMeters ?? 0,
    path: route.polyline?.encodedPolyline ? decodePolyline(route.polyline.encodedPolyline) : [[from.lat, from.lng], [to.lat, to.lng]],
  };
}

/** Distance à vol d'oiseau en mètres (haversine). */
export function crowDistance(a: Point, b: Point) {
  const rad = (value: number) => value * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Seuils du choix du moyen de transport. */
export const COMMUTE = {
  walkMaxSeconds: 20 * 60,
  bikeMaxSeconds: 40 * 60,
  // Au-delà, marcher 20 min (≈ 1,7 km) est impossible : on ne paie pas l'appel.
  walkMaxCrowMeters: 2_000,
} as const;

/** Proposés, au choix de l'utilisateur, quand la marche ne suffit pas. */
export const ALTERNATIVES: TravelMode[] = ["bike", "transit", "drive"];

export type CommuteOption = TravelRoute & { mode: TravelMode; recommended: boolean };

/**
 * À pied si ≤ 20 min : ce seul trajet. Sinon vélo, transports et voiture, calculés en parallèle (un appel chacun :
 * Google ne sert qu'un mode par requête). Recommandé : le mode dit par l'utilisateur, sinon vélo si ≤ 40 min,
 * sinon transports s'il en existe, sinon voiture.
 */
export async function commuteOptions(from: Point, to: Point, stated: TravelMode | null = null, fetcher: typeof fetch = fetch): Promise<CommuteOption[]> {
  let walk: TravelRoute | null = null;
  if (stated === "walk" || (!stated && crowDistance(from, to) <= COMMUTE.walkMaxCrowMeters)) {
    walk = await travelRoute("walk", from, to, fetcher);
    if (walk && (stated === "walk" || walk.durationSeconds <= COMMUTE.walkMaxSeconds)) return [{ mode: "walk", recommended: true, ...walk }];
  }
  const settled = await Promise.allSettled(ALTERNATIVES.map(async mode => {
    const route = await travelRoute(mode, from, to, fetcher);
    return route ? { mode, ...route } : null;
  }));
  const found = settled.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
  if (!found.length) {
    if (walk) return [{ mode: "walk", recommended: true, ...walk }];
    const failure = settled.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    return [];
  }
  const pick = found.find(option => option.mode === stated)
    ?? found.find(option => option.mode === "bike" && option.durationSeconds <= COMMUTE.bikeMaxSeconds)
    ?? found.find(option => option.mode === "transit")
    ?? found.find(option => option.mode === "drive")
    ?? found[0];
  return found.map(option => ({ ...option, recommended: option === pick }));
}

/**
 * Trajet from → to, depuis le cache en base si possible. Chaque vrai appel Google est décompté d'un plafond
 * quotidien global (GOOGLE_ROUTES_PER_DAY, 300 par défaut ≈ la gratuité Google de 10 000 par mois) : au-delà, RoutingQuotaError.
 */
export async function travelRoute(mode: TravelMode, from: Point, to: Point, fetcher: typeof fetch = fetch): Promise<TravelRoute | null> {
  const key = routeKey(mode, from, to);
  const [cached] = await db().select().from(travelRoutes).where(eq(travelRoutes.key, key));
  if (cached) {
    if (cached.durationSeconds < 0) return null;
    return { durationSeconds: cached.durationSeconds, distanceMeters: cached.distanceMeters, path: JSON.parse(cached.path) as [number, number][] };
  }
  const usage = await consume("google-routes", 24 * 3_600_000);
  if (usage.count > intEnv("GOOGLE_ROUTES_PER_DAY", 300)) throw new RoutingQuotaError("Plafond quotidien de calculs de trajet atteint.");
  const route = await callGoogle(mode, from, to, fetcher);
  // « Aucun itinéraire » est mémorisé aussi (durée -1) pour ne pas repayer la même question.
  await db().insert(travelRoutes).values({
    key, durationSeconds: route?.durationSeconds ?? -1, distanceMeters: route?.distanceMeters ?? 0,
    path: JSON.stringify(route?.path ?? []), createdAt: Date.now(),
  }).onConflictDoNothing();
  return route;
}
