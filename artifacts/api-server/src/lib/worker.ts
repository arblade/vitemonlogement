import { randomUUID } from "node:crypto";
import { lt } from "drizzle-orm";
import { usageCounters } from "@workspace/db";
import { advanceSearch } from "../routes/housing/pipeline";
import { logger } from "./logger";
import { db } from "./database";
import { claimNextSearch, nextClaimAt, releaseSearch } from "./queue";
import { nextWatchDueAt, scheduleDueWatches } from "../routes/housing/store";
import { intEnv } from "./env";
import { nextMailAt, processOutbox, purgeOutbox } from "./mail-outbox";

export type WorkerOptions = {
  intervalMs?: number;
  idleMs?: number;
  leaseMs?: number;
  concurrency?: number;
  owner?: string;
  advance?: (id: number) => Promise<number>;
};

/**
 * Boucle serveur qui fait avancer les recherches « running », indépendamment de tout onglet ouvert.
 * Le service Render tourne en continu (plan payant) : la boucle vit dans le même processus que l'API.
 * Elle ne sonde pas la base en continu : après chaque passage, elle dort jusqu'à la prochaine échéance connue
 * (recherche, relève, e-mail), au plus `idleMs`. Sinon la base Neon ne se met jamais en veille et l'offre
 * gratuite est épuisée en deux semaines (incident du 17/10/2026). Les routes réveillent le worker (wake).
 * Les verrous sont en base (bail) : une deuxième instance, ou un redémarrage, ne double jamais le travail,
 * et un bail expiré (processus mort) permet la reprise.
 */
export function createWorker(options: WorkerOptions = {}) {
  const owner = options.owner ?? `worker-${randomUUID()}`;
  const intervalMs = options.intervalMs ?? intEnv("WORKER_INTERVAL_MS", 3_000);
  const idleMs = options.idleMs ?? intEnv("WORKER_IDLE_MS", 30 * 60_000);
  const leaseMs = options.leaseMs ?? intEnv("WORKER_LEASE_MS", 5 * 60_000);
  const concurrency = options.concurrency ?? intEnv("WORKER_CONCURRENCY", 2);
  const advance = options.advance ?? advanceSearch;
  let timer: NodeJS.Timeout | null = null;
  let ticking: Promise<void> | null = null;
  let again = false;
  let stopped = true;
  let lastPurge = 0;

  async function work(id: number) {
    let next = 0;
    try {
      next = await advance(id);
    } catch (error) {
      logger.error({ err: error, searchId: id }, "Worker step crashed");
      next = 15_000;
    } finally {
      await releaseSearch(id, owner, Date.now() + next).catch(error => logger.error({ err: error, searchId: id }, "Unable to release lease"));
    }
  }

  async function tick() {
    await scheduleDueWatches().catch(error => logger.error({ err: error }, "Unable to schedule watched searches"));
    const running: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
      const id = await claimNextSearch(owner, leaseMs);
      if (id == null) break;
      running.push(work(id));
    }
    await Promise.all(running);
    // E-mails après les recherches : une relève qui vient de finir a déjà analysé ses annonces.
    await processOutbox().catch(error => logger.error({ err: error }, "Unable to process the mail outbox"));
    if (Date.now() - lastPurge > 3_600_000) {
      lastPurge = Date.now();
      await db().delete(usageCounters).where(lt(usageCounters.windowStart, Date.now() - 2 * 86_400_000))
        .catch(error => logger.error({ err: error }, "Unable to purge usage counters"));
      await purgeOutbox().catch(error => logger.error({ err: error }, "Unable to purge the mail outbox"));
    }
  }

  /** Attente avant le prochain passage : jusqu'à l'échéance la plus proche, entre intervalMs et idleMs. */
  async function nextDelay(now = Date.now()) {
    const dues = (await Promise.all([nextClaimAt(), nextWatchDueAt(), nextMailAt()])).filter((at): at is number => at != null);
    if (!dues.length) return idleMs;
    return Math.min(idleMs, Math.max(intervalMs, Math.min(...dues) - now));
  }

  const run = () => {
    if (stopped) return;
    if (ticking) { again = true; return; } // réveil pendant un passage : on repasse juste après
    if (timer) clearTimeout(timer);
    timer = null;
    ticking = (async () => {
      try {
        await tick();
        return await nextDelay();
      } catch (error) {
        logger.error({ err: error }, "Worker tick failed");
        return 60_000;
      }
    })().then(delay => {
      ticking = null;
      if (again) { again = false; run(); } else if (!stopped) timer = setTimeout(run, delay);
    });
  };

  return {
    owner,
    /** Un passage immédiat (utilisé par les tests et pour réveiller le worker après une création). */
    tick,
    nextDelay,
    start() {
      if (!stopped) return;
      stopped = false;
      run(); // reprend tout de suite les recherches laissées « running » avant un redémarrage
    },
    wake: run,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await ticking;
    },
  };
}

export type Worker = ReturnType<typeof createWorker>;
