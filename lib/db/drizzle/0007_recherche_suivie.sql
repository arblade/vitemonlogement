ALTER TABLE "housing_listings" ADD COLUMN "posted_at" bigint;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "postcode" text;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "refreshed_at" bigint;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "first_seen_at" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "analyzed" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "analysis_requested" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "housing_listings" ADD COLUMN "hidden" text;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "task" text;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "pass_state" text;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "cursor_at" bigint;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "pages_read" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "watched" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "watch_times" text;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "next_watch_at" bigint;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "watch_rate" double precision;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "last_visited_at" bigint;