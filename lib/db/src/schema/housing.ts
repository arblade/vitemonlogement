import { sql } from "drizzle-orm";
import { bigint, doublePrecision, index, integer, pgTable, primaryKey, serial, text, unique } from "drizzle-orm/pg-core";
import { users } from "./accounts";

// Les colonnes JSON restent en TEXT : c'est le format des tables déjà présentes en production.
export const housingSearches = pgTable("housing_searches", {
  id: serial("id").primaryKey(),
  prompt: text("prompt").notNull(),
  criteria: text("criteria").notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull().default("interpreting"),
  phase: text("phase").notNull().default("focused"),
  focusedRequest: text("focused_request"),
  broadRequest: text("broad_request"),
  focusedMatches: integer("focused_matches"),
  runId: text("run_id"),
  // Runs des sources secondaires (PAP, SeLoger) lancés avec celui de Le Bon Coin : [{ source, runId, request }] en JSON.
  sourceRuns: text("source_runs"),
  error: text("error"),
  analyzed: integer("analyzed").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`),
  // Verrou de traitement (bail) : un seul processus travaille sur une recherche à la fois.
  lockOwner: text("lock_owner"),
  lockUntil: bigint("lock_until", { mode: "number" }),
  // Prochain contrôle du run Apify (ms epoch) : évite de l'interroger en boucle.
  nextCheckAt: bigint("next_check_at", { mode: "number" }).notNull().default(0),
  // Échecs consécutifs d'une étape : au-delà de MAX_STEP_ATTEMPTS la recherche passe en échec.
  attempts: integer("attempts").notNull().default(0),
  // Propriétaire : chaque recherche appartient à un compte (NULL = ancienne recherche, adoptée par le premier compte créé).
  ownerId: integer("owner_id").references(() => users.id),
}, table => [index("housing_searches_status_idx").on(table.status), index("housing_searches_owner_idx").on(table.ownerId)]);

export const housingListings = pgTable("housing_listings", {
  id: serial("id").primaryKey(),
  searchId: integer("search_id").notNull().references(() => housingSearches.id),
  batch: text("batch").notNull().default("focused"),
  // Site d'origine de l'annonce : leboncoin, pap ou seloger.
  source: text("source").notNull().default("leboncoin"),
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description").notNull(),
  price: doublePrecision("price"),
  area: doublePrecision("area"),
  rooms: integer("rooms"),
  location: text("location"),
  image: text("image"),
  score: integer("score").notNull(),
  features: text("features").notNull(),
  images: text("images").notNull().default("[]"),
  aiSummary: text("ai_summary"),
  summaryEvidence: text("summary_evidence").notNull().default("[]"),
  criterionResults: text("criterion_results").notNull().default("[]"),
  // Position donnée par l'annonce ; `geo_precision` : streetNumber (adresse exacte), street, district ou city (zone approximative).
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  geoPrecision: text("geo_precision"),
}, table => [unique("housing_listings_search_id_url_unique").on(table.searchId, table.url)]);

// Code de lieu SeLoger (ex. AD08FR23619 pour Lille), résolu une fois par commune (code INSEE) puis gardé.
export const selogerLocations = pgTable("seloger_locations", {
  inseeCode: text("insee_code").primaryKey(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Cache d'analyse LLM partagé entre toutes les recherches, par annonce et par version d'analyse.
export const listingAnalyses = pgTable("listing_analyses", {
  urlKey: text("url_key").notNull(),
  analysisVersion: integer("analysis_version").notNull(),
  descriptionHash: text("description_hash").notNull(),
  // { summary, summaryEvidence, features } ; null tant que l'extraction générale n'a pas eu lieu.
  general: text("general"),
  // { [clé de critère]: { status, value, evidence } } ; « unknown » est mémorisé aussi.
  verdicts: text("verdicts").notNull().default("{}"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, table => [primaryKey({ columns: [table.urlKey, table.analysisVersion] })]);

// Compteurs de fenêtres pour le rate limit et les quotas (persistés en base).
export const usageCounters = pgTable("usage_counters", {
  key: text("key").notNull(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull().default(0),
}, table => [primaryKey({ columns: [table.key, table.windowStart] })]);

// Trajets déjà calculés (Google Routes, payant) : clé = mode + origine + destination arrondies à ~1 m.
export const travelRoutes = pgTable("travel_routes", {
  key: text("key").primaryKey(),
  durationSeconds: integer("duration_seconds").notNull(),
  distanceMeters: integer("distance_meters").notNull(),
  // [[lat, lng], …] décodé depuis la polyline Google.
  path: text("path").notNull(),
  // Étapes (transports en commun : marche, puis chaque ligne), JSON ; null pour les autres modes.
  segments: text("segments"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
