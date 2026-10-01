import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { listingAnalyses } from "@workspace/db";
import { db } from "./database";
import type { Feature } from "../routes/housing/store";

export type Verdict = { status: "confirmed" | "contradicted" | "unknown"; value: string; evidence: string };
/** Ce que l'annonce loue vraiment. room / non_dwelling ne sont retenus qu'avec une citation exacte. */
export type OfferKind = "entire" | "room" | "non_dwelling" | "unclear";
/** Voie du logement citée dans le texte (jamais celle de l'agence), avec la citation exacte qui la contient. */
export type ListingAddress = { street: string; number: string | null; evidence: string };
export type GeneralExtraction = { summary: string | null; summaryEvidence: string[]; features: Feature[]; offer?: { kind: OfferKind; evidence: string }; address?: ListingAddress | null };
export type CachedAnalysis = { general: GeneralExtraction | null; verdicts: Record<string, Verdict> };
export type CacheKey = { urlKey: string; descriptionHash: string };
export type CacheEntry = CacheKey & { general?: GeneralExtraction | null; verdicts?: Record<string, Verdict> };

export interface AnalysisCache {
  load(keys: CacheKey[], version: number): Promise<Map<string, CachedAnalysis>>;
  save(entries: CacheEntry[], version: number): Promise<void>;
}

/** Une même annonce a toujours la même clé, quelle que soit la recherche. */
export function urlKey(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/** Le texte analysé : s'il change (annonce modifiée), l'analyse mémorisée est ignorée. */
export function descriptionHash(title: string, description: string) {
  return createHash("sha256").update(`${title}\n${description}`).digest("hex").slice(0, 32);
}

/** Critère structuré : son id ; souhait libre : son libellé normalisé (les ids « wish-N » changent d'une recherche à l'autre). */
export function criterionKey(check: { id: string; label: string }) {
  if (["price", "area", "rooms", "location"].includes(check.id)) return check.id;
  return check.label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function parse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export const dbAnalysisCache: AnalysisCache = {
  async load(keys, version) {
    const result = new Map<string, CachedAnalysis>();
    if (!keys.length) return result;
    const t = listingAnalyses;
    const rows = await db().select().from(t)
      .where(and(eq(t.analysisVersion, version), inArray(t.urlKey, [...new Set(keys.map(key => key.urlKey))])));
    const hashes = new Map(keys.map(key => [key.urlKey, key.descriptionHash]));
    for (const row of rows) {
      if (hashes.get(row.urlKey) !== row.descriptionHash) continue; // annonce modifiée depuis l'analyse
      result.set(row.urlKey, { general: parse<GeneralExtraction | null>(row.general, null), verdicts: parse<Record<string, Verdict>>(row.verdicts, {}) });
    }
    return result;
  },

  async save(entries, version) {
    const t = listingAnalyses;
    for (const entry of entries) {
      const [existing] = await db().select().from(t).where(and(eq(t.urlKey, entry.urlKey), eq(t.analysisVersion, version)));
      const sameText = existing?.descriptionHash === entry.descriptionHash;
      const general = entry.general ?? (sameText ? parse<GeneralExtraction | null>(existing.general, null) : null);
      const verdicts = { ...(sameText ? parse<Record<string, Verdict>>(existing.verdicts, {}) : {}), ...(entry.verdicts ?? {}) };
      const values = {
        urlKey: entry.urlKey, analysisVersion: version, descriptionHash: entry.descriptionHash,
        general: general ? JSON.stringify(general) : null, verdicts: JSON.stringify(verdicts), updatedAt: Date.now(),
      };
      await db().insert(t).values(values).onConflictDoUpdate({
        target: [t.urlKey, t.analysisVersion],
        set: { descriptionHash: values.descriptionHash, general: values.general, verdicts: values.verdicts, updatedAt: values.updatedAt },
      });
    }
  },
};

/** Cache en mémoire, pour les tests unitaires. */
export function memoryAnalysisCache(): AnalysisCache & { rows: Map<string, CachedAnalysis & { hash: string }> } {
  const rows = new Map<string, CachedAnalysis & { hash: string }>();
  const id = (key: string, version: number) => `${version}|${key}`;
  return {
    rows,
    async load(keys, version) {
      const out = new Map<string, CachedAnalysis>();
      for (const key of keys) {
        const row = rows.get(id(key.urlKey, version));
        if (row && row.hash === key.descriptionHash) out.set(key.urlKey, { general: row.general, verdicts: row.verdicts });
      }
      return out;
    },
    async save(entries, version) {
      for (const entry of entries) {
        const previous = rows.get(id(entry.urlKey, version));
        const same = previous?.hash === entry.descriptionHash;
        rows.set(id(entry.urlKey, version), {
          hash: entry.descriptionHash,
          general: entry.general ?? (same ? previous!.general : null),
          verdicts: { ...(same ? previous!.verdicts : {}), ...(entry.verdicts ?? {}) },
        });
      }
    },
  };
}
