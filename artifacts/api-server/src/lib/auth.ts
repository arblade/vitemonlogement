import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { isProduction } from "./env";

export const SESSION_COOKIE = "vml_session";
const SESSION_MAX_AGE_MS = 30 * 86_400_000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { visitorId?: string }
  }
}

const sha = (value: string) => createHash("sha256").update(value).digest();

/** Accès protégé par un mot de passe partagé (APP_PASSWORD) : jamais dans le code ni dans le dépôt. */
export function passwordConfigured() {
  return Boolean(process.env.APP_PASSWORD);
}

export function checkPassword(input: unknown) {
  const expected = process.env.APP_PASSWORD;
  if (!expected || typeof input !== "string") return false;
  return timingSafeEqual(sha(input), sha(expected)); // comparaison à durée constante
}

function secret() {
  return process.env.SESSION_SECRET || `vml-session:${process.env.APP_PASSWORD ?? ""}`;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** Jeton de session signé : identifiant de visiteur (sert au quota par cookie) + date d'émission. */
export function issueSession(now = Date.now(), visitorId: string = randomUUID()) {
  const payload = `${visitorId}.${Math.floor(now / 1000)}`;
  return `${payload}.${sign(payload)}`;
}

export function readSession(token: unknown, now = Date.now()): { visitorId: string } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [visitorId, issued, signature] = parts;
  const expected = sign(`${visitorId}.${issued}`);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const issuedAt = Number(issued) * 1000;
  if (!Number.isFinite(issuedAt) || now - issuedAt > SESSION_MAX_AGE_MS || issuedAt > now + 60_000) return null;
  return { visitorId };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: isProduction(), maxAge: SESSION_MAX_AGE_MS, path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: isProduction(), path: "/" });
}

/** Protège l'API métier. Sans APP_PASSWORD : ouvert en développement, fermé (503) en production. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!passwordConfigured()) {
    if (!isProduction()) { req.visitorId = "dev"; return next(); }
    res.status(503).json({ error: "Accès non configuré : définissez APP_PASSWORD sur le serveur." });
    return;
  }
  const session = readSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) { res.status(401).json({ error: "Authentification requise." }); return; }
  req.visitorId = session.visitorId;
  next();
}
