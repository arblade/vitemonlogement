import { openDatabase } from "@workspace/db";
import { initDatabase } from "../lib/database";

/** Base PGlite jetable (en mémoire) avec toutes les migrations : un vrai Postgres, sans serveur ni secret. */
export async function useMemoryDatabase() {
  return initDatabase(await openDatabase({ dataDir: "memory://" }));
}
