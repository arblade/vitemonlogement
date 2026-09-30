ALTER TABLE "travel_routes" ADD COLUMN "segments" text;--> statement-breakpoint
-- Les trajets déjà en cache ont un tracé simplifié (OVERVIEW) : ils seront recalculés en haute précision.
DELETE FROM "travel_routes";
