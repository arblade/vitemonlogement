import { completeSearch, FAILURE_MESSAGE, getSearch, getSearchRow, isPrecise, setAnalyzing, setFailure, type Criteria, type Feature, type GeoPrecision, type Listing } from "./store";
import { geocodeListingAddress } from "../../lib/geocode";
import type { ListingAddress } from "../../lib/analysis-cache";
import { analyze } from "./ai";
import { logger } from "../../lib/logger";
import { first, getImages, number, object, text } from "./parse";
import { apify } from "./apify-client";
import { interleave, normalizeExtra, startExtraSources, type SourceRun } from "./sources";
import { apiValue, checksFor, evaluateStructured, matchesKnownBasics } from "./criteria";
import { actorRequest, isHousingListingUrl, type SearchBatch } from "./housing-search";
import { isSeekerAd } from "./offer";

// Limites par appel Apify, identiques en développement et en production (protège le budget Apify).
// Modifiables par variables d'environnement : APIFY_RESULT_LIMIT (annonces conservées, défaut 5),
// APIFY_CANDIDATE_LIMIT (annonces Le Bon Coin examinées, défaut 10). SeLoger et PAP : voir sources.ts.
function intEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
export const RESULT_LIMIT = intEnv("APIFY_RESULT_LIMIT", 5);
const CANDIDATE_LIMIT = Math.max(intEnv("APIFY_CANDIDATE_LIMIT", 10), RESULT_LIMIT);


function scoreListing(item: Pick<Listing, "price" | "area" | "rooms" | "title" | "description">, criteria: Criteria) {
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
  const listing = { source: "leboncoin" as const, batch, title, url, description, price, area, rooms: rooms === null ? null : Math.floor(rooms), location, image, images, aiSummary: null, summaryEvidence: [], features, ...listingPosition(data), postcode };
  const criterionResults = evaluateStructured(criteria, listing, data);
  return { ...listing, criterionResults, score: scoreListing(listing, criteria) };
}

export async function startSearch(criteria: Criteria) {
  // Inspect CANDIDATE_LIMIT (10) Le Bon Coin candidates, retain RESULT_LIMIT (5) across all sources.
  const chargeCap = process.env.APIFY_MAX_CHARGE_USD || "0.10";
  const timeout = intEnv("APIFY_TIMEOUT_SECONDS", 120);
  const request = actorRequest(criteria, CANDIDATE_LIMIT, chargeCap, timeout);
  const response = object(await apify(request.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: request.input,
  }));
  const runId = text(object(response.data).id);
  if (!runId) throw new Error("Apify n'a pas retourné d'identifiant d'exécution.");
  // PAP et SeLoger en parallèle.
  const sourceRuns = await startExtraSources(criteria, chargeCap, timeout);
  return { runId, request, sourceRuns };
}

type Position = Pick<Listing, "lat" | "lng" | "geoPrecision" | "geoSource" | "geoEvidence">;

/**
 * Position enregistrée. Celle donnée par l'annonce si elle est précise (adresse ou rue). Sinon (agences : quartier ou
 * commune), l'adresse que la description cite, géocodée par l'IGN ; à défaut, celle déjà retrouvée lors d'une
 * recherche précédente ; à défaut, la zone donnée par l'annonce.
 */
async function positionOf(item: Omit<Listing, "id">, address: ListingAddress | null, previous: Listing | undefined): Promise<Position> {
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
async function extraSourceItems(raw: string | null): Promise<"pending" | { source: SourceRun["source"]; items: unknown[] }[]> {
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
      const items = await apify(`/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true&limit=${CANDIDATE_LIMIT}`);
      return Array.isArray(items) ? { source, items } : null;
    } catch (error) {
      logger.warn({ err: error, source, runId }, "Listing source results unreadable");
      return null;
    }
  }));
  return results.filter(result => result !== null);
}

/** Contrôle une fois le run Apify d'une recherche ; à appeler sous bail (voir worker.ts). */
export async function syncSearch(id: number, criteria: Criteria) {
  const row = await getSearchRow(id);
  if (!row || row.status !== "running" || !row.runId) return;
  const phase: SearchBatch = "focused";
  try {
    const result = object(await apify(`/v2/actor-runs/${encodeURIComponent(row.runId)}`));
    const run = object(result.data);
    const status = text(run.status);
    if (status === "SUCCEEDED") {
      const extra = await extraSourceItems(row.sourceRuns);
      if (extra === "pending") return; // une autre source tourne encore : le worker repasse au prochain contrôle
      const datasetId = text(run.defaultDatasetId);
      if (!datasetId) throw new Error("L'exécution Apify n'a pas de jeu de résultats.");
      const items = await apify(`/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true&limit=${CANDIDATE_LIMIT}`);
      if (!Array.isArray(items)) throw new Error("Le format des résultats Apify est inattendu.");
      const existing = await getSearch(id);
      const oldUrls = new Set(existing?.listings.map(item => item.url) ?? []);
      const seen = new Set<string>();
      const keep = (item: Omit<Listing, "id"> | null): item is Omit<Listing, "id"> => {
        if (!item || seen.has(item.url) || !matchesKnownBasics(item, criteria)) return false;
        seen.add(item.url);
        return true;
      };
      const listings = interleave([
        items.map(item => normalize(item, criteria, phase)).filter(keep),
        ...extra.map(({ source, items: sourceItems }) =>
          sourceItems.map(item => normalizeExtra(source, item, criteria, phase, listing => scoreListing(listing, criteria))).filter(keep)),
      ]);
      await setAnalyzing(id);
      try {
        // Prefer new ads to ones already saved during a refresh or the focused
        // pass; each pass keeps its own limit and the listing URLs are unique.
        const ordered = [...listings].sort((a, b) => Number(oldUrls.has(a.url)) - Number(oldUrls.has(b.url)));
        const saved: Omit<Listing, "id">[] = [];
        const setAside: { url: string; offer: string; evidence: string }[] = [];
        let nextId = 0;
        // Une annonce écartée (chambre, parking…) libère sa place : on analyse les suivantes jusqu'à RESULT_LIMIT.
        for (let offset = 0; offset < ordered.length && saved.length < RESULT_LIMIT;) {
          const selected = ordered.slice(offset, offset + RESULT_LIMIT - saved.length);
          offset += selected.length;
          const candidates = selected.filter(item =>
            !oldUrls.has(item.url) || !existing?.listings.find(previous => previous.url === item.url)?.criterionResults.length)
            .map(item => ({ ...item, id: -(++nextId) }));
          // The LLM receives at most five ads in each bounded request.
          const enriched = candidates.length ? await analyze(candidates, criteria) : [];
          for (const item of selected) {
            const enrichedItem = candidates.find(candidate => candidate.url === item.url);
            const observations = enriched.find(result => result.id === enrichedItem?.id);
            if (observations?.offer && (observations.offer.kind === "room" || observations.offer.kind === "non_dwelling")) {
              setAside.push({ url: item.url, offer: observations.offer.kind, evidence: observations.offer.evidence });
              continue;
            }
            const previous = existing?.listings.find(result => result.url === item.url);
            const criterionResults = observations?.criterionResults ?? item.criterionResults.map(check =>
              check.source === "api" ? check : previous?.criterionResults.find(old => old.id === check.id) ?? check);
            if (criterionResults.some(check => ["price", "area", "rooms"].includes(check.id) && check.status === "contradicted" && check.source === "description")) continue;
            const additions = observations?.features ?? item.features;
            const features = [...(previous?.features ?? []), ...additions.filter(feature =>
              !(previous?.features ?? []).some(old => old.label.toLocaleLowerCase("fr") === feature.label.toLocaleLowerCase("fr")))];
            const position = await positionOf(item, observations?.address ?? null, previous);
            saved.push({
              source: item.source, batch: item.batch, title: item.title, url: item.url, description: item.description,
              price: observations?.price ?? item.price, area: observations?.area ?? item.area,
              rooms: observations?.rooms ?? item.rooms, location: observations?.location ?? item.location,
              image: item.image, images: item.images, score: observations?.score ?? item.score,
              aiSummary: observations?.aiSummary ?? null, summaryEvidence: observations?.summaryEvidence ?? [],
              features,
              criterionResults,
              ...position,
            });
          }
        }
        if (setAside.length) logger.info({ searchId: id, setAside }, "Listings set aside: not an entire dwelling");
        await completeSearch(id, saved, phase, RESULT_LIMIT);
      } catch (error) {
        // Pas d'échec définitif ici : le worker réessaie (l'analyse déjà payée est en cache) puis abandonne.
        throw error;
      }
    } else if (["FAILED", "TIMED-OUT", "TIMING-OUT", "ABORTED", "ABORTING"].includes(status)) {
      logger.error({ searchId: id, status, statusMessage: text(run.statusMessage) }, "Apify run did not succeed");
      await setFailure(id, FAILURE_MESSAGE, Boolean(row.analyzed));
    }
  } catch (error) {
    logger.error({ err: error, searchId: id }, "Unable to synchronize Apify run");
    // Échec transitoire (Apify, IA) : le worker compte les tentatives et réessaie ou abandonne.
    throw error;
  }
}