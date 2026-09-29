import { ReplitConnectors } from "@replit/connectors-sdk";
import { completeSearch, getSearchRow, setFailure, type Criteria, type Feature, type Listing } from "./store";
import { logger } from "../../lib/logger";

const ACTOR = "clearpath~leboncoin-api";
const LIMIT = 10;
const connectors = new ReplitConnectors();
const polling = new Set<number>();

async function apify(path: string, init?: { method: string; headers: Record<string, string>; body: string }) {
  const response = await connectors.proxy("apify", path, init);
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
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (value && typeof value === "object") return number(first(object(value), ["value", "amount"]));
  return null;
}

function getImage(value: unknown): string | null {
  const img = Array.isArray(value) ? value[0] : value;
  const url = typeof img === "string" ? img : text(first(object(img), ["url", "imageUrl", "large", "medium"]));
  return /^https?:\/\//i.test(url) ? url : null;
}

function scoreListing(item: Omit<Listing, "id" | "score">, criteria: Criteria) {
  let score = 60;
  if (criteria.maxPrice != null && item.price != null) score += item.price <= criteria.maxPrice ? 12 : -24;
  if (criteria.minArea != null && item.area != null) score += item.area >= criteria.minArea ? 10 : -15;
  if (criteria.minRooms != null && item.rooms != null) score += item.rooms >= criteria.minRooms ? 8 : -12;
  const haystack = `${item.title} ${item.description}`.toLocaleLowerCase("fr");
  for (const wish of (criteria.wishes ?? []).slice(0, 4)) {
    if (wish.length > 2 && haystack.includes(wish.toLocaleLowerCase("fr"))) score += 3;
  }
  return Math.max(0, Math.min(100, score));
}

function normalize(raw: unknown, criteria: Criteria): Omit<Listing, "id"> | null {
  const source = object(raw);
  const data = Object.keys(object(source.ad)).length ? object(source.ad) : source;
  const url = text(first(data, ["url", "link", "adUrl", "ad_url", "listingUrl"]));
  try {
    const parsed = new URL(url);
    if (!/(^|\.)leboncoin\.fr$/i.test(parsed.hostname) || !/^https?:$/.test(parsed.protocol)) return null;
  } catch { return null; }
  const title = text(first(data, ["title", "subject", "name"])).slice(0, 250);
  if (!title) return null;
  const description = text(first(data, ["description", "body", "text", "content"])).slice(0, 10000);
  const attrs = object(first(data, ["attributes", "details", "criteria"]));
  const price = number(first(data, ["price", "price_value", "priceValue"]));
  const area = number(first(data, ["surface", "area", "livingArea", "squareMeters"])) ?? number(first(attrs, ["surface", "area", "livingArea"]));
  const rooms = number(first(data, ["rooms", "nbRooms", "roomCount", "pieces"])) ?? number(first(attrs, ["rooms", "nbRooms", "pieces"]));
  const locationData = first(data, ["location", "city", "localisation", "city_name"]);
  const location = text(typeof locationData === "object" ? first(object(locationData), ["city", "name", "label"]) : locationData) || null;
  const image = getImage(first(data, ["images", "pictures", "photos", "image", "imageUrl"]));
  const features: Feature[] = [];
  if (price !== null) features.push({ label: "Prix", value: `${price} €`, source: "annonce", evidence: "Champ prix fourni par l'annonce" });
  if (area !== null) features.push({ label: "Surface", value: `${area} m²`, source: "annonce", evidence: "Champ surface fourni par l'annonce" });
  if (rooms !== null) features.push({ label: "Pièces", value: String(rooms), source: "annonce", evidence: "Champ pièces fourni par l'annonce" });
  const listing = { title, url, description, price, area, rooms: rooms === null ? null : Math.floor(rooms), location, image, features };
  return { ...listing, score: scoreListing(listing, criteria) };
}

export async function startSearch(criteria: Criteria) {
  // The actor enforces a minimum adLimit of 10. Both the actor and Apify billing
  // options are capped; no phone/profile enrichment or monitoring is enabled.
  const searchQuery = [
    criteria.intent === "rent" ? "location" : "vente",
    "immobilier",
    criteria.keywords || "appartement",
  ].join(" ");
  const response = object(await apify(`/v2/actors/${ACTOR}/runs?maxItems=${LIMIT}&maxTotalChargeUsd=0.10&timeout=120`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      searchQuery,
      location: criteria.location,
      radius: Math.max(0, Math.min(200, criteria.radius ?? 5)),
      ...(criteria.maxPrice != null ? { price_max_filter: criteria.maxPrice } : {}),
      adLimit: LIMIT,
      mode: "standard",
      includeSeller: false,
      includePhone: false,
      shippable: false,
    }),
  }));
  const runId = text(object(response.data).id);
  if (!runId) throw new Error("Apify n'a pas retourné d'identifiant d'exécution.");
  return runId;
}

export async function syncSearch(id: number, criteria: Criteria) {
  const row = getSearchRow(id);
  if (!row || row.status !== "running" || !row.run_id || polling.has(id)) return;
  polling.add(id);
  try {
    const result = object(await apify(`/v2/actor-runs/${encodeURIComponent(row.run_id)}`));
    const run = object(result.data);
    const status = text(run.status);
    if (status === "SUCCEEDED") {
      const datasetId = text(run.defaultDatasetId);
      if (!datasetId) throw new Error("L'exécution Apify n'a pas de jeu de résultats.");
      const items = await apify(`/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true&limit=${LIMIT}`);
      if (!Array.isArray(items)) throw new Error("Le format des résultats Apify est inattendu.");
      const seen = new Set<string>();
      const listings = items.map(item => normalize(item, criteria)).filter((item): item is Omit<Listing, "id"> => {
        if (!item || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
      completeSearch(id, listings.slice(0, LIMIT));
    } else if (["FAILED", "TIMED-OUT", "TIMING-OUT", "ABORTED", "ABORTING"].includes(status)) {
      setFailure(id, text(run.statusMessage) || `Exécution Apify : ${status}`);
    }
  } catch (error) {
    logger.error({ err: error, searchId: id }, "Unable to synchronize Apify run");
    // Transient polling failures should not erase an ongoing run.
    throw error;
  } finally {
    polling.delete(id);
  }
}