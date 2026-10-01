import { and, asc, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { db } from "./database";

const t = housingSearches;
const free = (now: number) => or(isNull(t.lockUntil), lt(t.lockUntil, now));

/**
 * Réserve (bail) la prochaine recherche à traiter : « running » (première recherche) ou terminée avec une tâche
 * (passage suivi, page suivante, analyse demandée). La sélection utilise
 * FOR UPDATE SKIP LOCKED : deux instances ne peuvent pas obtenir la même recherche.
 * Un bail expiré (processus mort) devient réclamable.
 */
export async function claimNextSearch(owner: string, leaseMs: number, now = Date.now()): Promise<number | null> {
  return db().transaction(async tx => {
    const [row] = await tx.select({ id: t.id }).from(t)
      .where(and(or(eq(t.status, "running"), isNotNull(t.task)), lte(t.nextCheckAt, now), free(now)))
      .orderBy(asc(t.id)).limit(1).for("update", { skipLocked: true });
    if (!row) return null;
    await tx.update(t).set({ lockOwner: owner, lockUntil: now + leaseMs }).where(eq(t.id, row.id));
    return row.id;
  });
}

/** Réserve une recherche précise (ex. analyse manuelle) ; false si un autre processus la détient. */
export async function claimSearch(id: number, owner: string, leaseMs: number, now = Date.now()) {
  const rows = await db().update(t).set({ lockOwner: owner, lockUntil: now + leaseMs })
    .where(and(eq(t.id, id), free(now))).returning({ id: t.id });
  return rows.length === 1;
}

/** Libère le bail (si on en est propriétaire) et fixe le prochain contrôle. */
export async function releaseSearch(id: number, owner: string, nextCheckAt = 0) {
  await db().update(t).set({ lockOwner: null, lockUntil: null, nextCheckAt })
    .where(and(eq(t.id, id), eq(t.lockOwner, owner)));
}
