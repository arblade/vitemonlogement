import { completeSearch, getSearch, getSearchRow, setAnalyzing, setFailure, type Criteria, type Feature, type Listing } from "./store";
import { analyze } from "./ai";
import { logger } from "../../lib/logger";
import { apiValue, checksFor, evaluateStructured, matchesKnownBasics } from "./criteria";
import { actorRequest, focusedSearchTerm, isHousingListingUrl, shouldRunBroad, type SearchBatch } from "./housing-search";

// Limites par appel Apify, identiques en développement et en production (protège le budget Apify).
// Modifiables par variables d'environnement : APIFY_RESULT_LIMIT (annonces conservées, défaut 5),
// APIFY_CANDIDATE_LIMIT (annonces examinées, défaut 10 : l'acteur exige adLimit >= 10).
function intEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
export const RESULT_LIMIT = intEnv("APIFY_RESULT_LIMIT", 5);
const CANDIDATE_LIMIT = Math.max(10, intEnv("APIFY_CANDIDATE_LIMIT", 10), RESULT_LIMIT);

async function apify(path: string, init?: { method: string; headers: Record<string, string>; body: string }) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN n'est pas configuré.");
  const response = await fetch(`${process.env.APIFY_BASE_URL || "https://api.apify.com"}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Apify (${response.status}) : ${body.slice(0, 250)}`);
  }
  return response.json() as Promise<unknown>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function first(item: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key];
  }
  return null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function number(value: unknown): number | null {
  if (Array.isArray(value)) return number(value[0]);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (value && typeof value === "object") return number(first(object(value), ["value", "amount"]));
  return null;
}

function getImages(value: unknown): string[] {
  const image = object(value);
  // clearpath/leboncoin-api supplies images as an object containing urls_large
  // and urls, not as an array. Prefer full-size photos over thumbnails.
  const candidates = [
    image.urls_large, image.urls, image.urls_thumb, image.classifications,
    image.small_url, image.thumb_url, value,
  ];
  for (const source of candidates) {
    const values = Array.isArray(source) ? source : [source];
    const urls = values.map(item => typeof item === "string" ? item
      : text(first(object(item), ["url", "imageUrl", "large", "medium", "thumb_url"])))
      .filter(url => {
        try { return new URL(url).protocol === "https:"; } catch { return false; }
      });
    if (urls.length) return [...new Set(urls)].slice(0, 12);
  }
  return [];
}

function scoreListing(item: Pick<Listing, "price" | "area" | "rooms" | "title" | "description">, criteria: Criteria) {
  let score = 60;
  if (criteria.minPrice != null && item.price != null) score += item.price >= criteria.minPrice ? 8 : -18;
  if (criteria.maxPrice != null && item.price != null) score += item.price <= criteria.maxPrice ? 12 : -24;
  if (criteria.minArea != null && item.area != null) score += item.area >= criteria.minArea ? 10 : -15;
  if (criteria.maxArea != null && item.area != null) score += item.area <= criteria.maxArea ? 8 : -15;
  if (criteria.minRooms != null && item.rooms != null) score += item.rooms >= criteria.minRooms ? 8 : -12;
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
      evidence: `Champ structuré « ${key} » fourni par l’API de l’annonce.` });
  }
  return features;
}

export function normalize(raw: unknown, criteria: Criteria, batch: SearchBatch = "focused"): Omit<Listing, "id"> | null {
  const source = object(raw);
  const data = Object.keys(object(source.ad)).length ? object(source.ad) : source;
  const url = text(first(data, ["url", "link", "adUrl", "ad_url", "listingUrl"]));
  if (!isHousingListingUrl(url)) return null;
  const title = text(first(data, ["title", "subject", "name"])).slice(0, 250);
  if (!title) return null;
  const description = text(first(data, ["description", "body", "text", "content"])).slice(0, 10000);
  const attrs = object(first(data, ["attributes", "details", "criteria"]));
  const price = number(first(data, ["price_euros", "price", "price_value", "priceValue"]));
  const area = number(first(data, ["square", "surface", "area", "livingArea", "squareMeters"])) ?? number(first(attrs, ["surface", "area", "livingArea"]));
  const rooms = number(first(data, ["rooms", "nbRooms", "roomCount", "pieces"])) ?? number(first(attrs, ["rooms", "nbRooms", "pieces"]));
  const locationData = first(data, ["location", "city", "localisation", "city_name"]);
  const location = text(typeof locationData === "object" ? first(object(locationData), ["city", "name", "label"]) : locationData) || null;
  const images = getImages(first(data, ["images", "pictures", "photos", "image", "imageUrl"]));
  const image = images[0] ?? null;
  const features = otherApiFeatures(data, criteria);
  const listing = { batch, title, url, description, price, area, rooms: rooms === null ? null : Math.floor(rooms), location, image, images, aiSummary: null, summaryEvidence: [], features };
  const criterionResults = evaluateStructured(criteria, listing, data);
  return { ...listing, criterionResults, score: scoreListing(listing, criteria) };
}

export async function startSearch(criteria: Criteria, batch: SearchBatch = "focused") {
  // The actor requires adLimit >= 10: inspect CANDIDATE_LIMIT (10) candidates, retain RESULT_LIMIT (5).
  const chargeCap = process.env.APIFY_MAX_CHARGE_USD || "0.10";
  const timeout = intEnv("APIFY_TIMEOUT_SECONDS", 120);
  const request = actorRequest(criteria, batch, CANDIDATE_LIMIT, chargeCap, timeout);
  const response = object(await apify(request.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: request.input,
  }));
  const runId = text(object(response.data).id);
  if (!runId) throw new Error("Apify n'a pas retourné d'identifiant d'exécution.");
  return { runId, request };
}

/** Contrôle une fois le run Apify d'une recherche ; à appeler sous bail (voir worker.ts). */
export async function syncSearch(id: number, criteria: Criteria) {
  const row = await getSearchRow(id);
  if (!row || row.status !== "running" || !row.runId) return;
  const phase: SearchBatch = row.phase === "broad" ? "broad" : "focused";
  try {
    const result = object(await apify(`/v2/actor-runs/${encodeURIComponent(row.runId)}`));
    const run = object(result.data);
    const status = text(run.status);
    if (status === "SUCCEEDED") {
      const datasetId = text(run.defaultDatasetId);
      if (!datasetId) throw new Error("L'exécution Apify n'a pas de jeu de résultats.");
      const items = await apify(`/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true&limit=${CANDIDATE_LIMIT}`);
      if (!Array.isArray(items)) throw new Error("Le format des résultats Apify est inattendu.");
      const existing = await getSearch(id);
      const oldUrls = new Set(existing?.listings.map(item => item.url) ?? []);
      const seen = new Set<string>();
      const listings = items.map(item => normalize(item, criteria, phase)).filter((item): item is Omit<Listing, "id"> => {
        if (!item || seen.has(item.url) || !matchesKnownBasics(item, criteria)) return false;
        seen.add(item.url);
        return true;
      });
      let runBroad = false;
      await setAnalyzing(id);
      try {
        // Prefer new ads to ones already saved during a refresh or the focused
        // pass; each pass keeps its own limit and the listing URLs are unique.
        const selected = [...listings].sort((a, b) => Number(oldUrls.has(a.url)) - Number(oldUrls.has(b.url))).slice(0, RESULT_LIMIT);
        const candidates = selected.filter(item =>
          !oldUrls.has(item.url) || !existing?.listings.find(previous => previous.url === item.url)?.criterionResults.length)
          .map((item, index) => ({ ...item, id: -(index + 1) }));
        const enriched: Awaited<ReturnType<typeof analyze>> = [];
        // The LLM receives at most five ads in each bounded request.
        for (let offset = 0; offset < candidates.length; offset += 15) {
          const groups = [0, 5, 10].map(start => candidates.slice(offset + start, offset + start + 5)).filter(group => group.length);
          const analyses = await Promise.all(groups.map(group => analyze(group, criteria)));
          enriched.push(...analyses.flat());
        }
        const saved = selected.map(item => {
          const enrichedItem = candidates.find(candidate => candidate.url === item.url);
          const observations = enriched.find(result => result.id === enrichedItem?.id);
          const previous = existing?.listings.find(result => result.url === item.url);
          const criterionResults = observations?.criterionResults ?? item.criterionResults.map(check =>
            check.source === "api" ? check : previous?.criterionResults.find(old => old.id === check.id) ?? check);
          const additions = observations?.features ?? item.features;
          const features = [...(previous?.features ?? []), ...additions.filter(feature =>
            !(previous?.features ?? []).some(old => old.label.toLocaleLowerCase("fr") === feature.label.toLocaleLowerCase("fr")))];
          return {
          batch: item.batch, title: item.title, url: item.url, description: item.description,
          price: observations?.price ?? item.price, area: observations?.area ?? item.area,
          rooms: observations?.rooms ?? item.rooms, location: observations?.location ?? item.location,
          image: item.image, images: item.images, score: observations?.score ?? item.score,
          aiSummary: observations?.aiSummary ?? null, summaryEvidence: observations?.summaryEvidence ?? [],
          features,
          criterionResults,
        }; }).filter(item => !item.criterionResults.some(check =>
          ["price", "area", "rooms"].includes(check.id) && check.status === "contradicted" && check.source === "description"));
        // Count only homes that survived all checks, including description-based
        // contradictions. A large raw dataset is not 40 usable matches.
        runBroad = phase === "focused" && shouldRunBroad(saved.length, Boolean(focusedSearchTerm(criteria)));
        await completeSearch(id, saved, phase, runBroad, RESULT_LIMIT);
        // Si la phase élargie est nécessaire, completeSearch a laissé la recherche « running » sans run :
        // le worker la reprend au prochain passage, même après un redémarrage du serveur.
      } catch (error) {
        // Pas d'échec définitif ici : le worker réessaie (l'analyse déjà payée est en cache) puis abandonne.
        throw error;
      }
    } else if (["FAILED", "TIMED-OUT", "TIMING-OUT", "ABORTED", "ABORTING"].includes(status)) {
      await setFailure(id, text(run.statusMessage) || `Exécution Apify : ${status}`, Boolean(row.analyzed) || phase === "broad");
    }
  } catch (error) {
    logger.error({ err: error, searchId: id }, "Unable to synchronize Apify run");
    // Échec transitoire (Apify, IA) : le worker compte les tentatives et réessaie ou abandonne.
    throw error;
  }
}