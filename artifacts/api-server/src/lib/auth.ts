import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { isProduction } from "./env";
import { ensureDevUser, getUser } from "./users";

export const SESSION_COOKIE = "vml_session";
const SESSION_MAX_AGE_MS = 30 * 86_400_000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { visitorId?: string; userId?: number }
  }
}

const sha = (value: string) => createHash("sha256").update(value).digest();

/**
 * APP_PASSWORD est le CODE D'INVITATION : seules les personnes qui le connaissent peuvent créer un compte
 * (lien /?invite=CODE). Il n'ouvre plus l'application à lui seul. Jamais dans le code ni dans le dépôt.
 */
export function passwordConfigured() {
  return Boolean(process.env.APP_PASSWORD);
}

export function checkInviteCode(input: unknown) {
  const expected = process.env.APP_PASSWORD;
  if (!expected || typeof input !== "string") return false;
  return timingSafeEqual(sha(input), sha(expected)); // comparaison à durée constante
}

function secret() {
  return process.env.SESSION_SECRET || `vml-session:${process.env.APP_PASSWORD ?? ""}`;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** Signature d'une valeur pour un usage précis (lien de désinscription des e-mails…), avec le secret de session. */
export const signFor = (purpose: string, value: string) => sign(`${purpose}:${value}`);
export function checkSignature(purpose: string, value: string, signature: unknown) {
  if (typeof signature !== "string") return false;
  const expected = signFor(purpose, value);
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Identifiant de session d'un compte : « u12 ». Il sert aussi de clé du quota par utilisateur (checkQuotas). */
export const visitorIdForUser = (userId: number) => `u${userId}`;
export function userIdFromVisitor(visitorId: string): number | null {
  const match = /^u(\d+)$/.exec(visitorId);
  return match ? Number(match[1]) : null;
}

/** Jeton de session signé : identifiant de visiteur (« u<id> » pour un compte) + date d'émission. */
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

/** Protège l'API métier : il faut un compte connecté. Sans APP_PASSWORD : compte de développement en local, fermé (503) en production. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!passwordConfigured()) {
    if (isProduction()) { res.status(503).json({ error: "Accès non configuré : définissez APP_PASSWORD sur le serveur." }); return; }
    const user = await ensureDevUser();
    req.userId = user.id;
    req.visitorId = visitorIdForUser(user.id);
    return next();
  }
  const session = readSession(req.cookies?.[SESSION_COOKIE]);
  const userId = session ? userIdFromVisitor(session.visitorId) : null;
  const user = userId === null ? undefined : await getUser(userId);
  if (!user) { res.status(401).json({ error: "Authentification requise." }); return; }
  req.userId = user.id;
  req.visitorId = session!.visitorId;
  next();
}
