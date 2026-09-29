import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type Criteria = {
  location: string;
  intent: "rent" | "buy";
  maxPrice?: number | null;
  minArea?: number | null;
  minRooms?: number | null;
  radius?: number;
  keywords: string;
  wishes?: string[];
};

export type Feature = {
  label: string;
  value: string;
  source: "annonce" | "ia";
  evidence: string;
};

export type Listing = {
  id: number;
  title: string;
  url: string;
  description: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
  location: string | null;
  image: string | null;
  score: number;
  features: Feature[];
};

type SearchRow = {
  id: number;
  prompt: string;
  criteria: string;
  status: "running" | "completed" | "failed";
  run_id: string | null;
  error: string | null;
  analyzed: number;
  created_at: string;
};
type ListingRow = Omit<Listing, "features"> & { features: string };

const filename = process.env.LOGISCOPE_SQLITE_PATH || path.resolve(process.cwd(), ".data/logiscope.sqlite");
mkdirSync(path.dirname(filename), { recursive: true });
const db = new DatabaseSync(filename);
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS housing_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    criteria TEXT NOT NULL,
    status TEXT NOT NULL,
    run_id TEXT,
    error TEXT,
    analyzed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id INTEGER NOT NULL REFERENCES housing_searches(id),
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL,
    area REAL,
    rooms INTEGER,
    location TEXT,
    image TEXT,
    score INTEGER NOT NULL,
    features TEXT NOT NULL,
    UNIQUE(search_id, url)
  );
  CREATE TABLE IF NOT EXISTS housing_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function reserveUsage(kind: "search" | "interpret", dailyLimit: number) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM housing_usage WHERE kind = ? AND date(created_at) = date('now')").get(kind) as { count: number };
  if (row.count >= dailyLimit) return false;
  db.prepare("INSERT INTO housing_usage (kind) VALUES (?)").run(kind);
  return true;
}

function summary(row: SearchRow) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM housing_listings WHERE search_id = ?").get(row.id) as { count: number };
  return {
    id: row.id,
    prompt: row.prompt,
    criteria: JSON.parse(row.criteria) as Criteria,
    status: row.status,
    count: count.count,
    createdAt: row.created_at,
    analyzed: Boolean(row.analyzed),
    error: row.error,
  };
}

export function createSearch(prompt: string, criteria: Criteria) {
  const result = db.prepare("INSERT INTO housing_searches (prompt, criteria, status) VALUES (?, ?, 'running')").run(prompt, JSON.stringify(criteria));
  return Number(result.lastInsertRowid);
}

export function setRun(id: number, runId: string) {
  db.prepare("UPDATE housing_searches SET run_id = ? WHERE id = ?").run(runId, id);
}

export function setFailure(id: number, message: string) {
  db.prepare("UPDATE housing_searches SET status = 'failed', error = ? WHERE id = ?").run(message.slice(0, 500), id);
}

export function getSearchRow(id: number) {
  return db.prepare("SELECT * FROM housing_searches WHERE id = ?").get(id) as SearchRow | undefined;
}

export function listSearches() {
  return (db.prepare("SELECT * FROM housing_searches ORDER BY id DESC LIMIT 30").all() as SearchRow[]).map(summary);
}

export function getSearch(id: number) {
  const row = getSearchRow(id);
  if (!row) return null;
  const listings = (db.prepare("SELECT id, title, url, description, price, area, rooms, location, image, score, features FROM housing_listings WHERE search_id = ? ORDER BY score DESC, id ASC").all(id) as ListingRow[])
    .map((listing) => ({ ...listing, features: JSON.parse(listing.features) as Feature[] }));
  return { ...summary(row), listings };
}

export function completeSearch(id: number, listings: Omit<Listing, "id">[]) {
  db.exec("BEGIN");
  try {
    const insert = db.prepare(`INSERT OR IGNORE INTO housing_listings
      (search_id, title, url, description, price, area, rooms, location, image, score, features)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of listings.slice(0, 10)) {
      insert.run(id, item.title, item.url, item.description, item.price, item.area, item.rooms, item.location, item.image, item.score, JSON.stringify(item.features));
    }
    db.prepare("UPDATE housing_searches SET status = 'completed' WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function saveAnalysis(id: number, enriched: { id: number; features: Feature[] }[]) {
  db.exec("BEGIN");
  try {
    const update = db.prepare("UPDATE housing_listings SET features = ? WHERE id = ? AND search_id = ?");
    for (const item of enriched) update.run(JSON.stringify(item.features), item.id, id);
    db.prepare("UPDATE housing_searches SET analyzed = 1 WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}