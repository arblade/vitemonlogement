import { inArray } from "drizzle-orm";
import { walkAccess } from "@workspace/db";
import { db } from "./database";
import { intEnv } from "./env";
import { logger } from "./logger";
import { consume } from "./quota";
import { busStopsNear } from "./bus-stops";
import { stationsNear, walkMinutes, type StopLine } from "./stations";

// Accès à pied depuis un logement : station de métro ou de tram et arrêt de bus les plus proches. Candidats lus sans
// appel payant (base de stations embarquée, arrêts de bus des tuiles OpenFreeMap), puis vrai temps de marche par
// OpenRouteService (une matrice par logement, gratuite dans la limite du plan Standard). Sans clé ORS ou en cas de
// panne : marche estimée d'après la distance à vol d'oiseau, recalculée quand ORS revient.
export type AccessStop = {
  name: string; lat: number; lng: number;
  /** Distance à pied si `estimated` est faux, sinon à vol d'oiseau. */
  distanceMeters: number; walkMinutes: number; lines: StopLine[]; estimated: boolean;
};
export type Access = { metro: AccessStop | null; bus: AccessStop | null; routed: boolean };
type Point = { lat: number; lng: number };

export const orsAvailable = () => Boolean(process.env.ORS_API_KEY);
const orsBase = () => process.env.ORS_BASE_URL || "https://api.heigit.org/openrouteservice";
/** Au-delà, l'arrêt n'est pas annoncé (le chemin réel peut être bien plus long que la ligne droite). */
export const MAX_WALK_MINUTES = 30;

export const accessKey = ({ lat, lng }: Point) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/**
 * Matrice OpenRouteService à pied : du logement vers chaque candidat, [secondes, mètres] (null si injoignable).
 * Chaque appel est décompté d'un plafond quotidien (ORS_MATRIX_PER_DAY, 450 par défaut, sous les 500 gratuits).
 */
export async function walkMatrix(from: Point, to: Point[], fetcher: typeof fetch = fetch): Promise<([number, number] | null)[]> {
  const usage = await consume("ors-matrix", 24 * 3_600_000);
  if (usage.count > intEnv("ORS_MATRIX_PER_DAY", 450)) throw new Error("Plafond quotidien OpenRouteService atteint.");
  const response = await fetcher(`${orsBase()}/v2/matrix/foot-walking`, {
    method: "POST",
    headers: { Authorization: process.env.ORS_API_KEY ?? "", "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      locations: [from, ...to].map(point => [point.lng, point.lat]),
      sources: [0], destinations: to.map((_, index) => index + 1), metrics: ["duration", "distance"],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRouteService a répondu ${response.status}`);
  const body = await response.json() as { durations?: (number | null)[][]; distances?: (number | null)[][] };
  return to.map((_, index) => {
    const duration = body.durations?.[0]?.[index], distance = body.distances?.[0]?.[index];
    return duration == null || distance == null ? null : [duration, distance];
  });
}

type Candidate = Omit<AccessStop, "walkMinutes" | "estimated"> & { kind: "metro" | "bus" };

/** Le meilleur candidat de chaque sorte : le plus court à pied (ORS) ou, sans ORS, le plus proche à vol d'oiseau. */
function pick(candidates: Candidate[], walks: ([number, number] | null)[] | null, kind: Candidate["kind"]): AccessStop | null {
  const options = candidates.flatMap((candidate, index) => {
    if (candidate.kind !== kind) return [];
    const { kind: _kind, ...stop } = candidate;
    if (!walks) return [{ ...stop, walkMinutes: walkMinutes(candidate.distanceMeters), estimated: true }];
    const walk = walks[index];
    return walk ? [{ ...stop, distanceMeters: Math.round(walk[1]), walkMinutes: Math.max(1, Math.round(walk[0] / 60)), estimated: false }] : [];
  });
  const best = options.sort((a, b) => a.walkMinutes - b.walkMinutes || a.distanceMeters - b.distanceMeters)[0];
  return best && best.walkMinutes <= MAX_WALK_MINUTES ? best : null;
}

/** Calcule l'accès à pied d'un point (sans cache). Les arrêts de bus injoignables font échouer : rien de partiel. */
export async function computeAccess(point: Point, fetcher: typeof fetch = fetch): Promise<Access> {
  const stations: Candidate[] = stationsNear(point, 3).map(({ walkMinutes: _w, ...station }) => ({ ...station, kind: "metro" }));
  const buses: Candidate[] = (await busStopsNear(point, 3, fetcher)).map(stop => ({ ...stop, lines: [], kind: "bus" }));
  const candidates = [...stations, ...buses];
  let walks: ([number, number] | null)[] | null = null;
  if (candidates.length && orsAvailable()) {
    try {
      walks = await walkMatrix(point, candidates, fetcher);
    } catch (error) {
      logger.warn({ err: error }, "Walking times unavailable, falling back to estimates");
    }
  }
  return { metro: pick(candidates, walks, "metro"), bus: pick(candidates, walks, "bus"), routed: walks != null };
}

/** Accès déjà calculés pour ces positions (une requête). */
export async function storedAccess(points: Point[]): Promise<Map<string, Access>> {
  const keys = [...new Set(points.map(accessKey))];
  if (!keys.length) return new Map();
  const rows = await db().select().from(walkAccess).where(inArray(walkAccess.key, keys));
  return new Map(rows.map(row => [row.key, JSON.parse(row.access) as Access]));
}

/**
 * Calcule et garde l'accès des positions qui n'en ont pas (ou seulement une estimation, si ORS est maintenant
 * disponible), 4 à la fois. Ne lève jamais : un échec laisse l'estimation affichée et sera retenté plus tard.
 */
export async function ensureAccess(points: Point[], fetcher: typeof fetch = fetch) {
  try {
    const known = await storedAccess(points);
    const todo = [...new Map(points.map(point => [accessKey(point), point])).entries()]
      .filter(([key]) => { const access = known.get(key); return !access || (!access.routed && orsAvailable()); });
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map(async ([key, point]) => {
        try {
          const access = await computeAccess(point, fetcher);
          await db().insert(walkAccess).values({ key, access: JSON.stringify(access), createdAt: Date.now() })
            .onConflictDoUpdate({ target: walkAccess.key, set: { access: JSON.stringify(access), createdAt: Date.now() } });
        } catch (error) {
          logger.warn({ err: error, key }, "Walking access not computed");
        }
      }));
    }
  } catch (error) {
    logger.warn({ err: error }, "Walking access skipped");
  }
}
