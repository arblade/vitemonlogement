import { openDatabase, type Database, type DbHandle } from "@workspace/db";

let handle: DbHandle | null = null;

/** Ouvre la base (Postgres en production, PGlite en dev/test) et applique les migrations. */
export async function initDatabase(custom?: DbHandle): Promise<DbHandle> {
  handle = custom ?? await openDatabase();
  await handle.migrate();
  return handle;
}

export function db(): Database {
  if (!handle) throw new Error("La base de données n'est pas initialisée (initDatabase).");
  return handle.db;
}

export async function closeDatabase() {
  const current = handle;
  handle = null;
  await current?.close();
}
