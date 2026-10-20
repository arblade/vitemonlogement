ALTER TABLE "housing_listings" ADD COLUMN "seen_pass_at" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "missed_passes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "gone_at" bigint;