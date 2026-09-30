import type { NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { usageCounters } from "@workspace/db";
import { db } from "./database";
import { intEnv } from "./env";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Incrémente atomiquement le compteur de la fenêtre courante ; renvoie le total après incrément. */
export async function consume(key: string, windowMs: number, now = Date.now()) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const t = usageCounters;
  const [row] = await db().insert(t).values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [t.key, t.windowStart], set: { count: sql`${t.count} + 1` } })
    .returning({ count: t.count });
  return { count: row.count, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
}

export type QuotaLimits = { ipPerHour: number; cookiePerHour: number; globalPerDay: number };

/** Valeurs par défaut modifiables sans redéployer le code : variables d'environnement Render. */
export function quotaLimits(): QuotaLimits {
  return {
    ipPerHour: intEnv("RATE_LIMIT_IP_PER_HOUR", 40),
    cookiePerHour: intEnv("QUOTA_COOKIE_PER_HOUR", 30),
    globalPerDay: intEnv("QUOTA_GLOBAL_PER_DAY", 300),
  };
}

export function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "inconnue";
}

export type QuotaDecision = { allowed: true } | { allowed: false; scope: "global" | "cookie" | "ip"; retryAfterSeconds: number };

/**
 * Trois plafonds sur les actions coûteuses (IA, Apify) : global sur l'app par jour, par cookie de session
 * par heure, et par IP par heure. Les compteurs sont en base : ils survivent aux redémarrages.
 */
export async function checkQuotas(ip: string, visitorId: string | undefined, limits = quotaLimits(), now = Date.now()): Promise<QuotaDecision> {
  const global = await consume("global", DAY, now);
  if (global.count > limits.globalPerDay) return { allowed: false, scope: "global", retryAfterSeconds: global.retryAfterSeconds };
  if (visitorId) {
    const cookie = await consume(`cookie:${visitorId}`, HOUR, now);
    if (cookie.count > limits.cookiePerHour) return { allowed: false, scope: "cookie", retryAfterSeconds: cookie.retryAfterSeconds };
  }
  const byIp = await consume(`ip:${ip}`, HOUR, now);
  if (byIp.count > limits.ipPerHour) return { allowed: false, scope: "ip", retryAfterSeconds: byIp.retryAfterSeconds };
  return { allowed: true };
}

const MESSAGES = {
  global: "Le quota quotidien de l'application est atteint. Réessayez plus tard.",
  cookie: "Vous avez atteint votre quota horaire de recherches. Réessayez dans un moment.",
  ip: "Trop de requêtes depuis cette adresse. Réessayez dans un moment.",
} as const;

/** Middleware à poser sur les seules routes qui coûtent de l'argent (pas sur les lectures / le suivi). */
export async function costlyRateLimit(req: Request, res: Response, next: NextFunction) {
  const decision = await checkQuotas(clientIp(req), req.visitorId);
  if (decision.allowed) return next();
  res.setHeader("Retry-After", String(decision.retryAfterSeconds));
  res.status(429).json({ error: MESSAGES[decision.scope], scope: decision.scope, retryAfterSeconds: decision.retryAfterSeconds });
}
