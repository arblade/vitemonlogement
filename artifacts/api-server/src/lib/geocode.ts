import { logger } from "./logger";
import type { Place } from "../routes/housing/store";

/** Géocodeur de l'IGN (Géoplateforme), gratuit et sans clé. GEOCODER_BASE_URL permet de le remplacer (tests). */
const baseUrl = () => process.env.GEOCODER_BASE_URL || "https://data.geopf.fr/geocodage";

export type GeocodedPoint = { lat: number; lng: number; label: string };

type Feature = { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };

const MIN_SCORE = 0.5;
// Une commune seule n'est pas une adresse : on ne la place pas sur la carte.
const PRECISE_ADDRESS = new Set(["housenumber", "street", "locality"]);

function point(feature: Feature | undefined): { lat: number; lng: number } | null {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function search(query: string, index: "address" | "poi", fetcher: typeof fetch): Promise<Feature | undefined> {
  const url = `${baseUrl()}/search?${new URLSearchParams({ q: query.slice(0, 200), index, limit: "1" })}`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Géocodage (${response.status})`);
  const body = await response.json() as { features?: Feature[] };
  return body.features?.[0];
}

/**
 * Adresse exacte ou rue d'abord, puis lieu nommé (université, gare, hôpital…). `city` précise la recherche
 * quand l'adresse citée ne la contient pas. Renvoie null si rien de fiable : jamais d'erreur remontée.
 */
export async function geocode(address: string, city = "", fetcher: typeof fetch = fetch): Promise<GeocodedPoint | null> {
  const query = city && !address.toLocaleLowerCase("fr").includes(city.toLocaleLowerCase("fr")) ? `${address}, ${city}` : address;
  try {
    const found = await search(query, "address", fetcher);
    const props = found?.properties ?? {};
    const located = point(found);
    if (located && Number(props.score) >= MIN_SCORE && PRECISE_ADDRESS.has(String(props.type))) {
      return { ...located, label: String(props.label ?? query) };
    }
    const poi = await search(query, "poi", fetcher);
    const poiProps = poi?.properties ?? {};
    const poiPoint = point(poi);
    if (poiPoint && Number(poiProps.score) >= MIN_SCORE) {
      const cityName = Array.isArray(poiProps.city) ? poiProps.city[0] : poiProps.city;
      return { ...poiPoint, label: [poiProps.toponym, cityName].filter(Boolean).join(", ") || query };
    }
    return null;
  } catch (error) {
    logger.warn({ err: error, address }, "Geocoding failed");
    return null;
  }
}

/** Géocode chaque lieu de vie (dans la ville recherchée) ; un lieu introuvable reste sans coordonnées. */
export async function locatePlaces(places: Place[] = [], city = "", fetcher: typeof fetch = fetch): Promise<Place[]> {
  return Promise.all(places.map(async place => {
    const found = await geocode(place.address, city, fetcher);
    return found ? { ...place, lat: found.lat, lng: found.lng, resolved: found.label } : place;
  }));
}
