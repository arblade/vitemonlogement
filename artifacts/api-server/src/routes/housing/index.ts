import { Router, type IRouter } from "express";
import {
  InterpretHousingRequestBody, InterpretHousingRequestResponse,
  CreateHousingSearchBody, CreateHousingSearchResponse,
  ListHousingSearchesResponse, GetHousingSearchParams,
  GetHousingSearchResponse, AnalyzeHousingSearchParams,
  AnalyzeHousingSearchResponse, RefreshHousingSearchParams,
  RefreshHousingSearchResponse,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { interpret, analyze } from "./ai";
import { beginRefresh, createSearch, getOwnedSearchRow, getSearch, listSearches, saveAnalysis } from "./store";
import { costlyRateLimit } from "../../lib/quota";
import { claimSearch, releaseSearch } from "../../lib/queue";
import { wakeWorker } from "../../lib/worker-registry";

const router: IRouter = Router();
const instanceId = `api-${randomUUID()}`;
const ANALYZE_LEASE_MS = 5 * 60_000;

// Les routes coûteuses (IA, Apify) passent par costlyRateLimit : plafond global, par cookie et par IP.
router.post("/housing/interpret", costlyRateLimit, async (req, res): Promise<void> => {
  const input = InterpretHousingRequestBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  res.json(InterpretHousingRequestResponse.parse(await interpret(input.data.prompt)));
});

router.get("/housing/searches", async (req, res) => {
  res.json(ListHousingSearchesResponse.parse(await listSearches(req.userId!)));
});

router.post("/housing/searches", costlyRateLimit, async (req, res): Promise<void> => {
  const input = CreateHousingSearchBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const id = await createSearch(input.data.prompt.trim(), req.userId!);
  res.status(201).json(CreateHousingSearchResponse.parse(await getSearch(id)));
  wakeWorker(); // le worker serveur prend le relais ; le navigateur ne fait que suivre l'avancement
});

// Simple lecture : l'avancement ne dépend plus des appels du navigateur.
router.get("/housing/searches/:id", async (req, res): Promise<void> => {
  const params = GetHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  res.json(GetHousingSearchResponse.parse(await getSearch(row.id)));
});

router.post("/housing/searches/:id/refresh", costlyRateLimit, async (req, res): Promise<void> => {
  const params = RefreshHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  if (row.status !== "completed") {
    res.status(409).json({ error: "Attendez la fin de la recherche avant de rafraîchir." });
    return;
  }
  if (!await beginRefresh(row.id)) {
    res.status(409).json({ error: "Un rafraîchissement est déjà en cours." });
    return;
  }
  res.status(202).json(RefreshHousingSearchResponse.parse(await getSearch(row.id)));
  wakeWorker();
});

router.post("/housing/searches/:id/analyze", costlyRateLimit, async (req, res): Promise<void> => {
  const params = AnalyzeHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!await getOwnedSearchRow(params.data.id, req.userId!)) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  const search = await getSearch(params.data.id);
  if (!search) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  if (search.status !== "completed") {
    res.status(409).json({ error: "Attendez la fin de la recherche avant l'analyse." });
    return;
  }
  if (!search.analyzed) {
    // Verrou en base (bail) : valable même avec plusieurs instances.
    if (!await claimSearch(search.id, instanceId, ANALYZE_LEASE_MS)) {
      res.status(409).json({ error: "Une analyse est déjà en cours pour cette recherche." });
      return;
    }
    try {
      const enriched = await analyze(search.listings, search.criteria);
      await saveAnalysis(search.id, enriched);
    } finally {
      await releaseSearch(search.id, instanceId);
    }
  }
  res.json(AnalyzeHousingSearchResponse.parse(await getSearch(search.id)));
});

export default router;
