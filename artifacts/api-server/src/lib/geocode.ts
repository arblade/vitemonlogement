import { logger } from "./logger";
import { matchAirport } from "./airports";
import { resolvePlace } from "./places";
import type { Place } from "../routes/housing/store";

/** Géocodeur de l'IGN (Géoplateforme), gratuit et sans clé. GEOCODER_BASE_URL permet de le remplacer (tests). */
const baseUrl = () => process.env.GEOCODER_BASE_URL || "https://data.geopf.fr/geocodage";

/**
 * `searchCity` (lieux repères) : ville où chercher quand la demande n'en donne pas d'autre, reconnue par la base des
 * communes (« Rennes » pour son aéroport, sinon la commune du lieu avec son département : « Fretin (59) »).
 */
export type GeocodedPoint = { lat: number; lng: number; label: string; searchCity?: string };

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
const withCity = (address: string, city: string) => city && !address.toLocaleLowerCase("fr").includes(city.toLocaleLowerCase("fr")) ? `${address}, ${city}` : address;

/** Adresse exacte ou rue, jamais une commune seule ni un score faible. */
async function preciseAddress(query: string, fetcher: typeof fetch): Promise<GeocodedPoint | null> {
  const found = await search(query, "address", fetcher);
  const props = found?.properties ?? {};
  const located = point(found);
  return located && Number(props.score) >= MIN_SCORE && PRECISE_ADDRESS.has(String(props.type)) ? { ...located, label: String(props.label ?? query) } : null;
}

export async function geocode(address: string, city = "", fetcher: typeof fetch = fetch): Promise<GeocodedPoint | null> {
  const query = withCity(address, city);
  try {
    const exact = await preciseAddress(query, fetcher);
    if (exact) return exact;
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

const fold = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, " ").trim();

const STOP_WORDS = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "au", "aux", "et", "en", "sur", "a"]);
const words = (value: unknown) => fold(value).split(" ").filter(word => word.length > 1 && !STOP_WORDS.has(word));
// Zones et lieux-dits ne sont pas des équipements : « Sud Gare » (quartier) n'est pas la gare.
const NOT_A_FACILITY = /quartier|zone d habitation|lieu dit|parking/;

/**
 * Lieu repère (aéroport, gare, hôpital, campus…) dans l'index des lieux de l'IGN. Chaque mot du nom demandé doit se
 * retrouver dans le nom, la catégorie ou la commune du résultat (« gare de Rennes » → la gare « Rennes », catégorie
 * « gare voyageurs »), et les quartiers et lieux-dits sont écartés. Le mieux noté gagne.
 */
async function landmark(query: string, fetcher: typeof fetch): Promise<GeocodedPoint | null> {
  const url = `${baseUrl()}/search?${new URLSearchParams({ q: query.slice(0, 200), index: "poi", limit: "8" })}`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Géocodage (${response.status})`);
  const wanted = words(query);
  const features = ((await response.json() as { features?: Feature[] }).features ?? []).filter(feature => {
    const props = feature.properties ?? {};
    const score = Number(props.score);
    const text = new Set(words([props.toponym, props.category, props.city].flat().join(" ")));
    return score >= 0.3 && point(feature) && wanted.length > 0 && wanted.every(word => text.has(word)) && !NOT_A_FACILITY.test(fold([props.category].flat().join(" ")));
  });
  const best = features.sort((a, b) => Number(b.properties?.score) - Number(a.properties?.score))[0];
  if (!best) return null;
  const props = best.properties ?? {};
  const cityName = Array.isArray(props.city) ? props.city[0] : props.city;
  // La gare de Rennes s'appelle « Rennes » dans la base : on garde alors le nom demandé.
  const label = fold(props.toponym) === fold(cityName) ? query : [props.toponym, cityName].filter(Boolean).join(", ");
  const department = Array.isArray(props.depcode) ? props.depcode[0] : props.depcode;
  return { ...point(best)!, label: label || query, ...(cityName ? { searchCity: department ? `${cityName} (${department})` : String(cityName) } : {}) };
}

/** OpenStreetMap (Nominatim), gratuit mais limité (1 requête par seconde, User-Agent exigé) : dernier recours, lieux repères seulement. */
const nominatimBase = () => process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
const FACILITY_AMENITIES = new Set(["hospital", "clinic", "university", "college", "school", "townhall", "courthouse", "library", "theatre", "cinema"]);

const isFacility = (hit: Record<string, unknown>) => {
  const [kind, type] = [String(hit.category ?? hit.class), String(hit.type)];
  return kind === "aeroway" ? type === "aerodrome" || type === "terminal"
    : kind === "railway" ? type === "station"
    : kind === "amenity" ? FACILITY_AMENITIES.has(type)
    : kind === "shop" ? type === "mall"
    : kind === "leisure" ? type === "stadium" || type === "sports_centre"
    : kind === "tourism";
};

async function nominatimLandmark(query: string, city: string, fetcher: typeof fetch): Promise<GeocodedPoint | null> {
  const params = new URLSearchParams({ q: query.slice(0, 200), format: "jsonv2", limit: "5", countrycodes: "fr" });
  const response = await fetcher(`${nominatimBase()}/search?${params}`, {
    headers: { "User-Agent": "vitemonlogement/1.0 (lieux repères)" }, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Nominatim (${response.status})`);
  const hits = await response.json() as Record<string, unknown>[];
  // Un équipement homonyme d'une autre région est pire que pas de réponse : la ville recherchée doit y figurer.
  const hit = hits.find(item => isFacility(item) && (!city || fold(item.display_name).includes(fold(city))));
  const [lat, lng] = [Number(hit?.lat), Number(hit?.lon)];
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: String(hit.display_name ?? query).split(",")[0].trim() || query };
}

/**
 * Lieu repère cité avec une contrainte de distance (aéroport, gare, hôpital…) : grands aéroports d'abord (table
 * airports.ts, l'IGN confondant « aéroport de Lyon » avec Bron), puis lieux de l'IGN (nom seul : ajouter la ville à la
 * requête la fait échouer), puis adresse ou lieu comme `geocode`, enfin OpenStreetMap.
 */
export async function geocodeLandmark(address: string, city = "", fetcher: typeof fetch = fetch): Promise<GeocodedPoint | null> {
  const airport = matchAirport(address, city);
  if (airport.status === "found") {
    const { name, lat, lng, commune, department, serves } = airport.airport;
    const served = serves.length ? resolvePlace(serves[0]) : null;
    return { lat, lng, label: `${name}, ${commune}`, searchCity: served?.status === "resolved" ? served.commune.name : `${commune} (${department})` };
  }
  // Paris : Roissy ou Orly ? L'index de l'IGN répondrait Le Bourget : mieux vaut ne rien placer que se tromper.
  if (airport.status === "ambiguous") {
    logger.info({ address, candidates: airport.candidates.map(candidate => candidate.name) }, "Ambiguous airport, left unlocated");
    return null;
  }
  try {
    const found = await landmark(address, fetcher);
    if (found) return found;
  } catch (error) {
    logger.warn({ err: error, address }, "Landmark geocoding failed");
  }
  // Une adresse seulement : le premier lieu venu de l'index (n'importe quel homonyme bien noté) ne vaut rien ici.
  try {
    const exact = await preciseAddress(withCity(address, city), fetcher);
    if (exact) return exact;
  } catch (error) {
    logger.warn({ err: error, address }, "Landmark address geocoding failed");
  }
  try {
    return await nominatimLandmark(address, city, fetcher);
  } catch (error) {
    logger.warn({ err: error, address }, "Nominatim geocoding failed");
    return null;
  }
}

/** Géocode chaque lieu de vie (dans la ville recherchée) ; un lieu introuvable reste sans coordonnées. */
export async function locatePlaces(places: Place[] = [], city = "", fetcher: typeof fetch = fetch): Promise<Place[]> {
  return Promise.all(places.map(async place => {
    const landmarkLike = place.centered || place.maxKm != null || place.maxMinutes != null;
    const found = await (landmarkLike ? geocodeLandmark : geocode)(place.address, city, fetcher);
    return found ? { ...place, lat: found.lat, lng: found.lng, resolved: found.label } : place;
  }));
}

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
