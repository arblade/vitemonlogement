import path from "node:path";
import { existsSync } from "node:fs";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DbHandle = {
  db: Database;
  kind: "postgres" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
};

// Dossier des migrations générées par drizzle-kit. Résolu depuis la racine du dépôt
// (le service Render démarre à la racine) ; MIGRATIONS_DIR permet de le forcer.
export function migrationsFolder() {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), "lib/db/drizzle"),
    path.resolve(process.cwd(), "../../lib/db/drizzle"),
    path.resolve(process.cwd(), "../db/drizzle"),
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find(candidate => existsSync(path.join(candidate, "meta", "_journal.json")));
  if (!found) throw new Error(`Dossier de migrations introuvable (cherché : ${candidates.join(", ")}).`);
  return found;
}

/**
 * Postgres (DATABASE_URL) en production ; sinon PGlite, un vrai Postgres embarqué,
 * pour le développement et les tests : un seul schéma, un seul jeu de migrations.
 * `dataDir` vaut `memory://` pour des tests jetables.
 */
export async function openDatabase(options: { url?: string; dataDir?: string } = {}): Promise<DbHandle> {
  const url = options.url ?? process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({
      connectionString: url,
      // L'URL externe de Render exige TLS ; l'URL interne n'en a pas besoin. Neon fournit sslmode=require.
      ssl: /\.render\.com/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    const db = drizzlePg(pool, { schema }) as unknown as Database;
    return {
      db, kind: "postgres",
      migrate: () => migratePg(db as never, { migrationsFolder: migrationsFolder() }),
      close: () => pool.end(),
    };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL est obligatoire en production.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = options.dataDir ?? process.env.LOGISCOPE_PGLITE_DIR ?? path.resolve(process.cwd(), ".data/pglite");
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema }) as unknown as Database;
  return {
    db, kind: "pglite",
    migrate: () => migrate(db as never, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
}
