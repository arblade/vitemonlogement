import { isPrecise, type Criteria, type Feature, type GeoPrecision, type Listing } from "./store";
import { geocodeListingAddress } from "../../lib/geocode";
import type { ListingAddress } from "../../lib/analysis-cache";
import { logger } from "../../lib/logger";
import { first, getImages, number, object, text } from "./parse";
import { leboncoinDate } from "../../lib/paris-time";
import { apify } from "./apify-client";
import type { SourceRun } from "./sources";
import { apiValue, checksFor, evaluateStructured } from "./criteria";
import { CATALOGUE } from "./catalogue";
import { isHousingListingUrl, type SearchBatch } from "./housing-search";
import { isColocationAd, isSeekerAd } from "./offer";

export function scoreListing(item: Pick<Listing, "price" | "area" | "rooms" | "title" | "description">, criteria: Criteria) {
  let score = 60;
  if (criteria.minPrice != null && item.price != null) score += item.price >= criteria.minPrice ? 8 : -18;
  if (criteria.maxPrice != null && item.price != null) score += item.price <= criteria.maxPrice ? 12 : -24;
  if (criteria.minArea != null && item.area != null) score += item.area >= criteria.minArea ? 10 : -15;
  if (criteria.maxArea != null && item.area != null) score += item.area <= criteria.maxArea ? 8 : -15;
  if (criteria.minRooms != null && item.rooms != null) score += item.rooms >= criteria.minRooms ? 8 : -12;
  if (criteria.maxRooms != null && item.rooms != null) score += item.rooms <= criteria.maxRooms ? 6 : -12;
  const haystack = `${item.title} ${item.description}`.toLocaleLowerCase("fr");
  for (const wish of (criteria.wishes ?? []).slice(0, 4)) {
    const terms = wish.toLocaleLowerCase("fr").split(/[^\p{L}]+/u).filter(term => term.length > 5);
    if (terms.some(term => haystack.includes(term))) score += 3;
  }
  return Math.max(0, Math.min(100, score));
}

const extraFields = [
  { keys: ["nb_parkings"], label: "Stationnement", count: "place(s)" },
  { keys: ["furnished"], label: "Meublé", yesNo: true },
  { keys: ["elevator"], label: "Ascenseur", yesNo: true },
  { keys: ["balcony"], label: "Balcon", yesNo: true },
  { keys: ["terrace"], label: "Terrasse", yesNo: true },
  { keys: ["garden"], label: "Jardin", yesNo: true },
  { keys: ["floor"], label: "Étage" },
  { keys: ["bedrooms", "nb_bedrooms"], label: "Chambres" },
  { keys: ["bathrooms", "nb_bathrooms"], label: "Salles de bain" },
  { keys: ["energy_rate", "energy_class"], label: "Classe énergie" },
  { keys: ["ges", "ges_rate"], label: "Émissions GES" },
  { keys: ["heating"], label: "Chauffage" },
  { keys: ["exposure"], label: "Exposition" },
  { keys: ["charges"], label: "Charges" },
] as const;

function otherApiFeatures(data: Record<string, unknown>, criteria: Criteria): Feature[] {
  const requestedFields = new Set(checksFor(criteria).map(check => check.apiField));
  const features: Feature[] = [];
  for (const spec of extraFields) {
    const key = spec.keys.find(candidate => apiValue(data, candidate) != null);
    if (!key) continue;
    const field = key === "nb_parkings" ? "parking" : key;
    if (requestedFields.has(field)) continue;
    const raw = apiValue(data, key);
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    let value = String(raw).trim();
    if ((spec.label === "Classe énergie" || spec.label === "Émissions GES") && /^[a-g]$/i.test(value)) value = value.toUpperCase();
    if (!value || value.length > 70) continue;
    if ("yesNo" in spec && spec.yesNo) {
      if (raw === true || raw === 1 || /^(oui|yes|true|1|meubl[eé])$/i.test(value)) value = "Oui";
      else if (raw === false || raw === 0 || /^(non|no|false|0|non[\s-]*meubl[eé])$/i.test(value)) value = "Non";
      else continue;
    }
    if ("count" in spec && spec.count) {
      const count = Number(raw);
      if (!Number.isFinite(count) || count < 0) continue;
      value = `${count} ${spec.count}`;
    }
    features.push({ label: spec.label, value, source: "annonce",
      evidence: `Indiqué dans l’annonce : « ${key} ».` });
  }
  // Chauffage (« Individuel · gaz ») et date de disponibilité, quand Le Bon Coin les donne.
  const heating = [apiValue(data, "heating_type"), apiValue(data, "heating_mode")].filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length < 30);
  if (heating.length && !features.some(feature => feature.label === "Chauffage")) {
    features.push({ label: "Chauffage", value: heating.map((value, i) => i ? value.toLocaleLowerCase("fr") : value).join(" · "), source: "annonce", evidence: "Indiqué dans l’annonce : « chauffage »." });
  }
  const available = apiValue(data, "available_date");
  if (typeof available === "string" && /^\d{1,2}\/\d{4}$|^\d{2}\/\d{2}\/\d{4}$/.test(available.trim())) {
    features.push({ label: "Disponible", value: `à partir du ${available.trim()}`.replace(/^à partir du (\d{1,2}\/\d{4})$/, "à partir de $1"), source: "annonce", evidence: "Indiqué dans l’annonce : « date de disponibilité »." });
  }
  // Catalogue (cases « Spécificités », étage, état…) : ce que Le Bon Coin dit avec certitude, sans IA.
  const shown = new Set(features.map(feature => feature.label));
  const covered: Record<string, string> = { parking: "Stationnement", furnished: "Meublé", elevator: "Ascenseur", balcony: "Balcon", terrace: "Terrasse", garden: "Jardin" };
  for (const feature of CATALOGUE) {
    if (feature.id === "outdoor" || requestedFields.has(feature.id) || shown.has(feature.label) || (covered[feature.id] && shown.has(covered[feature.id]))) continue;
    const presence = feature.structured?.(data);
    if (!presence) continue;
    features.push({ label: feature.label, value: presence === "yes" ? "" : "Non", source: "annonce", evidence: "Indiqué dans l’annonce : « Spécificités »." });
    shown.add(feature.label);
  }
  return features;
}

const PRECISIONS = ["streetNumber", "street", "district", "city"] as const;

/** Coordonnées de l'annonce et leur précision (`location.type` / `origin_type` renvoyés par Le Bon Coin). */
export function listingPosition(data: Record<string, unknown>): Pick<Listing, "lat" | "lng" | "geoPrecision"> {
  const location = object(data.location);
  // Pas `number()` : il est fait pour les prix et perdrait le signe des longitudes négatives (ouest de la France).
  const coordinate = (value: unknown) => {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(",", ".")) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const lat = coordinate(first(location, ["lat", "latitude"]));
  const lng = coordinate(first(location, ["lng", "lon", "longitude"]));
  const type = text(first(location, ["type", "origin_type"]));
  const valid = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (!valid) return { lat: null, lng: null, geoPrecision: null };
  const geoPrecision = (PRECISIONS as readonly string[]).includes(type) ? type as GeoPrecision : null;
  return { lat, lng, geoPrecision };
}

// Type de bien Le Bon Coin : libellé au premier niveau (« Parking »), code dans attributes (« 4 »).
const NOT_DWELLING = new Set(["3", "4", "terrain", "parking"]);
export const isDwellingType = (data: Record<string, unknown>) =>
  !NOT_DWELLING.has(text(first(data, ["real_estate_type"])).trim().toLocaleLowerCase("fr")) &&
  !NOT_DWELLING.has(text(apiValue({ attributes: data.attributes }, "real_estate_type")).trim().toLocaleLowerCase("fr"));

const parsed = (value: unknown) => {
  if (typeof value !== "string") return object(value);
  try { return object(JSON.parse(value)); } catch { return {}; }
};

/**
 * Annonce de l'acteur `fatihtahta` (record « property_listing ») ramenée au format Le Bon Coin lu par `normalize`.
 * Location seulement : `deal_type` doit valoir « rent ». Photos demandées en grande taille, comme avec `clearpath`.
 */
export function fromFatihRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  if (parsed(record.listing).deal_type !== "rent") return null;
  const raw = parsed(record.source_data);
  const property = parsed(record.property);
  const urls = parsed(parsed(record.media).images).urls;
  // clearpath recopie le libellé de chaque attribut au premier niveau (« Non meublé », « Non ») ; le code seul
  // (« 2 ») ne serait pas compris par les critères meublé, ascenseur, parking.
  const labels = Object.fromEntries((Array.isArray(raw.attributes) ? raw.attributes : []).map(object)
    .filter(attribute => typeof attribute.key === "string" && typeof attribute.value_label === "string")
    .map(attribute => [attribute.key as string, attribute.value_label]));
  return {
    ...labels,
    ad_type: record.listing_type, // « offer » ou « demand » (au premier niveau de l'annonce, pas dans listing)
    // Dates à l'heure de Paris (voir lib/paris-time.ts) : publication et dernière mise à jour.
    first_publication_date: parsed(record.listing).posted_at, index_date: parsed(record.listing).updated_at,
    url: record.url, subject: record.title, body: record.description,
    price_euros: object(record.pricing).amount_eur,
    square: property.surface_m2, rooms: property.rooms,
    location: raw.location, attributes: raw.attributes,
    images: { urls_large: Array.isArray(urls) ? urls.map(url => String(url).replace("rule=ad-image", "rule=ad-large")) : [] },
  };
}

export function normalize(raw: unknown, criteria: Criteria, batch: SearchBatch = "focused"): Omit<Listing, "id"> | null {
  const source = object(raw);
  const fatih = source.record_type === "property_listing" ? fromFatihRecord(source) : undefined;
  if (fatih === null) return null;
  const data = fatih ?? (Object.keys(object(source.ad)).length ? object(source.ad) : source);
  const url = text(first(data, ["url", "link", "adUrl", "ad_url", "listingUrl"]));
  if (!isHousingListingUrl(url)) return null;
  // Filet de sécurité : la recherche demande déjà « appartement ou maison », mais la requête de repli (ville non
  // reconnue) ne le peut pas. Un parking ou un terrain n'est jamais un logement.
  if (!isDwellingType(data)) return null;
  const title = text(first(data, ["title", "subject", "name"])).slice(0, 250);
  if (!title) return null;
  const description = text(first(data, ["description", "body", "text", "content"])).slice(0, 10000);
  // Une demande (« Recherche appartement T2 ») publiée dans Locations n'est pas un logement à louer.
  if (isSeekerAd({ adType: data.ad_type, title, description })) return null;
  // Colocation ou chambre seule : pas un logement entier (voir offer.ts ; l'IA tranche ensuite les cas ambigus).
  if (isColocationAd({ title, description })) return null;
  const attrs = object(first(data, ["attributes", "details", "criteria"]));
  const price = number(first(data, ["price_euros", "price", "price_value", "priceValue"]));
  const area = number(first(data, ["square", "surface", "area", "livingArea", "squareMeters"])) ?? number(first(attrs, ["surface", "area", "livingArea"]));
  const rooms = number(first(data, ["rooms", "nbRooms", "roomCount", "pieces"])) ?? number(first(attrs, ["rooms", "nbRooms", "pieces"]));
  const locationData = first(data, ["location", "city", "localisation", "city_name"]);
  const location = text(typeof locationData === "object" ? first(object(locationData), ["city", "name", "label"]) : locationData) || null;
  const images = getImages(first(data, ["images", "pictures", "photos", "image", "imageUrl"]));
  const image = images[0] ?? null;
  const features = otherApiFeatures(data, criteria);
  const postcode = text(first(object(locationData), ["zipcode", "zip_code", "postal_code"])).match(/^\d{5}$/)?.[0] ?? null;
  const postedAt = leboncoinDate(first(data, ["first_publication_date", "posted_at"]));
  const refreshedAt = leboncoinDate(first(data, ["index_date", "updated_at"])) ?? postedAt;
  const listing = { source: "leboncoin" as const, batch, title, url, description, price, area, rooms: rooms === null ? null : Math.floor(rooms), location, image, images, aiSummary: null, summaryEvidence: [], features, ...listingPosition(data), postcode, postedAt, refreshedAt };
  const criterionResults = evaluateStructured(criteria, listing, data);
  return { ...listing, criterionResults, score: scoreListing(listing, criteria) };
}

type Position = Pick<Listing, "lat" | "lng" | "geoPrecision" | "geoSource" | "geoEvidence">;

/**
 * Position enregistrée. Celle donnée par l'annonce si elle est précise (adresse ou rue). Sinon (agences : quartier ou
 * commune), l'adresse que la description cite, géocodée par l'IGN ; à défaut, celle déjà retrouvée lors d'une
 * recherche précédente ; à défaut, la zone donnée par l'annonce.
 */
export async function positionOf(item: Omit<Listing, "id">, address: ListingAddress | null, previous: Listing | undefined): Promise<Position> {
  const given: Position = { lat: item.lat, lng: item.lng, geoPrecision: item.geoPrecision, geoSource: null, geoEvidence: null };
  if (isPrecise(item)) return given;
  if (address && item.location) {
    const found = await geocodeListingAddress(address, item.location, item.postcode ?? null);
    if (found) return { lat: found.lat, lng: found.lng, geoPrecision: found.precision, geoSource: "description", geoEvidence: address.evidence };
  }
  if (previous?.geoSource === "description" && isPrecise(previous)) {
    return { lat: previous.lat, lng: previous.lng, geoPrecision: previous.geoPrecision, geoSource: "description", geoEvidence: previous.geoEvidence ?? null };
  }
  return given;
}

const PENDING = new Set(["READY", "RUNNING", "TIMING-OUT", "ABORTING"]);

/**
 * Annonces des sources secondaires : « pending » tant qu'un de leurs runs tourne encore. Un run en échec, ou
 * illisible, est ignoré (journalisé) : il ne fait jamais échouer la recherche, Le Bon Coin suffit.
 */
export async function extraSourceItems(raw: string | null, limit: number): Promise<"pending" | { source: SourceRun["source"]; items: unknown[] }[]> {
  const runs = raw ? JSON.parse(raw) as SourceRun[] : [];
  const states = await Promise.all(runs.map(async ({ source, runId }) => {
    try {
      const run = object(object(await apify(`/v2/actor-runs/${encodeURIComponent(runId)}`)).data);
      return { source, runId, status: text(run.status), datasetId: text(run.defaultDatasetId) };
    } catch (error) {
      logger.warn({ err: error, source, runId }, "Listing source run unreadable");
      return { source, runId, status: "UNREADABLE", datasetId: "" };
    }
  }));
  // Résultats lus une seule fois, quand plus aucune source ne tourne.
  if (states.some(state => PENDING.has(state.status))) return "pending";
  const results = await Promise.all(states.map(async ({ source, runId, status, datasetId }) => {
    if (status !== "SUCCEEDED" || !datasetId) {
      logger.warn({ source, runId, status }, "Listing source run did not succeed");
      return null;
    }
    try {
      const items = await apify(`/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true&limit=${limit}`);
      return Array.isArray(items) ? { source, items } : null;
    } catch (error) {
      logger.warn({ err: error, source, runId }, "Listing source results unreadable");
      return null;
    }
  }));
  return results.filter(result => result !== null);
}

/**
 * Date de dernière mise à jour d'une annonce lue, même écartée ensuite (parking, colocation…) : elle dit jusqu'où on est
 * descendu dans la liste Le Bon Coin, triée de la plus récemment mise à jour à la plus ancienne.
 */
export function itemRefreshedAt(raw: unknown): number | null {
  const source = object(raw);
  if (source.record_type === "property_listing") {
    const listing = parsed(source.listing);
    return leboncoinDate(listing.updated_at) ?? leboncoinDate(listing.posted_at);
  }
  const data = Object.keys(object(source.ad)).length ? object(source.ad) : source;
  return leboncoinDate(first(data, ["index_date", "updated_at"])) ?? leboncoinDate(first(data, ["first_publication_date", "posted_at"]));
}
