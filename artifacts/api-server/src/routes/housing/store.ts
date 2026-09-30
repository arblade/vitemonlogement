import { and, asc, desc, eq, sql } from "drizzle-orm";
import { housingListings, housingSearches } from "@workspace/db";
import { db } from "../../lib/database";
import { routingAvailable } from "../../lib/travel";
import { isHousingListingUrl, type ActorRequest, type SearchBatch } from "./housing-search";

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
  mode: TravelMode;
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
};

export type SearchRow = typeof housingSearches.$inferSelect;

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

export async function setRun(id: number, runId: string, request: ActorRequest) {
  const column = request.batch === "focused" ? { focusedRequest: JSON.stringify(request) } : { broadRequest: JSON.stringify(request) };
  await db().update(housingSearches).set({ runId, ...column, stage: "searching", attempts: 0 }).where(eq(housingSearches.id, id));
}

export async function setAnalyzing(id: number) {
  await db().update(housingSearches).set({ stage: "analyzing" }).where(eq(housingSearches.id, id));
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

export async function beginRefresh(id: number) {
  const rows = await db().update(housingSearches)
    .set({ status: "running", stage: "searching", phase: "focused", runId: null, focusedRequest: null, broadRequest: null,
      focusedMatches: null, error: null, attempts: 0, nextCheckAt: 0 })
    .where(and(eq(housingSearches.id, id), eq(housingSearches.status, "completed")))
    .returning({ id: housingSearches.id });
  return rows.length === 1;
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

async function summary(row: SearchRow) {
  const urls = await db().select({ url: housingListings.url }).from(housingListings).where(eq(housingListings.searchId, row.id));
  const searchRequests = [row.focusedRequest, row.broadRequest]
    .filter((value): value is string => Boolean(value))
    .map(value => JSON.parse(value) as ActorRequest);
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
  };
}

export async function listSearches(ownerId: number) {
  const rows = await db().select().from(housingSearches).where(eq(housingSearches.ownerId, ownerId)).orderBy(desc(housingSearches.id)).limit(30);
  return Promise.all(rows.map(summary));
}

export async function getSearch(id: number) {
  const row = await getSearchRow(id);
  if (!row) return null;
  const t = housingListings;
  const rows = await db().select().from(t).where(eq(t.searchId, id))
    .orderBy(sql`CASE ${t.batch} WHEN 'focused' THEN 0 ELSE 1 END`, desc(t.score), asc(t.id));
  const listings: Listing[] = rows
    .filter(listing => isHousingListingUrl(listing.url))
    .map(listing => ({
      id: listing.id, batch: listing.batch as SearchBatch, title: listing.title, url: listing.url,
      description: listing.description, price: listing.price, area: listing.area, rooms: listing.rooms,
      location: listing.location, image: listing.image, score: listing.score,
      images: JSON.parse(listing.images) as string[],
      aiSummary: listing.aiSummary,
      summaryEvidence: JSON.parse(listing.summaryEvidence) as string[],
      criterionResults: JSON.parse(listing.criterionResults) as CriterionResult[],
      features: JSON.parse(listing.features) as Feature[],
      lat: listing.lat, lng: listing.lng, geoPrecision: listing.geoPrecision as GeoPrecision | null,
    }));
  return { ...await summary(row), listings, routingAvailable: routingAvailable() };
}

export async function completeSearch(id: number, listings: Omit<Listing, "id">[], batchName: SearchBatch, continueBroad = false, maxResults = 5) {
  const t = housingListings;
  await db().transaction(async tx => {
    for (const item of listings.slice(0, maxResults)) {
      const values = {
        searchId: id, batch: batchName, title: item.title, url: item.url, description: item.description,
        price: item.price, area: item.area, rooms: item.rooms == null ? null : Math.round(item.rooms),
        location: item.location, image: item.image, score: item.score, features: JSON.stringify(item.features),
        images: JSON.stringify(item.images), aiSummary: item.aiSummary,
        summaryEvidence: JSON.stringify(item.summaryEvidence), criterionResults: JSON.stringify(item.criterionResults),
        lat: item.lat ?? null, lng: item.lng ?? null, geoPrecision: item.geoPrecision ?? null,
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
        },
      });
    }
    await tx.update(housingSearches).set({
      status: continueBroad ? "running" : "completed",
      stage: continueBroad ? "searching" : "ready",
      phase: continueBroad ? "broad" : batchName,
      runId: null,
      focusedMatches: batchName === "focused" ? listings.length : sql`${housingSearches.focusedMatches}`,
      analyzed: 1, error: null, attempts: 0, nextCheckAt: 0,
    }).where(eq(housingSearches.id, id));
  });
}

export async function saveAnalysis(id: number, enriched: { id: number; features: Feature[]; aiSummary: string | null; summaryEvidence: string[]; criterionResults: CriterionResult[]; score: number; price: number | null; area: number | null; rooms: number | null; location: string | null }[]) {
  const t = housingListings;
  await db().transaction(async tx => {
    for (const item of enriched) {
      await tx.update(t).set({
        features: JSON.stringify(item.features), aiSummary: item.aiSummary,
        summaryEvidence: JSON.stringify(item.summaryEvidence), criterionResults: JSON.stringify(item.criterionResults),
        score: item.score,
        price: sql`COALESCE(${t.price}, ${item.price})`, area: sql`COALESCE(${t.area}, ${item.area})`,
        rooms: sql`COALESCE(${t.rooms}, ${item.rooms == null ? null : Math.round(item.rooms)})`,
        location: sql`COALESCE(${t.location}, ${item.location})`,
      }).where(and(eq(t.id, item.id), eq(t.searchId, id)));
    }
    await tx.update(housingSearches).set({ analyzed: 1 }).where(eq(housingSearches.id, id));
  });
}
