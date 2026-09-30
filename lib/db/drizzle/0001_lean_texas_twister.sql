CREATE TABLE "favorites" (
	"user_id" integer NOT NULL,
	"listing_key" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"image" text,
	"price" double precision,
	"area" double precision,
	"rooms" integer,
	"location" text,
	"score" integer DEFAULT 0 NOT NULL,
	"search_id" integer,
	"saved_at" text NOT NULL,
	CONSTRAINT "favorites_user_id_listing_key_pk" PRIMARY KEY("user_id","listing_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD CONSTRAINT "housing_searches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "housing_searches_owner_idx" ON "housing_searches" USING btree ("owner_id");