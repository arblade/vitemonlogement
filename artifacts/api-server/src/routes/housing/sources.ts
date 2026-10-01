import { eq } from "drizzle-orm";
import { selogerLocations } from "@workspace/db";
import { db } from "../../lib/database";
import { intEnv } from "../../lib/env";
import { logger } from "../../lib/logger";
import { resolvePlace, type Commune } from "../../lib/places";
import { apify, apifyText } from "./apify-client";
import { checksFor, evaluateStructured } from "./criteria";
import type { ActorRequest, SearchBatch } from "./housing-search";
import { getImages, number, object, text } from "./parse";
import { isSeekerAd } from "./offer";
import type { Criteria, Feature, GeoPrecision, Listing } from "./store";

/**
 * Sources secondaires, lancées en parallèle de Le Bon Coin. Location uniquement, à deux niveaux :
 * la requête ne demande que des locations, puis chaque annonce lue est vérifiée (champ de transaction et URL).
 */
export type ListingSource = "leboncoin" | "pap" | "seloger";
export type ExtraSource = Exclude<ListingSource, "leboncoin">;
/** Sources secondaires que le code sait interroger (toutes les valeurs possibles de ACTIVE_EXTRA_SOURCES). */
export const EXTRA_SOURCES: readonly ExtraSource[] = ["seloger", "pap"];
export type SourceRun = { source: ExtraSource; runId: string; request: ActorRequest };

export const SOURCE_LABELS: Record<ListingSource, string> = { leboncoin: "Le Bon Coin", pap: "PAP", seloger: "SeLoger" };

/**
 * EN DUR : seul Le Bon Coin est interrogé. SeLoger et PAP, branchés et testés, coûtent trop cher pour l'instant
 * (≈ 0,04 $ d'Apify en plus par recherche, et l'offre Apify gratuite plafonne à 5 $ par mois). Pour les réactiver :
 * mettre ["seloger", "pap"] (ou l'un des deux) ici, sans autre changement. Aucune variable d'environnement.
 */
export const ACTIVE_EXTRA_SOURCES: readonly ExtraSource[] = [];

let activeExtraSources = ACTIVE_EXTRA_SOURCES;
export const enabledExtraSources = (): readonly ExtraSource[] => activeExtraSources;
/** Réservé aux tests : active d'autres sources le temps d'un test ; sans argument, revient au réglage en dur. */
export function setExtraSourcesForTests(sources: readonly ExtraSource[] = ACTIVE_EXTRA_SOURCES) {
  activeExtraSources = sources;
}

const ACTORS: Record<ExtraSource, string> = { pap: "clearpath~pap-scraper", seloger: "silentflow~seloger-scraper-ppr" };
const RESOLVER_ACTOR = "abotapi~seloger-france-scraper";

function hostIs(url: URL, domain: string) {
  return url.hostname === domain || url.hostname === `www.${domain}`;
}

/** Annonce PAP ou SeLoger reconnue par son adresse ; SeLoger : seulement les chemins de location. */
export function extraSourceOf(value: string): ExtraSource | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (hostIs(url, "pap.fr") && url.pathname.startsWith("/annonces/")) return "pap";
    if (hostIs(url, "seloger.com") && /^\/(annonce\/location|annonces\/locations)\//i.test(url.pathname)) return "seloger";
    return null;
  } catch {
    return null;
  }
}

// --- Requêtes -------------------------------------------------------------------------------------------------

function papInput(criteria: Criteria, commune: Commune, limit: number) {
  const input: Record<string, unknown> = {
    product: "location",
    locations: [`${commune.name} (${commune.department})`],
    propertyTypes: ["appartement", "maison"],
    maxResults: limit,
  };
  const ranges: [string, number | null | undefined][] = [
    ["nbPiecesMin", criteria.minRooms], ["nbPiecesMax", criteria.maxRooms],
    ["priceMin", criteria.minPrice], ["priceMax", criteria.maxPrice],
    ["surfaceMin", criteria.minArea], ["surfaceMax", criteria.maxArea],
  ];
  for (const [key, value] of ranges) if (value != null) input[key] = Math.round(value);
  return input;
}

export function selogerSearchUrl(criteria: Criteria, code: string) {
  const params = new URLSearchParams({ distributionTypes: "Rent", estateTypes: "Apartment,House", locations: code });
  const ranges: [string, number | null | undefined][] = [
    ["numberOfRoomsMin", criteria.minRooms], ["numberOfRoomsMax", criteria.maxRooms],
    ["priceMin", criteria.minPrice], ["priceMax", criteria.maxPrice],
    ["spaceMin", criteria.minArea], ["spaceMax", criteria.maxArea],
  ];
  for (const [key, value] of ranges) if (value != null) params.set(key, String(Math.round(value)));
  return `https://www.seloger.com/classified-search?${params}`;
}

/** Requête d'une source pour la ville recherchée ; null si la ville n'est pas une commune reconnue sans ambiguïté. */
export async function sourceRequest(source: ExtraSource, criteria: Criteria, limit: number, chargeCap: string, timeout: number): Promise<ActorRequest | null> {
  const place = resolvePlace(criteria.location);
  if (place.status !== "resolved") return null;
  const path = `/v2/acts/${ACTORS[source]}/runs?maxItems=${limit}&maxTotalChargeUsd=${chargeCap}&timeout=${timeout}`;
  if (source === "pap") return { batch: "focused", source, path, input: JSON.stringify(papInput(criteria, place.commune, limit)) };
  const code = await selogerLocationCode(place.commune);
  if (!code) return null;
  return { batch: "focused", source, path, input: JSON.stringify({ startUrls: [selogerSearchUrl(criteria, code)], maxItems: limit, deepScrape: true }) };
}

/**
 * Annonces lues par source (chacune est payée). Sur 5 annonces montrées en alternance (Le Bon Coin, SeLoger, PAP,
 * Le Bon Coin, SeLoger), SeLoger en place 2 et PAP 1 ; le surplus remplace les annonces écartées (colocations…).
 */
export function sourceLimit(source: ExtraSource) {
  return source === "seloger" ? intEnv("SELOGER_CANDIDATE_LIMIT", 6) : intEnv("PAP_CANDIDATE_LIMIT", 4);
}

/** Démarre les sources secondaires ; une source indisponible est journalisée et ignorée, jamais bloquante. */
export async function startExtraSources(criteria: Criteria, chargeCap: string, timeout: number): Promise<SourceRun[]> {
  const started = await Promise.all(enabledExtraSources().map(async source => {
    try {
      const request = await sourceRequest(source, criteria, sourceLimit(source), chargeCap, timeout);
      if (!request) return null;
      const response = object(await apify(request.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: request.input }));
      const runId = text(object(response.data).id);
      return runId ? { source, runId, request } : null;
    } catch (error) {
      logger.warn({ err: error, source }, "Listing source could not start");
      return null;
    }
  }));
  return started.filter((run): run is SourceRun => run !== null);
}

// --- Code de lieu SeLoger --------------------------------------------------------------------------------------

/** Ligne du journal de l'acteur : « Location resolved: 'Lille' -> AD08FR23619 (Lille (59)) ». */
export function parseSelogerResolution(log: string, commune: Pick<Commune, "department">): { code: string; label: string } | null {
  const match = log.match(/Location resolved: '.*?' -> (AD08FR\d+) \((.+)\)\s*$/m);
  if (!match) return null;
  const [, code, label] = match;
  // Homonymes : le département annoncé doit être celui de la commune recherchée.
  return label.includes(`(${commune.department})`) ? { code, label } : null;
}

/**
 * Les URL SeLoger désignent une ville par un code interne, ni INSEE ni postal. Un run très court de l'acteur abotapi
 * le résout (≈ 0,09 $, une seule fois par commune) ; il est ensuite gardé en base pour toujours. null si introuvable.
 */
export async function selogerLocationCode(commune: Commune): Promise<string | null> {
  const [cached] = await db().select().from(selogerLocations).where(eq(selogerLocations.inseeCode, commune.code));
  if (cached) return cached.code;
  const input = {
    mode: "search", locations: [commune.name], distributionType: "Rent", estateTypes: ["Apartment"],
    maxItems: 1, maxPages: 1, getDetails: false, proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
  };
  // Démarrage facturé 0,09 $ par l'acteur : un plafond plus bas interrompt le run avant qu'il ait résolu la ville.
  const response = object(await apify(`/v2/acts/${RESOLVER_ACTOR}/runs?waitForFinish=60&maxItems=1&maxTotalChargeUsd=0.10&timeout=60`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }));
  const runId = text(object(response.data).id);
  if (!runId) return null;
  const resolved = parseSelogerResolution(await apifyText(`/v2/actor-runs/${encodeURIComponent(runId)}/log`), commune);
  if (!resolved) {
    logger.warn({ commune: commune.name, runId }, "SeLoger location code not found");
    return null;
  }
  await db().insert(selogerLocations).values({ inseeCode: commune.code, code: resolved.code, label: resolved.label, createdAt: Date.now() })
    .onConflictDoNothing();
  return resolved.code;
}

// --- Lecture des annonces --------------------------------------------------------------------------------------

type Normalized = Omit<Listing, "id" | "score" | "criterionResults">;

function jsonArray(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function coordinates(lat: unknown, lng: unknown) {
  const [a, b] = [Number(lat), Number(lng)];
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0) ? { lat: a, lng: b } : null;
}

const pieces = (rooms: number | null) => (rooms == null ? "" : ` ${rooms} pièce${rooms > 1 ? "s" : ""}`);
const squareMeters = (area: number | null) => (area == null ? "" : ` ${String(Math.round(area * 10) / 10).replace(".", ",")} m²`);

/** Caractéristiques connues seulement quand l'annonce les affirme : un « non » muet de l'API n'est pas une preuve. */
function positive(label: string, value: unknown): Feature[] {
  return value === true ? [{ label, value: "Oui", source: "annonce", evidence: `Indiqué dans l’annonce : « ${label} ».` }] : [];
}

/**
 * PAP : location seulement (`product` = « location » : ni vente, ni vacances, ni logement social redirigé), appartement
 * ou maison (les colocations sont typées « colocation »). Les téléphones renvoyés par l'acteur ne sont jamais repris.
 */
export function normalizePap(raw: unknown, batch: SearchBatch): { listing: Normalized; facts: Record<string, unknown> } | null {
  const data = object(raw);
  const url = text(data.detailUrl);
  if (extraSourceOf(url) !== "pap" || data.product !== "location") return null;
  if (!["appartement", "maison"].includes(text(data.propertyType).toLowerCase())) return null;
  const characteristics = text(data.characteristics);
  const area = number(characteristics.match(/(\d+(?:[.,]\d+)?)\s*m²/)?.[1]);
  const rooms = number(data.rooms);
  const label = text(data.propertyTypeLabel) || "Logement";
  const place = text(data.title);
  const location = place.replace(/\s*\([^)]*\)\s*$/, "").trim() || null;
  const images = getImages(jsonArray(data.photos));
  const position = coordinates(object(data.coordinates).lat, object(data.coordinates).lng);
  const energy = text(object(data.energyClass).lettre).toUpperCase();
  const ges = text(object(data.gesClass).lettre).toUpperCase();
  const features: Feature[] = [
    ...(energy ? [{ label: "Classe énergie", value: energy, source: "annonce" as const, evidence: "Indiqué dans l’annonce : « Classe énergie »." }] : []),
    ...(ges ? [{ label: "Émissions GES", value: ges, source: "annonce" as const, evidence: "Indiqué dans l’annonce : « GES »." }] : []),
  ];
  return {
    listing: {
      source: "pap", batch, url, title: `${label}${pieces(rooms)}${squareMeters(area)}`.slice(0, 250),
      description: text(data.description).slice(0, 10000), price: number(data.priceValue) ?? number(data.price), area,
      rooms: rooms == null ? null : Math.floor(rooms), location, image: images[0] ?? null, images,
      aiSummary: null, summaryEvidence: [], features,
      // PAP ne dit pas si le point est l'adresse exacte : affiché comme une zone.
      lat: position?.lat ?? null, lng: position?.lng ?? null, geoPrecision: position ? "district" : null,
      postcode: place.match(/\((\d{5})\)/)?.[1] ?? null,
    },
    facts: {},
  };
}

const SELOGER_DWELLINGS = new Set(["appartement", "maison", "studio", "apartment", "house", "loft", "duplex", "villa", "triplex"]);

/**
 * SeLoger : `transactionType` = « Rent » et URL de location ; ni colocation (titre « Colocation… »), ni parking.
 * Les chambres en résidence de coliving titrées « Studio » sont laissées à l'analyse IA (logement entier ou non).
 */
export function normalizeSeloger(raw: unknown, batch: SearchBatch): { listing: Normalized; facts: Record<string, unknown> } | null {
  const data = object(raw);
  const url = text(data.url);
  if (extraSourceOf(url) !== "seloger" || data.transactionType !== "Rent") return null;
  const title = text(data.title);
  if (/^\s*colocation/i.test(title)) return null;
  if (!SELOGER_DWELLINGS.has(text(data.propertyType).toLowerCase())) return null;
  const area = number(data.surface);
  const rooms = number(data.rooms);
  const images = getImages(jsonArray(data.images));
  const position = coordinates(data.lat, data.lng);
  // Point précis (13 à 15 décimales) ou centre de quartier (4 ou 5).
  const decimals = String(data.lat ?? "").split(".")[1]?.length ?? 0;
  const geoPrecision: GeoPrecision | null = position ? (decimals >= 8 ? "street" : "district") : null;
  const city = text(data.city);
  const district = text(data.district);
  const typeLabel = text(data.propertyType);
  const label = typeLabel ? typeLabel[0].toLocaleUpperCase("fr") + typeLabel.slice(1) : "Logement";
  return {
    listing: {
      source: "seloger", batch, url, title: `${label}${pieces(rooms)}${squareMeters(area)}`.slice(0, 250),
      description: text(data.description).replace(/^"|"$/g, "").replace(/\\r\\n|\\n/g, "\n").slice(0, 10000),
      price: number(data.price), area, rooms: rooms == null ? null : Math.floor(rooms),
      location: city ? (district ? `${city} (${district})` : city) : null, image: images[0] ?? null, images,
      aiSummary: null, summaryEvidence: [],
      features: [
        ...positive("Meublé", data.isFurnished), ...positive("Ascenseur", data.hasElevator),
        ...positive("Stationnement", data.hasParking === true || data.hasGarage === true),
        ...positive("Balcon", data.hasBalcony), ...positive("Terrasse", data.hasTerrace),
        ...positive("Jardin", data.hasGarden), ...positive("Cave", data.hasCellar),
      ],
      lat: position?.lat ?? null, lng: position?.lng ?? null, geoPrecision,
      postcode: text(data.zipcode).match(/^\d{5}$/)?.[0] ?? null,
    },
    // Même vocabulaire que les attributs Le Bon Coin, pour les critères « hybrides » (parking, meublé, ascenseur).
    facts: {
      ...(data.isFurnished === true ? { furnished: true } : {}),
      ...(data.hasElevator === true ? { elevator: true } : {}),
      ...(data.hasParking === true || data.hasGarage === true ? { nb_parkings: 1 } : {}),
    },
  };
}

/** Annonce d'une source secondaire → Listing, avec les critères vérifiables sans IA ; null si à écarter. */
export function normalizeExtra(source: ExtraSource, raw: unknown, criteria: Criteria, batch: SearchBatch, score: (item: Normalized) => number): Omit<Listing, "id"> | null {
  const read = source === "pap" ? normalizePap(raw, batch) : normalizeSeloger(raw, batch);
  if (!read || isSeekerAd({ title: read.listing.title, description: read.listing.description })) return null;
  const requested = new Set(checksFor(criteria).map(check => check.apiField));
  const fieldOf: Record<string, string> = { "Meublé": "furnished", "Ascenseur": "elevator", "Stationnement": "parking" };
  const listing = { ...read.listing, features: read.listing.features.filter(feature => !requested.has(fieldOf[feature.label] as never)) };
  return { ...listing, criterionResults: evaluateStructured(criteria, listing, read.facts), score: score(listing) };
}

/**
 * Une même annonce publiée sur deux sites : même loyer, surface à 1 m² près, et positions à moins de 300 m
 * (ou, sans position, même nombre de pièces). Jamais appliqué à deux annonces d'un même site : une résidence peut
 * proposer plusieurs studios identiques.
 */
type Comparable = Pick<Listing, "price" | "area" | "rooms" | "lat" | "lng">;
export function sameHome(a: Comparable, b: Comparable) {
  if (a.price == null || b.price == null || a.area == null || b.area == null) return false;
  if (Math.round(a.price) !== Math.round(b.price) || Math.abs(a.area - b.area) > 1) return false;
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return a.rooms != null && a.rooms === b.rooms;
  const dy = (a.lat - b.lat) * 111_000, dx = (a.lng - b.lng) * 111_000 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dx, dy) < 300;
}

/** Alterne les sources (une liste par site) et retire les doublons d'un site à l'autre. */
export function interleave<T extends Comparable>(lists: T[][]): T[] {
  const merged: { item: T; list: number }[] = [];
  for (let index = 0; lists.some(list => index < list.length); index++) {
    lists.forEach((list, position) => {
      const item = list[index];
      if (item && !merged.some(kept => kept.list !== position && sameHome(kept.item, item))) merged.push({ item, list: position });
    });
  }
  return merged.map(({ item }) => item);
}
