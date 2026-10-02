/**
 * Lecture des annonces page par page, de la plus récemment mise à jour à la plus ancienne (ordre de Le Bon Coin,
 * vérifié le 01/10/2026). On ne paie que ce qu'on lit :
 *  - recherche ponctuelle (« initial ») : les 15 plus récentes, une seule lecture ;
 *  - veille quotidienne, à sa création (« backfill ») : pages de 35, la suivante tant que 4 jours ne sont pas atteints ;
 *  - passage de la veille quotidienne (« watch ») : la mise à jour la plus récente lue au passage précédent (curseur) ;
 *    la date, pas « une annonce déjà vue » : une annonce remontée réapparaît en tête et ferait s'arrêter trop tôt.
 *    Un numéro de page ne désigne rien de fixe (chaque nouveauté décale la liste vers le bas) : chaque relève repart de
 *    la page 1 et descend jusqu'au curseur, sans jamais relire les pages des relèves précédentes ;
 *  - « Étendre » (« extend ») : une seule page, la suivante, plus ancienne.
 * Les annonces lues sont enregistrées sans analyse ; l'IA analyse les premières, puis les autres quand elles s'affichent.
 */
import { analyze } from "./ai";
import { apify } from "./apify-client";
import { extraSourceItems, itemRefreshedAt, normalize, positionOf, scoreListing } from "./apify";
import { matchesKnownBasics } from "./criteria";
import { actorRequest, canReadPages } from "./housing-search";
import { interleave, normalizeExtra, startExtraSources } from "./sources";
import { finishPass, pendingAnalysis, saveAnalyzed, saveRead, setPass, type AnalysisOutcome, type Criteria, type Listing, type SearchRow } from "./store";
import { intEnv } from "../../lib/env";
import { logger } from "../../lib/logger";
import { nextParisTime } from "../../lib/paris-time";
import { enqueueWatchMail } from "../../lib/mail-outbox";
import { object, text } from "./parse";

export const PAGE_SIZE = 35; // annonces par page de résultats Le Bon Coin
const HOUR = 3_600_000;
/** Pages lues au plus par passage (105 annonces) : plafond de dépense. */
export const maxPages = () => intEnv("READ_MAX_PAGES", 3);
/** Première recherche : annonces mises à jour depuis ce nombre de jours. */
export const liveDays = () => intEnv("LIVE_SEARCH_DAYS", 4);
/** Annonces analysées dès la fin de la lecture ; les suivantes le sont quand elles s'affichent, 20 par 20. */
export const firstAnalysis = () => intEnv("FIRST_ANALYSIS", 20);
/** Recherche ponctuelle : les annonces les plus récentes, en une lecture. */
export const oneShotLimit = () => Math.min(PAGE_SIZE, intEnv("ONE_SHOT_LIMIT", 15));

export type PassMode = "initial" | "backfill" | "watch" | "extend";
export type PassState = {
  mode: PassMode;
  page: number;
  limit: number;
  /** On s'arrête dès qu'une annonce a été mise à jour à cette date ou avant ; null : une seule page. */
  stopAt: number | null;
  pagesRead: number;
  newest: number | null;
  oldest: number | null;
  reads: number;
  fresh: number;
  /** Annonces mises à jour après le curseur précédent (passage suivi) : sert au débit observé. */
  sinceCursor: number;
  /** Annonces lues, sans compter deux fois une page relue en entier : sert au débit observé (création de la veille). */
  counted?: number;
  startedAt: number;
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * Au-delà de ce nombre d'annonces attendues, on lit la page entière d'emblée : lire une partie puis devoir relire la
 * page en entier (l'acteur ne sait pas commencer à la 21e) coûte plus cher que les quelques annonces en trop.
 */
export const PARTIAL_MAX = 25;
/** Taille d'une lecture pour `expected` annonces attendues (marge comprise) : entre 10 et 35. */
export const pageLimit = (expected: number) => expected > PARTIAL_MAX ? PAGE_SIZE : clamp(Math.ceil(expected), 10, PAGE_SIZE);

/** Première page d'un passage. Passage suivi : juste ce qu'il faut d'après le débit observé (entre 10 et 35). */
export function firstState(mode: PassMode, row: Pick<SearchRow, "cursorAt" | "pagesRead" | "watchRate">, now = Date.now()): PassState {
  const base = { pagesRead: 0, newest: null, oldest: null, reads: 0, fresh: 0, sinceCursor: 0, counted: 0, startedAt: now };
  if (mode === "extend") return { ...base, mode, page: Math.max(1, row.pagesRead + 1), limit: PAGE_SIZE, stopAt: null };
  if (mode === "initial") return { ...base, mode, page: 1, limit: oneShotLimit(), stopAt: null };
  if (mode === "backfill") return { ...base, mode, page: 1, limit: PAGE_SIZE, stopAt: now - liveDays() * 24 * HOUR };
  const cursor = row.cursorAt ?? now - 12 * HOUR;
  const expected = (row.watchRate ?? PAGE_SIZE / 12) * Math.max(0, now - cursor) / HOUR * 1.3;
  return { ...base, mode, page: 1, limit: pageLimit(expected), stopAt: cursor };
}

/** Lance la lecture d'une page (et, à la toute première, des sources secondaires). */
export async function startPage(id: number, criteria: Criteria, state: PassState) {
  const chargeCap = process.env.APIFY_MAX_CHARGE_USD || "0.10";
  const timeout = intEnv("APIFY_TIMEOUT_SECONDS", 120);
  const request = actorRequest(criteria, state.limit, chargeCap, timeout, state.page);
  const response = object(await apify(request.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: request.input }));
  const runId = text(object(response.data).id);
  if (!runId) throw new Error("Apify n'a pas retourné d'identifiant d'exécution.");
  const withSources = (state.mode === "initial" || state.mode === "backfill") && state.pagesRead === 0;
  const sourceRuns = withSources ? await startExtraSources(criteria, chargeCap, timeout) : null;
  await setPass(id, {
    runId, passState: JSON.stringify(state), focusedRequest: JSON.stringify(request), stage: "searching", attempts: 0,
    ...(sourceRuns ? { sourceRuns: sourceRuns.length ? JSON.stringify(sourceRuns) : null } : {}),
  });
}

const PENDING = new Set(["READY", "RUNNING"]);
const FAILED = new Set(["FAILED", "TIMED-OUT", "TIMING-OUT", "ABORTED", "ABORTING"]);

/**
 * Contrôle le run de la page en cours. « pending » : encore en cours ; « continue » : page suivante lancée ;
 * « done » : passage terminé ; « failed » : la première page a échoué (rien à montrer).
 */
export async function checkPage(row: SearchRow, criteria: Criteria): Promise<"pending" | "continue" | "done" | "failed"> {
  const state = JSON.parse(row.passState!) as PassState;
  const run = object(object(await apify(`/v2/actor-runs/${encodeURIComponent(row.runId!)}`)).data);
  const status = text(run.status);
  if (PENDING.has(status)) return "pending";
  if (FAILED.has(status) || status !== "SUCCEEDED") {
    logger.error({ searchId: row.id, status, page: state.page, statusMessage: text(run.statusMessage) }, "Apify run did not succeed");
    if (state.pagesRead === 0) return "failed";
    // Les pages déjà lues restent valables, mais la suite n'a pas été lue : des annonces ont pu échapper.
    await finish(row, criteria, state, true);
    return "done";
  }
  const extra = (state.mode === "initial" || state.mode === "backfill") && state.pagesRead === 0 ? await extraSourceItems(row.sourceRuns, PAGE_SIZE) : [];
  if (extra === "pending") return "pending";
  const datasetId = text(run.defaultDatasetId);
  if (!datasetId) throw new Error("L'exécution Apify n'a pas de jeu de résultats.");
  const items = await apify(`/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true&limit=${state.limit}`);
  if (!Array.isArray(items)) throw new Error("Le format des résultats Apify est inattendu.");

  const seen = new Set<string>();
  const keep = (item: Omit<Listing, "id"> | null): item is Omit<Listing, "id"> => {
    if (!item || seen.has(item.url) || !matchesKnownBasics(item, criteria)) return false;
    seen.add(item.url);
    return true;
  };
  const listings = interleave([
    items.map(item => normalize(item, criteria)).filter(keep),
    ...extra.map(({ source, items: sourceItems }) =>
      sourceItems.map(item => normalizeExtra(source, item, criteria, "focused", listing => scoreListing(listing, criteria))).filter(keep)),
  ]);
  // Même date de première lecture pour tout le passage : ses pages restent groupées dans l'ordre d'affichage.
  const fresh = await saveRead(row.id, listings, state.startedAt);

  const dates = items.map(itemRefreshedAt).filter((value): value is number => value != null);
  const oldest = dates.length ? Math.min(...dates) : null;
  const endOfList = items.length < state.limit;
  const reached = state.stopAt == null || (oldest != null && oldest <= state.stopAt);
  const more = !endOfList && !reached && canReadPages(criteria);
  // Page lue en partie sans atteindre la borne : on la relit en entier (seul surcoût possible). Ses annonces seront
  // recomptées à la relecture : on ne les compte pas ici (sinon le débit observé gonfle à chaque relève).
  const reread = more && state.limit < PAGE_SIZE;
  const next: PassState = {
    ...state,
    pagesRead: state.pagesRead + 1,
    reads: state.reads + items.length,
    fresh: state.fresh + fresh.length,
    newest: Math.max(state.newest ?? 0, ...dates) || null,
    oldest: oldest == null ? state.oldest : Math.min(state.oldest ?? oldest, oldest),
    sinceCursor: state.sinceCursor + (reread || state.mode !== "watch" || state.stopAt == null ? 0 : dates.filter(date => date > state.stopAt!).length),
    counted: (state.counted ?? state.reads) + (reread ? 0 : items.length),
  };
  if (reread) {
    await startPage(row.id, criteria, { ...next, limit: PAGE_SIZE });
    return "continue";
  }
  if (more && state.page < maxPages()) {
    await startPage(row.id, criteria, { ...next, page: state.page + 1, limit: oldest == null ? PAGE_SIZE : nextPageLimit(dates, oldest, state.stopAt!) });
    return "continue";
  }
  await finish(row, criteria, next, more);
  return "done";
}

/**
 * Taille de la page suivante : d'après le rythme de la page qui vient d'être lue (35 annonces sur tant d'heures), ce qu'il
 * reste d'annonces jusqu'à la borne d'arrêt, avec 30 % de marge. Évite de payer toute une page pour en trouver 5.
 */
export function nextPageLimit(dates: number[], oldest: number, stopAt: number) {
  const newest = Math.max(...dates);
  if (dates.length < 2 || newest <= oldest) return PAGE_SIZE;
  const perHour = dates.length / ((newest - oldest) / HOUR);
  return pageLimit(perHour * Math.max(0, oldest - stopAt) / HOUR * 1.3);
}

/**
 * Fin d'une lecture. `truncated` : la borne d'arrêt n'a pas été atteinte (plafond de pages, ou page suivante en échec) :
 * des annonces ont pu échapper, la relève est « partielle ».
 */
async function finish(row: SearchRow, criteria: Criteria, state: PassState, truncated: boolean) {
  const now = Date.now();
  if (truncated) logger.info({ searchId: row.id, mode: state.mode, reads: state.reads }, "Reading stopped before its bound");
  const background = state.mode === "watch" || state.mode === "backfill";
  // Recherche ponctuelle ou « Étendre » : l'utilisateur attend ces annonces, on les analyse avant de rendre la main (une
  // erreur de l'IA est montrée). Veille : la lecture est d'abord enregistrée (curseur), voir plus bas.
  if (!background) await analyzeListings(row.id, criteria, await pendingAnalysis(row.id, { limit: firstAnalysis() }));
  const hours = (from: number | null, to: number | null) => from != null && to != null && to > from ? (to - from) / HOUR : null;
  const span = state.mode === "watch" ? hours(state.stopAt, now) : hours(state.oldest, state.newest);
  // Relève : nombre exact d'annonces depuis le curseur s'il est atteint ; sinon un minimum (le débit ne peut que monter).
  const observed = span && span >= 1 ? (state.mode === "watch" ? state.sinceCursor : state.counted ?? state.reads) / span : null;
  const rate = observed == null ? row.watchRate
    : state.mode === "watch" ? (truncated ? Math.max(row.watchRate ?? 0, observed) : observed)
    : state.mode === "backfill" || (state.mode === "initial" && state.limit === PAGE_SIZE) ? observed : row.watchRate;
  const times = row.watchTimes ? JSON.parse(row.watchTimes) as string[] : [];
  await finishPass(row.id, {
    cursorAt: Math.max(row.cursorAt ?? 0, state.newest ?? 0) || null,
    // Une page lue en partie (recherche ponctuelle, 15 sur 35 ; dernière page de la remontée) ne compte pas : « Étendre »
    // la relira en entier.
    pagesRead: state.mode === "watch" ? row.pagesRead : Math.max(row.pagesRead, state.limit < PAGE_SIZE ? state.page - 1 : state.page),
    // Création de la veille quotidienne : ce qu'elle trouve sur 4 jours n'est pas « nouveau » (l'utilisateur est là).
    ...(state.mode === "backfill" ? { lastVisitedAt: now } : {}),
    watchRate: rate,
    ...(state.mode === "watch" && row.watched === 1 ? { nextWatchAt: nextParisTime(times, now) } : {}),
    // Relève : ses annonces (première lecture = début du passage) sont séparées des plus anciennes dans la liste.
    ...(state.mode === "watch" ? { lastWatchAt: state.startedAt, lastWatchStatus: truncated ? "partial" : "ok", watchFailures: 0 } : {}),
  });
  // E-mail de la relève : composé au moment de l'envoi (après l'analyse ci-dessous), seulement s'il y a du nouveau.
  if (state.mode === "watch" && row.watched === 1 && row.ownerId != null) await enqueueWatchMail(row.id, row.ownerId, state.startedAt);
  logger.info({ searchId: row.id, mode: state.mode, pages: state.pagesRead, reads: state.reads, fresh: state.fresh }, "Reading pass finished");
  if (!background) return;
  // Veille : curseur déjà enregistré, une panne de l'IA ne fait donc pas relire ces pages au passage suivant ; les
  // annonces non analysées le seront à l'affichage, comme les autres.
  try {
    await analyzeListings(row.id, criteria, await pendingAnalysis(row.id, { limit: firstAnalysis() }));
  } catch (error) {
    logger.error({ err: error, searchId: row.id, mode: state.mode }, "Analysis after a background pass failed");
  }
}

/**
 * Analyse IA d'annonces enregistrées : chambre ou local non habitable → masquée ; prix, surface ou pièces contredits par
 * la description → masquée ; sinon enrichie (résumé, critères, caractéristiques, position lue dans le texte).
 */
export async function analyzeListings(id: number, criteria: Criteria, listings: Listing[]) {
  if (!listings.length) return;
  const enriched = await analyze(listings, criteria);
  const outcomes: AnalysisOutcome[] = [];
  for (const item of listings) {
    const observations = enriched.find(result => result.id === item.id);
    if (!observations) continue;
    if (observations.offer && (observations.offer.kind === "room" || observations.offer.kind === "non_dwelling")) {
      logger.info({ searchId: id, url: item.url, offer: observations.offer }, "Listing set aside: not an entire dwelling");
      outcomes.push({ kind: "hidden", id: item.id, reason: observations.offer.kind });
      continue;
    }
    if (observations.criterionResults.some(check => ["price", "area", "rooms"].includes(check.id) && check.status === "contradicted" && check.source === "description")) {
      outcomes.push({ kind: "hidden", id: item.id, reason: "mismatch" });
      continue;
    }
    const position = await positionOf(item, observations.address ?? null, undefined);
    outcomes.push({ kind: "kept", listing: {
      id: item.id, features: observations.features, aiSummary: observations.aiSummary, summaryEvidence: observations.summaryEvidence,
      criterionResults: observations.criterionResults, score: observations.score,
      price: observations.price, area: observations.area, rooms: observations.rooms, location: observations.location, ...position,
    } });
  }
  await saveAnalyzed(id, outcomes);
}
