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

  const searches = await handle.db.execute(sql`SELECT prompt, lock_owner, lock_until, next_check_at::int AS next_check_at, attempts FROM housing_searches`);
  assert.deepEqual((searches as unknown as { rows: unknown[] }).rows, [{ prompt: "ancienne recherche", lock_owner: null, lock_until: null, next_check_at: 0, attempts: 0 }]);
  const listings = await handle.db.execute(sql`SELECT count(*)::int AS n FROM housing_listings`);
  assert.equal((listings as unknown as { rows: { n: number }[] }).rows[0].n, 1);
  // Veille quotidienne (0007) : les annonces existantes restent analysées, jamais « nouvelles » ; aucune veille quotidienne.
  const kept = await handle.db.execute(sql`SELECT analyzed, first_seen_at::int AS first_seen_at, hidden FROM housing_listings`);
  assert.deepEqual((kept as unknown as { rows: unknown[] }).rows, [{ analyzed: 1, first_seen_at: 0, hidden: null }]);
  const followed = await handle.db.execute(sql`SELECT watched, task, pages_read FROM housing_searches`);
  assert.deepEqual((followed as unknown as { rows: unknown[] }).rows, [{ watched: 0, task: null, pages_read: 0 }]);
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

test("la migration réécrit les anciennes preuves « fourni par l’API » en langage courant, sans toucher au reste", async () => {
  const handle = await openDatabase({ dataDir: "memory://" });
  for (const statement of LEGACY) await handle.db.execute(sql.raw(statement));
  await handle.db.execute(sql`INSERT INTO housing_searches (prompt, criteria, status) VALUES ('ancienne recherche', '{}', 'completed')`);
  const features = JSON.stringify([
    { label: "Parking", value: "1 place", source: "annonce", evidence: "Champ structuré « nb_parkings » fourni par l’API de l’annonce." },
    { label: "Balcon", value: "", source: "ia", evidence: "grand balcon plein sud" },
  ]);
  const results = JSON.stringify([{ id: "price", label: "Budget", status: "confirmed", source: "api", value: "600", evidence: "Champ structuré « price » fourni par l’API de l’annonce." }]);
  await handle.db.execute(sql`INSERT INTO housing_listings (search_id, title, url, description, score, features, criterion_results)
    VALUES (1, 't', 'https://www.leboncoin.fr/ad/locations/1', 'd', 70, ${features}, ${results})`);

  await handle.migrate();

  const rows = (await handle.db.execute(sql`SELECT features, criterion_results FROM housing_listings`) as unknown as { rows: { features: string; criterion_results: string }[] }).rows;
  const after = JSON.parse(rows[0].features) as { evidence: string }[];
  assert.equal(after[0].evidence, "Indiqué dans l’annonce : « nb_parkings ».");
  assert.equal(after[1].evidence, "grand balcon plein sud");
  assert.equal((JSON.parse(rows[0].criterion_results) as { evidence: string }[])[0].evidence, "Indiqué dans l’annonce : « price ».");
  assert.doesNotMatch(rows[0].features + rows[0].criterion_results, /API|structuré/);
  await handle.close();
});
