import { eq, isNull, sql } from "drizzle-orm";
import { housingSearches, users } from "@workspace/db";
import { db } from "./database";
import { hashPassword } from "./passwords";

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const isValidEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

export async function findUserByEmail(email: string) {
  const [user] = await db().select().from(users).where(eq(users.email, normalizeEmail(email)));
  return user;
}

export async function getUser(id: number) {
  const [user] = await db().select().from(users).where(eq(users.id, id));
  return user;
}

/**
 * Crée un compte. Renvoie null si l'e-mail existe déjà. Le premier compte créé (id le plus bas) adopte les recherches
 * antérieures aux comptes (owner_id NULL) : l'historique de l'application ne se perd pas.
 */
export async function createUser(email: string, password: string) {
  const [user] = await db().insert(users)
    .values({ email: normalizeEmail(email), passwordHash: await hashPassword(password) })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (!user) return null;
  const [{ first }] = await db().select({ first: sql<number>`min(${users.id})` }).from(users);
  if (first === user.id) await db().update(housingSearches).set({ ownerId: user.id }).where(isNull(housingSearches.ownerId));
  return user;
}

/** Développement sans APP_PASSWORD : un compte local unique, sans mot de passe utilisable. */
export async function ensureDevUser() {
  const existing = await findUserByEmail("dev@localhost");
  if (existing) return existing;
  const created = await createUser("dev@localhost", `dev-${Math.random()}-${Date.now()}`);
  return created ?? (await findUserByEmail("dev@localhost"))!;
}
