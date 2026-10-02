// File d'envoi des e-mails. Les e-mails sont mis en file par le worker (fin de relève, mise en pause, échecs répétés) et
// envoyés au tour suivant ; leur contenu est composé au moment de l'envoi (annonces analysées entre-temps, désinscription,
// veille arrêtée). Chaque e-mail a une clé unique : une relève reprise ne l'envoie jamais deux fois, et la même clé sert
// de clé d'idempotence chez Resend. En cas d'erreur, nouvel essai plus tard (5 au plus).
import { and, asc, eq, lt, lte, ne } from "drizzle-orm";
import { mailOutbox, users } from "@workspace/db";
import { db } from "./database";
import { logger } from "./logger";
import { checkSignature, signFor } from "./auth";
import { mailConfigured, publicOrigin, sendMail, type Mail } from "./mail";
import { watchDigest, watchFailing, watchPaused } from "./mail-templates";
import { getSearch, getSearchRow, watchIdleDays, type Criteria } from "../routes/housing/store";

export type MailKind = "watch" | "watch-paused" | "watch-failing";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Bail pendant un envoi : une autre instance ne prend pas le même e-mail. */
const CLAIM_MS = 10 * 60_000;
/** Un récapitulatif de relève qui n'a pas pu partir dans ce délai n'est plus envoyé (le suivant prend le relais). */
const DIGEST_STALE_MS = 10 * 3_600_000;

export async function enqueueMail(kind: MailKind, key: string, fields: { userId?: number | null; searchId?: number | null; payload?: object } = {}, now = Date.now()) {
  await db().insert(mailOutbox).values({
    key, kind, userId: fields.userId ?? null, searchId: fields.searchId ?? null, payload: JSON.stringify(fields.payload ?? {}), createdAt: now, nextAttemptAt: now,
  }).onConflictDoNothing({ target: mailOutbox.key });
}

/** Récapitulatif d'une relève : `passAt` (début de la relève) identifie ses annonces (première lecture). */
export const enqueueWatchMail = (searchId: number, userId: number, passAt: number) =>
  enqueueMail("watch", `watch:${searchId}:${passAt}`, { userId, searchId, payload: { passAt } });

/** Lien de désinscription signé : pas besoin d'être connecté pour s'en servir (exigé par Gmail et Yahoo). */
export function unsubscribeUrl(userId: number) {
  return `${publicOrigin()}/api/mail/unsubscribe?u=${userId}&t=${signFor("unsubscribe", String(userId))}`;
}
export const validUnsubscribe = (userId: unknown, token: unknown) =>
  typeof userId === "string" && /^\d+$/.test(userId) && checkSignature("unsubscribe", userId, token);

export async function setMailOptOut(userId: number, optOut: boolean, now = Date.now()) {
  await db().update(users).set({ mailOptOutAt: optOut ? now : null }).where(eq(users.id, userId));
}

type Row = typeof mailOutbox.$inferSelect;
type Composed = { mail: Mail } | { skip: string };

const locationOf = (criteria: Criteria, prompt: string) => criteria.location?.trim() || prompt.slice(0, 40);

async function recipient(userId: number | null) {
  if (userId == null) return null;
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  return user ?? null;
}

/** Contenu de l'e-mail, ou la raison de ne pas l'envoyer. */
export async function compose(row: Row, now = Date.now()): Promise<Composed> {
  const payload = JSON.parse(row.payload) as { passAt?: number };
  if (row.kind === "watch-failing") {
    const to = process.env.ALERT_EMAIL?.trim();
    if (!to) return { skip: "ALERT_EMAIL absente" };
    const search = row.searchId == null ? undefined : await getSearchRow(row.searchId);
    if (!search) return { skip: "recherche supprimée" };
    const content = watchFailing({
      searchId: search.id, location: locationOf(JSON.parse(search.criteria) as Criteria, search.prompt), failures: search.watchFailures,
      error: search.error, searchUrl: `${publicOrigin()}/searches/${search.id}`,
    });
    return { mail: { to, ...content, idempotencyKey: row.key } };
  }
  const user = await recipient(row.userId);
  if (!user) return { skip: "compte supprimé" };
  if (user.mailOptOutAt != null) return { skip: "désinscrit" };
  const owned = row.searchId == null ? undefined : await getSearchRow(row.searchId);
  const search = owned?.ownerId === user.id ? await getSearch(owned.id) : null;
  if (!search) return { skip: "recherche introuvable" };
  const searchUrl = `${publicOrigin()}/searches/${search.id}`;
  const unsubscribe = unsubscribeUrl(user.id);
  // En-têtes de désinscription en un clic (RFC 8058) : les messageries affichent un bouton « Se désabonner ».
  const headers = { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  const location = locationOf(search.criteria, search.prompt);
  if (row.kind === "watch-paused") {
    if (search.watch !== "paused") return { skip: "veille reprise ou arrêtée" };
    const content = watchPaused({ location, idleDays: watchIdleDays(), searchUrl, unsubscribeUrl: unsubscribe, email: user.email });
    return { mail: { to: user.email, ...content, headers, idempotencyKey: row.key } };
  }
  if (search.watch !== "active") return { skip: "veille arrêtée" };
  if (now - row.createdAt > DIGEST_STALE_MS) return { skip: "trop tard" };
  const fresh = search.listings.filter(listing => listing.firstSeenAt === payload.passAt);
  if (!fresh.length) return { skip: "aucune nouvelle annonce" };
  // Les annonces déjà analysées d'abord (résumé, prix vérifié), dans l'ordre du site.
  const ordered = [...fresh.filter(listing => listing.analyzed !== false), ...fresh.filter(listing => listing.analyzed === false)];
  const content = watchDigest({
    location, prompt: search.prompt, passAt: payload.passAt!, listings: ordered, partial: search.lastWatchStatus === "partial",
    searchUrl, unsubscribeUrl: unsubscribe, email: user.email,
  });
  return { mail: { to: user.email, ...content, headers, idempotencyKey: row.key } };
}

/** Envoie les e-mails en attente (appelé à chaque tour du worker). Renvoie le nombre d'e-mails traités. */
export async function processOutbox(now = Date.now(), limit = 10) {
  const t = mailOutbox;
  const due = await db().select().from(t).where(and(eq(t.status, "pending"), lte(t.nextAttemptAt, now))).orderBy(asc(t.id)).limit(limit);
  let handled = 0;
  for (const row of due) {
    // Réservation : seule l'instance qui change la date de prochain essai envoie l'e-mail.
    const [claimed] = await db().update(t).set({ nextAttemptAt: now + CLAIM_MS })
      .where(and(eq(t.id, row.id), eq(t.status, "pending"), eq(t.nextAttemptAt, row.nextAttemptAt))).returning({ id: t.id });
    if (!claimed) continue;
    handled++;
    try {
      const composed = await compose(row, now);
      if ("skip" in composed) {
        await db().update(t).set({ status: "skipped", error: composed.skip }).where(eq(t.id, row.id));
        continue;
      }
      if (!mailConfigured()) {
        logger.info({ kind: row.kind, to: composed.mail.to, subject: composed.mail.subject }, "E-mail not sent: RESEND_API_KEY is not set");
        await db().update(t).set({ status: "skipped", error: "RESEND_API_KEY absente" }).where(eq(t.id, row.id));
        continue;
      }
      const providerId = await sendMail(composed.mail);
      await db().update(t).set({ status: "sent", sentAt: Date.now(), providerId, error: null }).where(eq(t.id, row.id));
      logger.info({ kind: row.kind, mailId: row.id, providerId }, "E-mail sent");
    } catch (error) {
      const attempts = row.attempts + 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      logger.error({ err: error, kind: row.kind, mailId: row.id, attempts }, "E-mail sending failed");
      await db().update(t).set(attempts >= MAX_ATTEMPTS
        ? { status: "failed", attempts, error: message }
        : { attempts, error: message, nextAttemptAt: now + RETRY_DELAYS_MS[attempts - 1] }).where(eq(t.id, row.id));
    }
  }
  return handled;
}

/** Ménage : la file garde 30 jours d'historique. */
export async function purgeOutbox(now = Date.now()) {
  await db().delete(mailOutbox).where(and(ne(mailOutbox.status, "pending"), lt(mailOutbox.createdAt, now - 30 * 86_400_000)));
}

