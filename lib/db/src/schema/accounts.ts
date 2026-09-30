import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgTable, primaryKey, serial, text } from "drizzle-orm/pg-core";

// Comptes : e-mail en minuscules (unique) et mot de passe haché (scrypt, voir api-server/src/lib/passwords.ts).
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`),
});

// Favoris par utilisateur : une annonce (clé = origine + chemin de l'URL) par compte, avec de quoi l'afficher sans rechargement.
export const favorites = pgTable("favorites", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  listingKey: text("listing_key").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  image: text("image"),
  price: doublePrecision("price"),
  area: doublePrecision("area"),
  rooms: integer("rooms"),
  location: text("location"),
  score: integer("score").notNull().default(0),
  searchId: integer("search_id"),
  savedAt: text("saved_at").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.listingKey] })]);
