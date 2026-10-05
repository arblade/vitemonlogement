import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { housingListings, housingSearches } from "@workspace/db";
import { db } from "../../lib/database";
import { routingAvailable } from "../../lib/travel";
import { nearestStop } from "../../lib/stations";
import { accessKey, storedAccess, type Access } from "../../lib/access";
import { nextParisTime } from "../../lib/paris-time";
import { enqueueMail } from "../../lib/mail-outbox";
import { intEnv } from "../../lib/env";
import { isHousingListingUrl, type ActorRequest, type SearchBatch } from "./housing-search";
import type { ListingSource, SourceRun } from "./sources";

export type Criterion = {
  id: string;
  label: string;
  availability: "api" | "hybrid" | "description";
  apiField?: string | null;
};

export type CriterionResult = {
  id: string;
  label: string;
  status: "confirmed" | "contradicted" | "unknown";
  source: "api" | "description" | "unknown";
  value: string;
  evidence: string;
};

/** Lieu de vie cité dans la demande (travail, école…), géocodé si possible. */
export type Place = {
  id: string;
  label: string;
  kind: "work" | "school" | "other";
  address: string;
  /** Moyen de transport dit explicitement par l'utilisateur ; absent → l'app choisit (lib/travel.ts, commute). */
  mode?: TravelMode | null;
  lat?: number | null;
  lng?: number | null;
  /** Adresse telle que retrouvée par le géocodeur (affichée à l'utilisateur). */
  resolved?: string | null;
};

export type TravelMode = "transit" | "drive" | "bike" | "walk";

export type GeoPrecision = "streetNumber" | "street" | "district" | "city";

/** Seules l'adresse exacte et la rue sont placées sur la carte : un quartier ou une commune n'est pas une position. */
export const isPrecise = (listing: Pick<Listing, "lat" | "lng" | "geoPrecision">): listing is Listing & { lat: number; lng: number } =>
  listing.lat != null && listing.lng != null && (listing.geoPrecision === "streetNumber" || listing.geoPrecision === "street");

export type Criteria = {
  location: string;
  intent: "rent" | "buy";
  minPrice?: number | null;
  maxPrice?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  minRooms?: number | null;
  maxRooms?: number | null;
  radius?: number;
  keywords: string;
  wishes?: string[];
  checks?: Criterion[];
  places?: Place[];
};

export type Feature = {
  label: string;
  value: string;
  source: "annonce" | "ia";
  evidence: string;
};

export type Listing = {
  id: number;
  source: ListingSource;
  batch: SearchBatch;
  title: string;
  url: string;
  description: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
  location: string | null;
  image: string | null;
  images: string[];
  aiSummary: string | null;
  summaryEvidence: string[];
  score: number;
  features: Feature[];
  criterionResults: CriterionResult[];
  lat: number | null;
  lng: number | null;
  geoPrecision: GeoPrecision | null;
  /** « description » : position retrouvée dans le texte (adresse citée, géocodée) ; sinon donnée par l'annonce. */
  geoSource?: "description" | null;
  /** Phrase exacte de l'annonce qui cite l'adresse, quand geoSource vaut « description ». */
  geoEvidence?: string | null;
  /** Code postal donné par le site (sert au géocodage de l'adresse lue dans la description). */
  postcode?: string | null;
  /** Dates Le Bon Coin (ms UTC) : publication, dernière mise à jour (« remontée »). */
  postedAt?: number | null;
  refreshedAt?: number | null;
  /** Première lecture pour cette recherche (ms). */
  firstSeenAt?: number;
  /** false : pas encore analysée par l'IA (elle le sera quand elle sera affichée). */
  analyzed?: boolean;
};

export type SearchRow = typeof housingSearches.$inferSelect;

/**
 * « Disponible : à partir de 10/2026 », lu un temps dans le champ Le Bon Coin `available_date` (auto-rempli, souvent
 * faux) : retiré à la lecture pour les annonces déjà enregistrées. Une disponibilité lue dans le texte par l'IA, citation
 * à l'appui, n'est pas concernée.
 */
export const isStaleAvailability = (feature: Pick<Feature, "label" | "source" | "evidence">) =>
  feature.source === "annonce" && feature.label === "Disponible" && feature.evidence.includes("date de disponibilité");

/** `ownerId` : le compte propriétaire (NULL uniquement pour les recherches antérieures aux comptes et les tests). */
export async function createSearch(prompt: string, ownerId: number | null = null) {
  const placeholder: Criteria = { location: "", intent: "rent", keywords: "", radius: 5, wishes: [] };
  const [row] = await db().insert(housingSearches)
    .values({ prompt, criteria: JSON.stringify(placeholder), status: "running", stage: "interpreting", ownerId })
    .returning({ id: housingSearches.id });
  return row.id;
}

export async function setCriteria(id: number, criteria: Criteria) {
  await db().update(housingSearches).set({ criteria: JSON.stringify(criteria), stage: "searching" }).where(eq(housingSearches.id, id));
}

/** Message affiché à l'utilisateur quand une recherche échoue : jamais le détail technique (il reste dans les journaux du serveur). */
export const FAILURE_MESSAGE = "La recherche n’a pas pu aboutir. Réessayez dans un instant.";

export async function setFailure(id: number, message: string, refresh = false) {
  await db().update(housingSearches)
    .set({ status: refresh ? "completed" : "failed", stage: refresh ? "ready" : "failed", error: message.slice(0, 500), attempts: 0 })
    .where(eq(housingSearches.id, id));
}

/** Compte un échec d'étape ; renvoie le total d'échecs consécutifs. */
export async function recordAttemptFailure(id: number, message: string) {
  const [row] = await db().update(housingSearches)
    .set({ attempts: sql`${housingSearches.attempts} + 1`, error: message.slice(0, 500) })
    .where(eq(housingSearches.id, id))
    .returning({ attempts: housingSearches.attempts });
  return row?.attempts ?? 0;
}

export async function getSearchRow(id: number): Promise<SearchRow | undefined> {
  const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
  return row;
}

/** La recherche d'un autre compte est traitée comme inexistante (404), jamais comme interdite. */
export async function getOwnedSearchRow(id: number, ownerId: number) {
  const row = await getSearchRow(id);
  return row && row.ownerId === ownerId ? row : undefined;
}

/** Annonces de la veille quotidienne arrivées depuis la dernière ouverture (0 pour une recherche ponctuelle). */
async function unseenCount(row: SearchRow) {
  if (row.watched === 0) return 0;
  const t = housingListings;
  const [result] = await db().select({ n: sql<number>`count(*)::int` }).from(t)
    .where(and(eq(t.searchId, row.id), isNull(t.hidden), gt(t.firstSeenAt, row.lastVisitedAt ?? 0)));
  return Number(result?.n ?? 0);
}

const iso = (ms: number | null | undefined) => ms == null || ms <= 0 ? null : new Date(ms).toISOString();

/**
 * Lecture en cours (pages de 35 annonces) : la page lue et le nombre de pages au plus. Une seule page pour une recherche
 * ponctuelle ou « Étendre » ; jusqu'à READ_MAX_PAGES pour la création ou une relève de veille.
 */
function readProgress(row: SearchRow) {
  if (!row.passState) return null;
  const state = JSON.parse(row.passState) as { mode: string; pagesRead: number };
  const maxPages = state.mode === "backfill" || state.mode === "watch" ? intEnv("READ_MAX_PAGES", 3) : 1;
  return { page: Math.min(maxPages, state.pagesRead + 1), maxPages };
}

/** État de suivi exposé au navigateur : « active », « paused » (arrêtée faute de visite) ou null. */
const watchState = (row: SearchRow) => row.watched === 1 ? "active" as const : row.watched === 2 ? "paused" as const : null;

async function summary(row: SearchRow) {
  const urls = await db().select({ url: housingListings.url }).from(housingListings).where(and(eq(housingListings.searchId, row.id), isNull(housingListings.hidden)));
  const searchRequests = [row.focusedRequest, row.broadRequest]
    .filter((value): value is string => Boolean(value))
    .map(value => JSON.parse(value) as ActorRequest)
    .concat(row.sourceRuns ? (JSON.parse(row.sourceRuns) as SourceRun[]).map(run => run.request) : []);
  return {
    id: Number(row.id),
    prompt: row.prompt,
    criteria: JSON.parse(row.criteria) as Criteria,
    status: row.status as "running" | "completed" | "failed",
    stage: row.stage as "interpreting" | "searching" | "analyzing" | "ready" | "failed",
    phase: row.phase as SearchBatch,
    searchRequests,
    focusedMatches: row.focusedMatches,
    count: urls.filter(listing => isHousingListingUrl(listing.url)).length,
    createdAt: row.createdAt,
    analyzed: Boolean(row.analyzed),
    error: row.error,
    task: (row.task as "watch" | "backfill" | "extend" | "analyze" | null) ?? null,
    watch: watchState(row),
    watchTimes: row.watchTimes ? JSON.parse(row.watchTimes) as string[] : [],
    nextWatchAt: row.watched === 1 ? iso(row.nextWatchAt) : null,
    lastVisitedAt: iso(row.lastVisitedAt),
    lastWatchAt: iso(row.lastWatchAt),
    lastWatchStatus: (row.lastWatchStatus as "ok" | "partial" | "failed" | null) ?? null,
    readProgress: readProgress(row),
    unseenCount: await unseenCount(row),
  };
}

export async function listSearches(ownerId: number) {
  const rows = await db().select().from(housingSearches).where(eq(housingSearches.ownerId, ownerId))
    .orderBy(desc(sql`${housingSearches.watched} > 0`), desc(housingSearches.id)).limit(30);
  return Promise.all(rows.map(summary));
}

export async function getSearch(id: number) {
  const row = await getSearchRow(id);
  if (!row) return null;
  const t = housingListings;
  const rows = await db().select().from(t).where(and(eq(t.searchId, id), isNull(t.hidden)))
    // Les annonces du dernier passage d'abord, puis par date de publication : une annonce remontée ou republiée ne
    // repasse pas devant les nouvelles.
    .orderBy(desc(t.firstSeenAt), sql`COALESCE(${t.postedAt}, ${t.refreshedAt}) DESC NULLS LAST`, desc(t.score), asc(t.id));
  const listings: Listing[] = rows
    .filter(listing => isHousingListingUrl(listing.url))
    .map(listing => ({
      id: listing.id, source: listing.source as ListingSource, batch: listing.batch as SearchBatch, title: listing.title, url: listing.url,
      description: listing.description, price: listing.price, area: listing.area, rooms: listing.rooms,
      location: listing.location, image: listing.image, score: listing.score,
      images: JSON.parse(listing.images) as string[],
      aiSummary: listing.aiSummary,
      summaryEvidence: JSON.parse(listing.summaryEvidence) as string[],
      criterionResults: JSON.parse(listing.criterionResults) as CriterionResult[],
      features: (JSON.parse(listing.features) as Feature[]).filter(feature => !isStaleAvailability(feature)),
      lat: listing.lat, lng: listing.lng, geoPrecision: listing.geoPrecision as GeoPrecision | null,
      geoSource: listing.geoSource === "description" ? "description" as const : null, geoEvidence: listing.geoEvidence,
      postcode: listing.postcode, postedAt: listing.postedAt, refreshedAt: listing.refreshedAt, firstSeenAt: listing.firstSeenAt,
      analyzed: listing.analyzed === 1,
    }));
  return { ...await summary(row), listings, routingAvailable: routingAvailable() };
}

export async function completeSearch(id: number, listings: Omit<Listing, "id">[], batchName: SearchBatch, maxResults = 5) {
  const t = housingListings;
  await db().transaction(async tx => {
    for (const item of listings.slice(0, maxResults)) {
      const values = {
        searchId: id, source: item.source, batch: batchName, title: item.title, url: item.url, description: item.description,
        price: item.price, area: item.area, rooms: item.rooms == null ? null : Math.round(item.rooms),
        location: item.location, image: item.image, score: item.score, features: JSON.stringify(item.features),
        images: JSON.stringify(item.images), aiSummary: item.aiSummary,
        summaryEvidence: JSON.stringify(item.summaryEvidence), criterionResults: JSON.stringify(item.criterionResults),
        lat: item.lat ?? null, lng: item.lng ?? null, geoPrecision: item.geoPrecision ?? null,
        geoSource: item.geoSource ?? null, geoEvidence: item.geoEvidence ?? null,
      };
      await tx.insert(t).values(values).onConflictDoUpdate({
        target: [t.searchId, t.url],
        set: {
          batch: sql`CASE WHEN excluded.batch = 'focused' THEN 'focused' ELSE ${t.batch} END`,
          image: sql`COALESCE(${t.image}, excluded.image)`,
          features: sql`excluded.features`,
          images: sql`CASE WHEN ${t.images} = '[]' THEN excluded.images ELSE ${t.images} END`,
          aiSummary: sql`COALESCE(${t.aiSummary}, excluded.ai_summary)`,
          summaryEvidence: sql`CASE WHEN ${t.summaryEvidence} = '[]' THEN excluded.summary_evidence ELSE ${t.summaryEvidence} END`,
          criterionResults: sql`excluded.criterion_results`,
          lat: sql`COALESCE(excluded.lat, ${t.lat})`,
          lng: sql`COALESCE(excluded.lng, ${t.lng})`,
          geoPrecision: sql`COALESCE(excluded.geo_precision, ${t.geoPrecision})`,
          // L'origine suit la position retenue : celle de la nouvelle lecture si elle en a une, sinon l'ancienne.
          geoSource: sql`CASE WHEN excluded.lat IS NULL THEN ${t.geoSource} ELSE excluded.geo_source END`,
          geoEvidence: sql`CASE WHEN excluded.lat IS NULL THEN ${t.geoEvidence} ELSE excluded.geo_evidence END`,
        },
      });
    }
    await tx.update(housingSearches).set({
      status: "completed",
      stage: "ready",
      phase: batchName,
      runId: null,
      focusedMatches: batchName === "focused" ? listings.length : sql`${housingSearches.focusedMatches}`,
      analyzed: 1, error: null, attempts: 0, nextCheckAt: 0,
    }).where(eq(housingSearches.id, id));
  });
}

/** Recherche telle qu'exposée au navigateur (dates en ISO). */
export async function getPublicSearch(id: number) {
  const search = await getSearch(id);
  if (!search) return search;
  const access = await storedAccess(search.listings.filter(isPrecise));
  return { ...search, listings: search.listings.map(listing => publicListing(listing, access)) };
}

/**
 * Annonce telle qu'exposée au navigateur : dates en ISO, sans le code postal. Accès à pied seulement depuis une position
 * précise (depuis un quartier ou une commune, la marche annoncée serait fausse) : celui calculé et gardé en base (vraie
 * marche OpenRouteService, arrêt de bus compris), sinon la station la plus proche avec une marche estimée.
 */
export function publicListing(listing: Listing, access: Map<string, Access> = new Map()) {
  const { postcode: _postcode, postedAt, refreshedAt, firstSeenAt, analyzed, ...rest } = listing;
  const known = isPrecise(listing) ? access.get(accessKey(listing)) : undefined;
  const estimate = isPrecise(listing) ? nearestStop(listing) : null;
  return {
    ...rest, postedAt: iso(postedAt), refreshedAt: iso(refreshedAt), firstSeenAt: iso(firstSeenAt), analyzed: analyzed !== false,
    nearestStop: known ? known.metro : estimate && { ...estimate, estimated: true },
    nearestBusStop: known?.bus ?? null,
  };
}

const squeeze = (value: string) => value.toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Empreinte du contenu d'une annonce : titre, loyer, surface, pièces et début de la description. */
const contentKey = (item: Pick<Listing, "title" | "price" | "area" | "rooms" | "description">) =>
  [squeeze(item.title), item.price ?? "", item.area ?? "", item.rooms ?? "", squeeze(item.description).slice(0, 300)].join("|");

/**
 * Annonces lues lors d'un passage : les nouvelles sont enregistrées sans analyse (faite à l'affichage) ; celles déjà
 * connues gardent tout, seule leur date de mise à jour avance (annonce remontée). Renvoie les adresses nouvelles.
 */
export async function saveRead(id: number, listings: Omit<Listing, "id">[], now = Date.now()) {
  const t = housingListings;
  const existing = await db().select({ id: t.id, url: t.url, title: t.title, price: t.price, area: t.area, rooms: t.rooms, description: t.description })
    .from(t).where(eq(t.searchId, id));
  const known = new Set(existing.map(row => row.url));
  // Annonce supprimée puis republiée : nouvelle adresse, même contenu. Reconnue si l'ancienne adresse n'est plus dans la
  // lecture (deux studios identiques d'une même résidence, lus ensemble, restent deux annonces).
  const read = new Set(listings.map(item => item.url));
  const reposts = new Map(existing.filter(row => !read.has(row.url)).map(row => [contentKey(row), row]));
  const fresh: string[] = [];
  await db().transaction(async tx => {
    for (const item of listings) {
      const repost = known.has(item.url) ? undefined : reposts.get(contentKey(item));
      if (repost) {
        reposts.delete(contentKey(item));
        known.add(item.url);
        await tx.update(t).set({ url: item.url, refreshedAt: sql`GREATEST(COALESCE(${t.refreshedAt}, 0), ${item.refreshedAt ?? 0})` })
          .where(eq(t.id, repost.id));
        continue;
      }
      if (known.has(item.url)) {
        await tx.update(t).set({
          refreshedAt: sql`GREATEST(COALESCE(${t.refreshedAt}, 0), ${item.refreshedAt ?? 0})`,
          postedAt: sql`COALESCE(${t.postedAt}, ${item.postedAt ?? null})`,
        }).where(and(eq(t.searchId, id), eq(t.url, item.url)));
        continue;
      }
      known.add(item.url);
      fresh.push(item.url);
      await tx.insert(t).values({
        searchId: id, source: item.source, batch: item.batch, title: item.title, url: item.url, description: item.description,
        price: item.price, area: item.area, rooms: item.rooms == null ? null : Math.round(item.rooms),
        location: item.location, image: item.image, score: item.score, features: JSON.stringify(item.features),
        images: JSON.stringify(item.images), aiSummary: null, summaryEvidence: "[]", criterionResults: JSON.stringify(item.criterionResults),
        lat: item.lat ?? null, lng: item.lng ?? null, geoPrecision: item.geoPrecision ?? null,
        postcode: item.postcode ?? null, postedAt: item.postedAt ?? null, refreshedAt: item.refreshedAt ?? null,
        firstSeenAt: now, analyzed: 0,
      }).onConflictDoNothing();
    }
  });
  return fresh;
}

/** Annonces à analyser, dans l'ordre d'affichage par défaut (les plus récentes d'abord). */
export async function pendingAnalysis(id: number, options: { requestedOnly?: boolean; limit: number }) {
  const search = await getSearch(id);
  if (!search) return [];
  const t = housingListings;
  const requested = options.requestedOnly
    ? new Set((await db().select({ id: t.id }).from(t).where(and(eq(t.searchId, id), eq(t.analysisRequested, 1)))).map(row => row.id))
    : null;
  return search.listings.filter(item => item.analyzed === false && (!requested || requested.has(item.id))).slice(0, options.limit);
}

/** Le navigateur affiche ces annonces : leur analyse est demandée (seulement celles de la recherche, pas encore faites). */
export async function requestAnalysis(id: number, listingIds: number[]) {
  if (!listingIds.length) return 0;
  const t = housingListings;
  const rows = await db().update(t).set({ analysisRequested: 1 })
    .where(and(eq(t.searchId, id), inArray(t.id, listingIds.slice(0, 50)), eq(t.analyzed, 0), isNull(t.hidden)))
    .returning({ id: t.id });
  if (rows.length) {
    // Une tâche déjà en cours (passage, page suivante) enchaîne sur l'analyse à sa fin.
    await db().update(housingSearches).set({ task: "analyze", nextCheckAt: 0 })
      .where(and(eq(housingSearches.id, id), isNull(housingSearches.task), eq(housingSearches.status, "completed")));
  }
  return rows.length;
}

export type AnalyzedListing = Pick<Listing, "id" | "features" | "aiSummary" | "summaryEvidence" | "criterionResults" | "score" | "price" | "area" | "rooms" | "location" | "lat" | "lng" | "geoPrecision" | "geoSource" | "geoEvidence">;

/** Résultat de l'analyse d'une annonce : enrichie, ou masquée (chambre, local non habitable, prix contredit…). */
export type AnalysisOutcome = { kind: "kept"; listing: AnalyzedListing } | { kind: "hidden"; id: number; reason: string };

export async function saveAnalyzed(id: number, results: AnalysisOutcome[]) {
  const t = housingListings;
  await db().transaction(async tx => {
    for (const result of results) {
      if (result.kind === "hidden") {
        await tx.update(t).set({ hidden: result.reason, analyzed: 1, analysisRequested: 0 }).where(and(eq(t.id, result.id), eq(t.searchId, id)));
        continue;
      }
      const item = result.listing;
      const where = and(eq(t.id, item.id), eq(t.searchId, id));
      await tx.update(t).set({
        features: JSON.stringify(item.features), aiSummary: item.aiSummary, summaryEvidence: JSON.stringify(item.summaryEvidence),
        criterionResults: JSON.stringify(item.criterionResults), score: item.score,
        price: item.price, area: item.area, rooms: item.rooms == null ? null : Math.round(item.rooms), location: item.location,
        lat: item.lat, lng: item.lng, geoPrecision: item.geoPrecision, geoSource: item.geoSource ?? null, geoEvidence: item.geoEvidence ?? null,
        analyzed: 1, analysisRequested: 0,
      }).where(where);
    }
  });
}

/** Encore des annonces demandées par le navigateur et pas analysées ? */
export async function hasRequestedAnalysis(id: number) {
  const t = housingListings;
  const [row] = await db().select({ id: t.id }).from(t)
    .where(and(eq(t.searchId, id), eq(t.analysisRequested, 1), eq(t.analyzed, 0), isNull(t.hidden))).limit(1);
  return Boolean(row);
}

/** État de la lecture page par page (voir reader.ts), conservé entre deux passages du worker. */
export async function setPass(id: number, fields: Partial<Pick<SearchRow, "passState" | "runId" | "focusedRequest" | "sourceRuns" | "stage" | "cursorAt" | "pagesRead" | "watchRate" | "attempts">>) {
  await db().update(housingSearches).set(fields).where(eq(housingSearches.id, id));
}

/** Fin d'une lecture (première recherche ou tâche) : la recherche est prête, la tâche suivante éventuelle est l'analyse demandée. */
export async function finishPass(id: number, fields: Partial<Pick<SearchRow, "cursorAt" | "pagesRead" | "watchRate" | "watchRates" | "nextWatchAt" | "error" | "lastVisitedAt" | "lastWatchAt" | "lastWatchStatus" | "watchFailures">> = {}) {
  const next = await hasRequestedAnalysis(id) ? "analyze" : null;
  await db().update(housingSearches).set({
    status: "completed", stage: "ready", runId: null, passState: null, task: next, analyzed: 1, attempts: 0, nextCheckAt: 0, error: null, ...fields,
  }).where(eq(housingSearches.id, id));
}

/**
 * Tâche abandonnée (échec répété) : la recherche reste consultable telle quelle. `message` : affiché à l'utilisateur
 * (« Étendre »), null pour un passage automatique (rien à lui dire, le suivant réessaiera).
 */
export async function clearTask(id: number, message: string | null = null, now = Date.now()) {
  const row = await getSearchRow(id);
  const times = row?.watchTimes ? JSON.parse(row.watchTimes) as string[] : [];
  const failedWatch = row?.task === "watch";
  await db().update(housingSearches).set({
    task: null, runId: null, passState: null, attempts: 0, nextCheckAt: 0, error: message,
    // Un passage suivi qui échoue est reprogrammé au créneau suivant ; l'échec est dit sur la page de la veille.
    ...(failedWatch && row.watched === 1 ? { nextWatchAt: nextParisTime(times, now) } : {}),
    ...(failedWatch ? { lastWatchStatus: "failed", watchFailures: sql`${housingSearches.watchFailures} + 1` } : {}),
  }).where(eq(housingSearches.id, id));
  // Au 3e échec d'affilée, le propriétaire du site est prévenu (une fois par série).
  if (failedWatch && row.watchFailures + 1 === WATCH_FAILURE_ALERT) await enqueueMail("watch-failing", `watch-failing:${id}:${now}`, { searchId: id });
}

/** Relèves en échec d'affilée qui déclenchent l'alerte au propriétaire du site. */
export const WATCH_FAILURE_ALERT = 3;

/** « Étendre » : lire la page suivante (plus ancienne). false si une tâche est déjà en cours. */
export async function requestExtend(id: number) {
  const rows = await db().update(housingSearches).set({ task: "extend", passState: null, runId: null, nextCheckAt: 0, error: null, attempts: 0 })
    .where(and(eq(housingSearches.id, id), eq(housingSearches.status, "completed"), sql`(${housingSearches.task} IS NULL OR ${housingSearches.task} = 'analyze')`))
    .returning({ id: housingSearches.id });
  return rows.length === 1;
}

/** Veille quotidienne : une seule par compte ; l'activer arrête l'autre. Ce qui est déjà affiché compte comme vu. */
export async function startWatching(id: number, ownerId: number, times: string[], nextWatchAt: number, now = Date.now()) {
  await db().transaction(async tx => {
    await tx.update(housingSearches).set({ watched: 0, nextWatchAt: null })
      .where(and(eq(housingSearches.ownerId, ownerId), ne(housingSearches.id, id)));
    await tx.update(housingSearches).set({ watched: 1, watchTimes: JSON.stringify(times), nextWatchAt, lastVisitedAt: now })
      .where(and(eq(housingSearches.id, id), eq(housingSearches.ownerId, ownerId)));
  });
  // Une recherche ponctuelle n'a lu que les 15 plus récentes : la veille quotidienne commence par remonter 4 jours.
  // Recherche encore en cours (demande modifiée d'une veille) : la remontée suivra sa fin (voir reader.ts, finish).
  await requestBackfill(id);
}

/** Remontée de 4 jours d'une veille quotidienne qui n'a encore rien lu au-delà de la recherche ponctuelle. */
export async function requestBackfill(id: number) {
  await db().update(housingSearches).set({ task: "backfill", passState: null, runId: null, nextCheckAt: 0, attempts: 0 })
    .where(and(eq(housingSearches.id, id), eq(housingSearches.watched, 1), eq(housingSearches.pagesRead, 0), eq(housingSearches.status, "completed"),
      sql`(${housingSearches.task} IS NULL OR ${housingSearches.task} = 'analyze')`));
}

export async function stopWatching(id: number, ownerId: number) {
  await db().update(housingSearches).set({ watched: 0, nextWatchAt: null })
    .where(and(eq(housingSearches.id, id), eq(housingSearches.ownerId, ownerId)));
}

/** Le propriétaire ouvre la recherche : ses nouvelles annonces sont vues. */
export async function markVisited(id: number, ownerId: number, now = Date.now()) {
  await db().update(housingSearches).set({ lastVisitedAt: now })
    .where(and(eq(housingSearches.id, id), eq(housingSearches.ownerId, ownerId)));
}

/** Veille quotidienne du compte (la seule), pour les pastilles du site. */
export async function watchedSearch(ownerId: number) {
  const [row] = await db().select().from(housingSearches)
    .where(and(eq(housingSearches.ownerId, ownerId), sql`${housingSearches.watched} > 0`)).orderBy(desc(housingSearches.id)).limit(1);
  return row ? summary(row) : null;
}

/**
 * Étalement des relèves (secondes) : toutes les veilles de 8 h ne partent pas à la même seconde (Apify limite les runs
 * simultanés, le worker en traite 2 à la fois). Chaque veille garde son décalage, stable, entre 0 et cette valeur ;
 * l'heure affichée reste celle choisie (8 h). WATCH_SPREAD_SECONDS=0 : pas d'étalement.
 */
export function watchSpreadSeconds() {
  const value = Number.parseInt(process.env.WATCH_SPREAD_SECONDS ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : 300;
}
/** Décalage (ms) de la veille `id` : réparti sur toute la plage, le même à chaque relève. */
export const watchOffsetMs = (id: number, spread = watchSpreadSeconds()) => spread ? ((id * 37) % spread) * 1000 : 0;

/** Jours sans visite après lesquels une veille quotidienne se met en pause (elle ne coûte plus rien). */
export const watchIdleDays = () => Number.parseInt(process.env.WATCH_IDLE_DAYS ?? "", 10) || 7;

/**
 * Appelé à chaque tour du worker : les veilles quotidiennes dont l'heure est passée reçoivent leur tâche « watch » ; celles
 * que leur propriétaire n'a pas ouvertes depuis `watchIdleDays` jours passent en pause. Un passage manqué (serveur
 * arrêté à 8 h) est fait au redémarrage, une seule fois : la lecture part du curseur, rien n'est perdu.
 */
export async function scheduleDueWatches(now = Date.now()) {
  const t = housingSearches;
  const spread = watchSpreadSeconds();
  // Même calcul que watchOffsetMs, en SQL.
  const due = and(eq(t.watched, 1), spread
    ? sql`${t.nextWatchAt} + ((${t.id} * 37) % ${spread}) * 1000 <= ${now}`
    : sql`${t.nextWatchAt} <= ${now}`);
  const idle = now - watchIdleDays() * 86_400_000;
  const paused = await db().update(t).set({ watched: 2, nextWatchAt: null })
    .where(and(due, sql`COALESCE(${t.lastVisitedAt}, 0) < ${idle}`))
    .returning({ id: t.id, ownerId: t.ownerId });
  // L'utilisateur est prévenu par e-mail : sinon il croirait sa veille toujours active.
  for (const row of paused) {
    if (row.ownerId != null) await enqueueMail("watch-paused", `watch-paused:${row.id}:${now}`, { userId: row.ownerId, searchId: row.id });
  }
  await db().update(t).set({ task: "watch", passState: null, runId: null, nextCheckAt: 0, attempts: 0 })
    .where(and(due, isNull(t.task), eq(t.status, "completed")));
}
