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
  // Travail en arrière-plan sur une recherche terminée : « watch » (passage de la recherche suivie), « extend » (page
  // suivante, plus ancienne), « analyze » (analyse IA demandée en faisant défiler). NULL : rien à faire.
  task: text("task"),
  // Lecture page par page en cours (JSON : mode, page, limite, borne d'arrêt…), voir routes/housing/reader.ts.
  passState: text("pass_state"),
  // Date (ms) de la mise à jour Le Bon Coin la plus récente déjà lue : le passage suivant s'arrête là.
  cursorAt: bigint("cursor_at", { mode: "number" }),
  // Page la plus ancienne déjà lue (« Étendre » lit la suivante).
  pagesRead: integer("pages_read").notNull().default(0),
  // Recherche suivie (une seule par compte) : heures de passage (JSON, heure de Paris), prochain passage (ms).
  watched: integer("watched").notNull().default(0),
  watchTimes: text("watch_times"),
  nextWatchAt: bigint("next_watch_at", { mode: "number" }),
  // Annonces lues par heure lors des derniers passages : règle la taille de la première page lue.
  watchRate: doublePrecision("watch_rate"),
  // Début de la dernière relève (passage suivi, ms) : ses annonces sont séparées des plus anciennes dans la liste.
  lastWatchAt: bigint("last_watch_at", { mode: "number" }),
  // Dernière ouverture de la recherche par son propriétaire (ms) : ce qui est arrivé après est « non vu ».
  lastVisitedAt: bigint("last_visited_at", { mode: "number" }),
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
  // « description » : position retrouvée dans le texte de l'annonce (adresse citée puis géocodée), absente du champ
  // de position ; `geo_evidence` est la phrase exacte qui la cite. NULL : position donnée par l'annonce elle-même.
  geoSource: text("geo_source"),
  geoEvidence: text("geo_evidence"),
  // Dates Le Bon Coin (ms, UTC) : publication et dernière mise à jour (une annonce « remontée » change la seconde).
  postedAt: bigint("posted_at", { mode: "number" }),
  // Code postal donné par le site : sert au géocodage de l'adresse lue dans la description, analyse faite plus tard.
  postcode: text("postcode"),
  refreshedAt: bigint("refreshed_at", { mode: "number" }),
  // Première lecture de l'annonce pour cette recherche (ms) : sert au compte des « nouvelles » de la recherche suivie.
  firstSeenAt: bigint("first_seen_at", { mode: "number" }).notNull().default(0),
  // Analyse IA faite (1) ou à faire quand l'annonce sera affichée (0) ; demandée par le navigateur (1).
  analyzed: integer("analyzed").notNull().default(1),
  analysisRequested: integer("analysis_requested").notNull().default(0),
  // Écartée après analyse (« room », « non_dwelling », « mismatch ») : gardée pour ne pas la relire, jamais affichée.
  hidden: text("hidden"),
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
