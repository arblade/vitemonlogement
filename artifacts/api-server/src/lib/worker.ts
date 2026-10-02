import { randomUUID } from "node:crypto";
import { lt } from "drizzle-orm";
import { usageCounters } from "@workspace/db";
import { advanceSearch } from "../routes/housing/pipeline";
import { logger } from "./logger";
import { db } from "./database";
import { claimNextSearch, releaseSearch } from "./queue";
import { scheduleDueWatches } from "../routes/housing/store";
import { intEnv } from "./env";
import { processOutbox, purgeOutbox } from "./mail-outbox";

export type WorkerOptions = {
  intervalMs?: number;
  leaseMs?: number;
  concurrency?: number;
  owner?: string;
  advance?: (id: number) => Promise<number>;
};

/**
 * Boucle serveur qui fait avancer les recherches « running », indépendamment de tout onglet ouvert.
 * Le service Render tourne en continu (plan payant) : la boucle vit dans le même processus que l'API.
 * Les verrous sont en base (bail) : une deuxième instance, ou un redémarrage, ne double jamais le travail,
 * et un bail expiré (processus mort) permet la reprise.
 */
export function createWorker(options: WorkerOptions = {}) {
  const owner = options.owner ?? `worker-${randomUUID()}`;
  const intervalMs = options.intervalMs ?? intEnv("WORKER_INTERVAL_MS", 3_000);
  const leaseMs = options.leaseMs ?? intEnv("WORKER_LEASE_MS", 5 * 60_000);
  const concurrency = options.concurrency ?? intEnv("WORKER_CONCURRENCY", 2);
  const advance = options.advance ?? advanceSearch;
  let timer: NodeJS.Timeout | null = null;
  let ticking: Promise<void> | null = null;
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

  const run = () => {
    if (stopped || ticking) return;
    ticking = tick().catch(error => logger.error({ err: error }, "Worker tick failed")).finally(() => { ticking = null; });
  };

  return {
    owner,
    /** Un passage immédiat (utilisé par les tests et pour réveiller le worker après une création). */
    tick,
    start() {
      if (!stopped) return;
      stopped = false;
      timer = setInterval(run, intervalMs);
      run(); // reprend tout de suite les recherches laissées « running » avant un redémarrage
    },
    wake: run,
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      await ticking;
    },
  };
}

export type Worker = ReturnType<typeof createWorker>;
