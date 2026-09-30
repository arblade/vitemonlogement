-- Migration de base, idempotente : les tables housing_* existent déjà en production (créées avant Drizzle).
-- Les colonnes de verrouillage et de suivi sont ajoutées après coup pour ces bases existantes.
CREATE TABLE IF NOT EXISTS "housing_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"criteria" text NOT NULL,
	"status" text NOT NULL,
	"stage" text DEFAULT 'interpreting' NOT NULL,
	"phase" text DEFAULT 'focused' NOT NULL,
	"focused_request" text,
	"broad_request" text,
	"focused_matches" integer,
	"run_id" text,
	"error" text,
	"analyzed" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') NOT NULL,
	"lock_owner" text,
	"lock_until" bigint,
	"next_check_at" bigint DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "housing_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL REFERENCES "housing_searches"("id"),
	"batch" text DEFAULT 'focused' NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"description" text NOT NULL,
	"price" double precision,
	"area" double precision,
	"rooms" integer,
	"location" text,
	"image" text,
	"score" integer NOT NULL,
	"features" text NOT NULL,
	"images" text DEFAULT '[]' NOT NULL,
	"ai_summary" text,
	"summary_evidence" text DEFAULT '[]' NOT NULL,
	"criterion_results" text DEFAULT '[]' NOT NULL,
	CONSTRAINT "housing_listings_search_id_url_unique" UNIQUE("search_id","url")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_analyses" (
	"url_key" text NOT NULL,
	"analysis_version" integer NOT NULL,
	"description_hash" text NOT NULL,
	"general" text,
	"verdicts" text DEFAULT '{}' NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "listing_analyses_url_key_analysis_version_pk" PRIMARY KEY("url_key","analysis_version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_counters" (
	"key" text NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "housing_searches_status_idx" ON "housing_searches" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN IF NOT EXISTS "lock_owner" text;
--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN IF NOT EXISTS "lock_until" bigint;
--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN IF NOT EXISTS "next_check_at" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
