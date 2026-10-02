CREATE TABLE "mail_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" integer,
	"search_id" integer,
	"payload" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"sent_at" bigint,
	"provider_id" text,
	"error" text,
	CONSTRAINT "mail_outbox_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "last_watch_status" text;--> statement-breakpoint
ALTER TABLE "housing_searches" ADD COLUMN "watch_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mail_opt_out_at" bigint;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_pending_idx" ON "mail_outbox" USING btree ("status","next_attempt_at");