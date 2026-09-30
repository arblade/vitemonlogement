import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { favorites } from "@workspace/db";
import { db } from "../lib/database";

const router: IRouter = Router();
const MAX_FAVORITES = 500;
const MAX_IMPORT = 200;

/** Même clé que le front : origine + chemin de l'URL (sans « / » final), pour ne pas dupliquer une annonce. */
export function listingKey(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

type Favorite = {
  url: string; title: string; image: string | null; price: number | null; area: number | null;
  rooms: number | null; location: string | null; score: number; searchId: number | null; savedAt: string;
};

const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

/** Valide une annonce reçue du navigateur : jamais de confiance dans le corps de la requête. */
function parse(value: unknown): Favorite | null {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const url = text(item.url, 2000);
  const title = text(item.title, 300);
  if (!url || !title || !/^https?:\/\//i.test(url)) return null;
  const savedAt = typeof item.savedAt === "string" && !Number.isNaN(Date.parse(item.savedAt)) ? item.savedAt : new Date().toISOString();
  const rooms = number(item.rooms);
  const searchId = number(item.searchId);
  return {
    url, title, image: text(item.image, 2000), price: number(item.price), area: number(item.area),
    rooms: rooms === null ? null : Math.floor(rooms), location: text(item.location, 200),
    score: Math.round(number(item.score) ?? 0), searchId: searchId === null ? null : Math.floor(searchId), savedAt,
  };
}

const t = favorites;
async function save(userId: number, favorite: Favorite) {
  await db().insert(t).values({ userId, listingKey: listingKey(favorite.url), ...favorite })
    .onConflictDoNothing({ target: [t.userId, t.listingKey] });
}

router.get("/favorites", async (req, res) => {
  const rows = await db().select().from(t).where(eq(t.userId, req.userId!)).orderBy(desc(t.savedAt)).limit(MAX_FAVORITES);
  res.json(rows.map(({ userId: _userId, listingKey: _key, ...favorite }) => favorite));
});

router.put("/favorites", async (req, res): Promise<void> => {
  const favorite = parse(req.body);
  if (!favorite) { res.status(400).json({ error: "Annonce invalide." }); return; }
  const [{ count }] = await db().select({ count: sql<number>`count(*)::int` }).from(t).where(eq(t.userId, req.userId!));
  if (count >= MAX_FAVORITES) { res.status(409).json({ error: "Limite de favoris atteinte." }); return; }
  await save(req.userId!, favorite);
  res.status(200).json(favorite);
});

router.delete("/favorites", async (req, res): Promise<void> => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) { res.status(400).json({ error: "URL manquante." }); return; }
  await db().delete(t).where(and(eq(t.userId, req.userId!), eq(t.listingKey, listingKey(url))));
  res.status(204).end();
});

// Reprise des favoris qui n'étaient mémorisés que dans le navigateur (avant les comptes).
router.post("/favorites/import", async (req, res): Promise<void> => {
  const items = Array.isArray((req.body as { items?: unknown } | undefined)?.items) ? (req.body as { items: unknown[] }).items.slice(0, MAX_IMPORT) : [];
  let imported = 0;
  for (const value of items) {
    const favorite = parse(value);
    if (!favorite) continue;
    await save(req.userId!, favorite);
    imported++;
  }
  res.json({ imported });
});

export default router;
