import { logger } from "../../lib/logger";
import { interpret } from "./ai";
import { startSearch, syncSearch } from "./apify";
import { getSearchRow, recordAttemptFailure, setCriteria, setFailure, setRun, type Criteria } from "./store";

export const MAX_STEP_ATTEMPTS = 3;
const POLL_MS = 5_000; // entre deux contrôles d'un run Apify
const RETRY_MS = 15_000; // avant de retenter une étape en échec

/**
 * Fait avancer une recherche d'une étape : interprétation + démarrage du run Apify, ou contrôle du run
 * (récupération des annonces, analyse IA, enregistrement). À appeler sous bail. Renvoie le délai avant
 * le prochain passage. Aucune dépendance à un navigateur ouvert : c'est le worker qui appelle.
 */
export async function advanceSearch(id: number): Promise<number> {
  const row = await getSearchRow(id);
  if (!row || row.status !== "running") return 0;
  const isRefresh = Boolean(row.analyzed) || row.phase === "broad";
  try {
    let criteria = JSON.parse(row.criteria) as Criteria;
    if (!row.runId) {
      if (!criteria.location) {
        criteria = await interpret(row.prompt);
        if (!criteria.location.trim()) {
          // Définitif : redemander ne changera rien.
          await setFailure(id, "Indiquez une ville ou un département dans votre description.", isRefresh);
          return 0;
        }
        await setCriteria(id, criteria);
      }
      if (criteria.intent !== "rent") {
        criteria = { ...criteria, intent: "rent" };
        await setCriteria(id, criteria);
      }
      const { runId, request } = await startSearch(criteria, row.phase === "broad" ? "broad" : "focused");
      await setRun(id, runId, request);
      return POLL_MS;
    }
    await syncSearch(id, criteria);
    const after = await getSearchRow(id);
    // Toujours « running » : run Apify en cours, ou phase élargie à démarrer tout de suite.
    return after?.status === "running" ? (after.runId ? POLL_MS : 0) : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "La recherche a échoué.";
    const attempts = await recordAttemptFailure(id, message);
    logger.error({ err: error, searchId: id, attempts }, "Housing search step failed");
    if (attempts >= MAX_STEP_ATTEMPTS) {
      await setFailure(id, message, isRefresh);
      return 0;
    }
    return RETRY_MS * attempts;
  }
}
