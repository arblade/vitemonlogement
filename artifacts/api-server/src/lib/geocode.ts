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

const fold = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, " ").trim();

export type TextPosition = { lat: number; lng: number; precision: "streetNumber" | "street"; label: string };

async function candidates(query: string, postcode: string | null, fetcher: typeof fetch): Promise<Feature[]> {
  const params = new URLSearchParams({ q: query.slice(0, 200), index: "address", limit: "5" });
  if (postcode) params.set("postcode", postcode);
  const response = await fetcher(`${baseUrl()}/search?${params}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Géocodage (${response.status})`);
  return (await response.json() as { features?: Feature[] }).features ?? [];
}

/**
 * Position d'une adresse lue dans la description d'une annonce (étude du 01/10/2026 : erreur médiane 31 m, pire 273 m
 * sur 35 annonces à position connue). Règles : même commune ; d'abord dans le code postal de l'annonce (les rues
 * homonymes d'une grande ville sont ainsi départagées) avec un score ≥ 0,7 ; sinon, sans filtre, seulement un score
 * ≥ 0,9 dans ce même code postal. Rien de sûr : null (l'annonce garde sa zone). Jamais d'erreur remontée.
 */
export async function geocodeListingAddress(address: { street: string; number: string | null }, city: string, postcode: string | null,
  fetcher: typeof fetch = fetch): Promise<TextPosition | null> {
  const query = `${address.number ? `${address.number} ` : ""}${address.street}, ${city}`;
  const pick = (features: Feature[], minScore: number) => features.find(feature => {
    const props = feature.properties ?? {};
    return fold(props.city) === fold(city) && (props.type === "housenumber" || props.type === "street") && Number(props.score) >= minScore
      && point(feature) && (!postcode || String(props.postcode) === postcode);
  });
  try {
    let found = postcode ? pick(await candidates(query, postcode, fetcher), 0.7) : undefined;
    if (!found) found = pick(await candidates(query, null, fetcher), 0.9);
    if (!found) return null;
    const props = found.properties ?? {};
    return { ...point(found)!, precision: props.type === "housenumber" && address.number ? "streetNumber" : "street", label: String(props.label ?? query) };
  } catch (error) {
    logger.warn({ err: error, query }, "Listing address geocoding failed");
    return null;
  }
}
