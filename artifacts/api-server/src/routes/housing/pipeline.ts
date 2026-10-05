import { logger } from "../../lib/logger";
import { interpret } from "./ai";
import { locatePlaces } from "../../lib/geocode";
import { withPlaceChecks } from "./criteria";
import { analyzeListings, checkPage, firstState, startPage, type PassMode } from "./reader";
import { clearTask, FAILURE_MESSAGE, getSearchRow, pendingAnalysis, recordAttemptFailure, setCriteria, setFailure, type Criteria, type SearchRow } from "./store";

export const MAX_STEP_ATTEMPTS = 3;
const POLL_MS = 5_000; // entre deux contrôles d'un run Apify
const RETRY_MS = 15_000; // avant de retenter une étape en échec

const BLOCKING_CODES = ["credit_balance_exhausted", "insufficient_quota", "billing_hard_limit_reached", "invalid_api_key"];

/** Erreur que réessayer ne réparera pas (crédit ou clé du service IA) : message clair pour l'utilisateur, sans détail technique. */
export function blockingFailure(error: unknown): string | null {
  const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };
  if (typeof code === "string" && BLOCKING_CODES.includes(code)) return "Le service d'analyse est momentanément indisponible. Réessayez plus tard.";
  if (status === 401 || status === 402) return "Le service d'analyse est momentanément indisponible. Réessayez plus tard.";
  return null;
}

/** Annonces analysées par étape quand le navigateur en demande (en faisant défiler). */
const ANALYSIS_STEP = 20;

/**
 * Fait avancer une recherche d'une étape, sous bail (voir worker.ts). Recherche « running » : interprétation de la
 * demande puis lecture page par page (reader.ts). Recherche terminée avec une tâche : passage de la veille quotidienne,
 * page suivante (« Étendre ») ou analyse demandée en faisant défiler. Renvoie le délai avant le prochain passage.
 */
export async function advanceSearch(id: number): Promise<number> {
  const row = await getSearchRow(id);
  if (!row || (row.status !== "running" && !row.task)) return 0;
  const isTask = row.status !== "running";
  try {
    let criteria = JSON.parse(row.criteria) as Criteria;
    if (row.task === "analyze") {
      const batch = await pendingAnalysis(id, { requestedOnly: true, limit: ANALYSIS_STEP });
      await analyzeListings(id, criteria, batch);
      // Une réponse incomplète de l'IA ne fait pas boucler : la demande retombe, le navigateur la renouvellera.
      if (!batch.length || batch.length < ANALYSIS_STEP) { await clearTask(id); return 0; }
      return 0;
    }
    if (!row.runId) {
      if (!isTask) {
        if (!criteria.location) {
          criteria = await interpret(row.prompt);
          if (!criteria.location.trim()) {
            // Définitif : redemander ne changera rien.
            await setFailure(id, "Indiquez une ville ou un département dans votre description.");
            return 0;
          }
          if (criteria.places?.length) criteria = withPlaceChecks({ ...criteria, places: await locatePlaces(criteria.places, criteria.location) });
          await setCriteria(id, criteria);
        }
        if (criteria.intent !== "rent") {
          criteria = { ...criteria, intent: "rent" };
          await setCriteria(id, criteria);
        }
      }
      await startPage(id, criteria, firstState(passMode(row), row));
      return POLL_MS;
    }
    const outcome = await checkPage(row, criteria);
    if (outcome === "failed") {
      if (isTask) await clearTask(id, row.task === "extend" ? "Impossible de charger plus d’annonces pour le moment." : null);
      else await setFailure(id, FAILURE_MESSAGE);
      return 0;
    }
    return outcome === "done" ? 0 : POLL_MS;
  } catch (error) {
    const blocking = blockingFailure(error);
    if (blocking) {
      logger.error({ err: error, searchId: id }, "Housing search blocked by the AI service");
      if (isTask) await clearTask(id, row.task === "watch" || row.task === "backfill" ? null : blocking);
      else await setFailure(id, blocking);
      return 0;
    }
    const message = error instanceof Error ? error.message : "La recherche a échoué.";
    const attempts = await recordAttemptFailure(id, message);
    logger.error({ err: error, searchId: id, attempts, task: row.task }, "Housing search step failed");
    if (attempts >= MAX_STEP_ATTEMPTS) {
      if (isTask) await clearTask(id, row.task === "watch" || row.task === "backfill" ? null : FAILURE_MESSAGE);
      else await setFailure(id, FAILURE_MESSAGE);
      return 0;
    }
    return RETRY_MS * attempts;
  }
}

const passMode = (row: SearchRow): PassMode =>
  row.status === "running" ? "initial" : row.task === "watch" || row.task === "backfill" ? row.task : "extend";
