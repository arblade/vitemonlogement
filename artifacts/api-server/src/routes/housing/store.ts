import { createClient } from "@libsql/client/web";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isHousingListingUrl, type ActorRequest, type SearchBatch } from "./housing-search";

export type Criterion = {
  id: string;
  label: string;
  availability: "api" | "hybrid" | "description";
  apiField?: string | null;
};

export type CriterionResult = {
  id: string;
  label: string;
  status: "confirmed" | "contradicted" | "unknown";
  source: "api" | "description" | "unknown";
  value: string;
  evidence: string;
};

export type Criteria = {
  location: string;
  intent: "rent" | "buy";
  minPrice?: number | null;
  maxPrice?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  minRooms?: number | null;
  radius?: number;
  keywords: string;
  wishes?: string[];
  checks?: Criterion[];
};

export type Feature = {
  label: string;
  value: string;
  source: "annonce" | "ia";
  evidence: string;
};

export type Listing = {
  id: number;
  batch: SearchBatch;
  title: string;
  url: string;
  description: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
  location: string | null;
  image: string | null;
  images: string[];
  aiSummary: string | null;
  summaryEvidence: string[];
  score: number;
  features: Feature[];
  criterionResults: CriterionResult[];
};

type SearchRow = {
  id: number;
  prompt: string;
  criteria: string;
  status: "running" | "completed" | "failed";
  stage: "interpreting" | "searching" | "analyzing" | "ready" | "failed";
  phase: SearchBatch;
  focused_request: string | null;
  broad_request: string | null;
  focused_matches: number | null;
  run_id: string | null;
  error: string | null;
  analyzed: number;
  created_at: string;
};
type ListingRow = Omit<Listing, "features" | "images" | "summaryEvidence" | "aiSummary" | "criterionResults"> & {
  features: string; images: string; ai_summary: string | null; summary_evidence: string; criterion_results: string;
};
type Args = (string | number | null)[];
type Statement = { sql: string; args: Args };

const remoteUrl = process.env.TURSO_DATABASE_URL;
const remoteToken = process.env.TURSO_AUTH_TOKEN;
const useRemote = process.env.NODE_ENV === "production" || process.env.LOGISCOPE_USE_TURSO === "1";
if (process.env.NODE_ENV === "production" && (!remoteUrl || !remoteToken)) {
  throw new Error("La production nécessite TURSO_DATABASE_URL et TURSO_AUTH_TOKEN : un fichier SQLite local n'est pas persistant sur le déploiement.");
}
if (useRemote && Boolean(remoteUrl) !== Boolean(remoteToken)) {
  throw new Error("TURSO_DATABASE_URL et TURSO_AUTH_TOKEN doivent être configurés ensemble.");
}
if (useRemote && remoteUrl && !/^libsql:\/\/[a-z0-9.-]+\.turso\.io\/?$/i.test(remoteUrl)) {
  throw new Error("TURSO_DATABASE_URL doit être une URL valide de base Turso au format libsql://...turso.io.");
}
const filename = process.env.LOGISCOPE_SQLITE_PATH || path.resolve(process.cwd(), ".data/logiscope.sqlite");
if (!useRemote) mkdirSync(path.dirname(filename), { recursive: true });
const remote = useRemote && remoteUrl ? createClient({ url: remoteUrl, authToken: remoteToken }) : null;
const local = remote ? null : new DatabaseSync(filename);

async function query(sql: string, args: Args = []) {
  if (remote) return remote.execute({ sql, args });
  const statement = local!.prepare(sql);
  if (/^\s*(SELECT|PRAGMA)/i.test(sql)) {
    return { rows: statement.all(...args), rowsAffected: 0, lastInsertRowid: null };
  }
  const result = statement.run(...args);
  return { rows: [], rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid };
}

async function batch(statements: Statement[]) {
  if (remote) {
    await remote.batch(statements, "write");
    return;
  }
  local!.exec("BEGIN");
  try {
    for (const item of statements) await query(item.sql, item.args);
    local!.exec("COMMIT");
  } catch (error) {
    local!.exec("ROLLBACK");
    throw error;
  }
}

const ready = (async () => {
  await query(`CREATE TABLE IF NOT EXISTS housing_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    criteria TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'interpreting',
    phase TEXT NOT NULL DEFAULT 'focused',
    focused_request TEXT,
    broad_request TEXT,
    focused_matches INTEGER,
    run_id TEXT,
    error TEXT,
    analyzed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await query(`CREATE TABLE IF NOT EXISTS housing_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id INTEGER NOT NULL REFERENCES housing_searches(id),
    batch TEXT NOT NULL DEFAULT 'focused',
    title TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL,
    price REAL, area REAL, rooms INTEGER, location TEXT, image TEXT,
    score INTEGER NOT NULL, features TEXT NOT NULL,
    images TEXT NOT NULL DEFAULT '[]', ai_summary TEXT,
    summary_evidence TEXT NOT NULL DEFAULT '[]',
    criterion_results TEXT NOT NULL DEFAULT '[]',
    UNIQUE(search_id, url)
  )`);
  // Local databases created by the earlier prototype did not have a stage column.
  const columns = await query("PRAGMA table_info(housing_searches)");
  if (!columns.rows.some(row => (row as unknown as { name?: unknown }).name === "stage")) {
    await query("ALTER TABLE housing_searches ADD COLUMN stage TEXT NOT NULL DEFAULT 'ready'");
  }
  if (!columns.rows.some(row => (row as unknown as { name?: unknown }).name === "phase")) {
    await query("ALTER TABLE housing_searches ADD COLUMN phase TEXT NOT NULL DEFAULT 'focused'");
  }
  if (!columns.rows.some(row => (row as unknown as { name?: unknown }).name === "focused_request")) {
    await query("ALTER TABLE housing_searches ADD COLUMN focused_request TEXT");
  }
  if (!columns.rows.some(row => (row as unknown as { name?: unknown }).name === "broad_request")) {
    await query("ALTER TABLE housing_searches ADD COLUMN broad_request TEXT");
  }
  if (!columns.rows.some(row => (row as unknown as { name?: unknown }).name === "focused_matches")) {
    await query("ALTER TABLE housing_searches ADD COLUMN focused_matches INTEGER");
  }
  const listingColumns = await query("PRAGMA table_info(housing_listings)");
  const names = new Set(listingColumns.rows.map(row => String((row as unknown as { name: unknown }).name)));
  if (!names.has("images")) await query("ALTER TABLE housing_listings ADD COLUMN images TEXT NOT NULL DEFAULT '[]'");
  if (!names.has("ai_summary")) await query("ALTER TABLE housing_listings ADD COLUMN ai_summary TEXT");
  if (!names.has("summary_evidence")) await query("ALTER TABLE housing_listings ADD COLUMN summary_evidence TEXT NOT NULL DEFAULT '[]'");
  if (!names.has("criterion_results")) await query("ALTER TABLE housing_listings ADD COLUMN criterion_results TEXT NOT NULL DEFAULT '[]'");
  if (!names.has("batch")) await query("ALTER TABLE housing_listings ADD COLUMN batch TEXT NOT NULL DEFAULT 'focused'");
})();

async function execute(sql: string, args: (string | number | null)[] = []) {
  await ready;
  return query(sql, args);
}

export async function createSearch(prompt: string) {
  const placeholder: Criteria = { location: "", intent: "rent", keywords: "", radius: 5, wishes: [] };
  const result = await execute("INSERT INTO housing_searches (prompt, criteria, status, stage) VALUES (?, ?, 'running', 'interpreting')", [prompt, JSON.stringify(placeholder)]);
  return Number(result.lastInsertRowid);
}

export async function setCriteria(id: number, criteria: Criteria) {
  await execute("UPDATE housing_searches SET criteria = ?, stage = 'searching' WHERE id = ?", [JSON.stringify(criteria), id]);
}

export async function setRun(id: number, runId: string, request: ActorRequest) {
  const column = request.batch === "focused" ? "focused_request" : "broad_request";
  await execute(`UPDATE housing_searches SET run_id = ?, ${column} = ?, stage = 'searching' WHERE id = ?`,
    [runId, JSON.stringify(request), id]);
}

export async function setAnalyzing(id: number) {
  await execute("UPDATE housing_searches SET stage = 'analyzing' WHERE id = ?", [id]);
}

export async function setFailure(id: number, message: string, refresh = false) {
  await execute("UPDATE housing_searches SET status = ?, stage = ?, error = ? WHERE id = ?",
    [refresh ? "completed" : "failed", refresh ? "ready" : "failed", message.slice(0, 500), id]);
}

export async function beginRefresh(id: number) {
  const result = await execute(`UPDATE housing_searches
    SET status = 'running', stage = 'searching', phase = 'focused', run_id = NULL,
      focused_request = NULL, broad_request = NULL, focused_matches = NULL, error = NULL
    WHERE id = ? AND status = 'completed'`, [id]);
  return result.rowsAffected === 1;
}

export async function getSearchRow(id: number) {
  const result = await execute("SELECT * FROM housing_searches WHERE id = ?", [id]);
  return result.rows[0] as unknown as SearchRow | undefined;
}

async function summary(row: SearchRow) {
  const result = await execute("SELECT url FROM housing_listings WHERE search_id = ?", [row.id]);
  const searchRequests = [row.focused_request, row.broad_request]
    .filter((value): value is string => Boolean(value))
    .map(value => JSON.parse(value) as ActorRequest);
  return {
    id: Number(row.id),
    prompt: row.prompt,
    criteria: JSON.parse(row.criteria) as Criteria,
    status: row.status,
    stage: row.stage,
    phase: row.phase,
    searchRequests,
    focusedMatches: row.focused_matches,
    count: (result.rows as unknown as { url: string }[]).filter(listing => isHousingListingUrl(listing.url)).length,
    createdAt: row.created_at,
    analyzed: Boolean(row.analyzed),
    error: row.error,
  };
}

export async function listSearches() {
  const result = await execute("SELECT * FROM housing_searches ORDER BY id DESC LIMIT 30");
  return Promise.all((result.rows as unknown as SearchRow[]).map(summary));
}

export async function getSearch(id: number) {
  const row = await getSearchRow(id);
  if (!row) return null;
  const result = await execute(`SELECT id, batch, title, url, description, price, area, rooms, location, image, score, features
    , images, ai_summary, summary_evidence, criterion_results
    FROM housing_listings WHERE search_id = ? ORDER BY CASE batch WHEN 'focused' THEN 0 ELSE 1 END, score DESC, id ASC`, [id]);
  const listings = (result.rows as unknown as ListingRow[])
    .filter(listing => isHousingListingUrl(listing.url))
    .map(({ ai_summary, summary_evidence, criterion_results, ...listing }) => ({
      ...listing,
      images: JSON.parse(listing.images) as string[],
      aiSummary: ai_summary,
      summaryEvidence: JSON.parse(summary_evidence) as string[],
      criterionResults: JSON.parse(criterion_results) as CriterionResult[],
      features: JSON.parse(listing.features) as Feature[],
    }));
  return { ...await summary(row), listings };
}

export async function completeSearch(id: number, listings: Omit<Listing, "id">[], batchName: SearchBatch, continueBroad = false, maxResults = 5) {
  await ready;
  const statements: Statement[] = listings.slice(0, maxResults).map(item => ({
    sql: `INSERT INTO housing_listings
      (search_id, batch, title, url, description, price, area, rooms, location, image, score, features, images, ai_summary, summary_evidence, criterion_results)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(search_id, url) DO UPDATE SET
       batch = CASE WHEN excluded.batch = 'focused' THEN 'focused' ELSE housing_listings.batch END,
      image = COALESCE(housing_listings.image, excluded.image),
      features = excluded.features,
      images = CASE WHEN housing_listings.images = '[]' THEN excluded.images ELSE housing_listings.images END,
      ai_summary = COALESCE(housing_listings.ai_summary, excluded.ai_summary),
      summary_evidence = CASE WHEN housing_listings.summary_evidence = '[]' THEN excluded.summary_evidence ELSE housing_listings.summary_evidence END,
      criterion_results = excluded.criterion_results`,
    args: [id, batchName, item.title, item.url, item.description, item.price, item.area, item.rooms,
      item.location, item.image, item.score, JSON.stringify(item.features), JSON.stringify(item.images),
      item.aiSummary, JSON.stringify(item.summaryEvidence), JSON.stringify(item.criterionResults)],
  }));
  statements.push({ sql: `UPDATE housing_searches SET status = ?, stage = ?, phase = ?, run_id = NULL,
      focused_matches = COALESCE(?, focused_matches), analyzed = 1, error = NULL WHERE id = ?`,
    args: [continueBroad ? "running" : "completed", continueBroad ? "searching" : "ready",
      continueBroad ? "broad" : batchName, batchName === "focused" ? listings.length : null, id] });
  await batch(statements);
}

export async function saveAnalysis(id: number, enriched: { id: number; features: Feature[]; aiSummary: string | null; summaryEvidence: string[]; criterionResults: CriterionResult[]; score: number; price: number | null; area: number | null; rooms: number | null; location: string | null }[]) {
  await ready;
  const statements: Statement[] = enriched.map(item => ({
    sql: "UPDATE housing_listings SET features = ?, ai_summary = ?, summary_evidence = ?, criterion_results = ?, score = ?, price = COALESCE(price, ?), area = COALESCE(area, ?), rooms = COALESCE(rooms, ?), location = COALESCE(location, ?) WHERE id = ? AND search_id = ?",
    args: [JSON.stringify(item.features), item.aiSummary, JSON.stringify(item.summaryEvidence), JSON.stringify(item.criterionResults), item.score,
      item.price, item.area, item.rooms, item.location, item.id, id],
  }));
  statements.push({ sql: "UPDATE housing_searches SET analyzed = 1 WHERE id = ?", args: [id] });
  await batch(statements);
}