import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { openDatabase } from "@workspace/db";

// Tables telles que l'ancien code (sans Drizzle) les créait sur Postgres : la migration doit les adopter sans rien perdre.
const LEGACY = [
  `CREATE TABLE housing_searches (
    id SERIAL PRIMARY KEY, prompt TEXT NOT NULL, criteria TEXT NOT NULL, status TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'interpreting', phase TEXT NOT NULL DEFAULT 'focused',
    focused_request TEXT, broad_request TEXT, focused_matches INTEGER, run_id TEXT, error TEXT,
    analyzed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )`,
  `CREATE TABLE housing_listings (
    id SERIAL PRIMARY KEY, search_id INTEGER NOT NULL REFERENCES housing_searches(id),
    batch TEXT NOT NULL DEFAULT 'focused', title TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL,
    price DOUBLE PRECISION, area DOUBLE PRECISION, rooms INTEGER, location TEXT, image TEXT,
    score INTEGER NOT NULL, features TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', ai_summary TEXT,
    summary_evidence TEXT NOT NULL DEFAULT '[]', criterion_results TEXT NOT NULL DEFAULT '[]',
    UNIQUE(search_id, url)
  )`,
];

test("la migration de base adopte une base existante et conserve ses données", async () => {
  const handle = await openDatabase({ dataDir: "memory://" });
  for (const statement of LEGACY) await handle.db.execute(sql.raw(statement));
  await handle.db.execute(sql`INSERT INTO housing_searches (prompt, criteria, status) VALUES ('ancienne recherche', '{}', 'completed')`);
  await handle.db.execute(sql`INSERT INTO housing_listings (search_id, title, url, description, score, features) VALUES (1, 't', 'https://www.leboncoin.fr/ad/locations/1', 'd', 70, '[]')`);

  await handle.migrate();

  const searches = await handle.db.execute(sql`SELECT prompt, lock_owner, lock_until, next_check_at, attempts FROM housing_searches`);
  assert.deepEqual((searches as unknown as { rows: unknown[] }).rows, [{ prompt: "ancienne recherche", lock_owner: null, lock_until: null, next_check_at: 0, attempts: 0 }]);
  const listings = await handle.db.execute(sql`SELECT count(*)::int AS n FROM housing_listings`);
  assert.equal((listings as unknown as { rows: { n: number }[] }).rows[0].n, 1);
  const tables = await handle.db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
  assert.ok((tables as unknown as { rows: { table_name: string }[] }).rows.some(row => row.table_name === "listing_analyses"));
  await handle.close();
});

test("la migration s'applique sur une base vide, et deux fois de suite sans erreur", async () => {
  const handle = await openDatabase({ dataDir: "memory://" });
  await handle.migrate();
  await handle.migrate();
  await handle.close();
});
