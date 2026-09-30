CREATE TABLE "travel_routes" (
	"key" text PRIMARY KEY NOT NULL,
	"duration_seconds" integer NOT NULL,
	"distance_meters" integer NOT NULL,
	"path" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "geo_precision" text;