import { sql } from "drizzle-orm";
import { bigint, doublePrecision, index, integer, pgTable, primaryKey, serial, text } from "drizzle-orm/pg-core";

// Comptes : e-mail en minuscules (unique) et mot de passe haché (scrypt, voir api-server/src/lib/passwords.ts).
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`),
  // Désinscription des e-mails de la veille quotidienne (ms) ; NULL : les e-mails partent.
  mailOptOutAt: bigint("mail_opt_out_at", { mode: "number" }),
});

// File d'envoi des e-mails : écrite par le worker (relève, pause…), vidée par lui (lib/mail-outbox.ts). La clé rend
// chaque e-mail unique (« watch:12:1790… ») : une relève reprise après un échec n'envoie jamais deux fois.
export const mailOutbox = pgTable("mail_outbox", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  kind: text("kind").notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  searchId: integer("search_id"),
  // Paramètres propres au type d'e-mail (JSON), ex. l'heure de la relève.
  payload: text("payload").notNull().default("{}"),
  // pending → sent | skipped (pas de clé Resend, désinscrit, plus rien à dire) | failed (trop d'essais).
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: bigint("next_attempt_at", { mode: "number" }).notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  sentAt: bigint("sent_at", { mode: "number" }),
  providerId: text("provider_id"),
  error: text("error"),
}, table => [index("mail_outbox_pending_idx").on(table.status, table.nextAttemptAt)]);

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
