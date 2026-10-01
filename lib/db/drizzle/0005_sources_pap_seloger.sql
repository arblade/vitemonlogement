CREATE TABLE "seloger_locations" (
	"insee_code" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "source" text DEFAULT 'leboncoin' NOT NULL;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "source_runs" text;