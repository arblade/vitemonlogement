import { Router, type IRouter } from "express";
import {
  InterpretHousingRequestBody, InterpretHousingRequestResponse,
  CreateHousingSearchBody, CreateHousingSearchResponse,
  ListHousingSearchesResponse, GetHousingSearchParams,
  GetHousingSearchResponse, AnalyzeHousingSearchParams,
  AnalyzeHousingSearchResponse, RefreshHousingSearchParams,
  RefreshHousingSearchResponse,
} from "@workspace/api-zod";
import { interpret, analyze } from "./ai";
import { startSearch, syncSearch } from "./apify";
import {
  beginRefresh, createSearch, getSearch, getSearchRow, listSearches,
  saveAnalysis, setCriteria, setFailure, setRun, type Criteria,
} from "./store";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
const analyzing = new Set<number>();
const starting = new Set<number>();

async function beginSearch(id: number) {
  if (starting.has(id)) return;
  starting.add(id);
  let isRefresh = false;
  try {
    const row = await getSearchRow(id);
    if (!row || row.status !== "running" || row.run_id) return;
    isRefresh = Boolean(row.analyzed);
    let criteria = JSON.parse(row.criteria) as Criteria;
    if (!criteria.location) {
      criteria = await interpret(row.prompt);
      if (!criteria.location.trim()) throw new Error("Indiquez une ville ou un département dans votre description.");
      await setCriteria(id, criteria);
    }
    if (criteria.intent !== "rent") {
      criteria = { ...criteria, intent: "rent" };
      await setCriteria(id, criteria);
    }
    const { runId, request } = await startSearch(criteria, row.phase);
    await setRun(id, runId, request);
  } catch (error) {
    logger.error({ err: error, searchId: id }, "Unable to start housing search");
    await setFailure(id, error instanceof Error ? error.message : "La recherche a échoué.", isRefresh);
  } finally {
    starting.delete(id);
  }
}

router.post("/housing/interpret", async (req, res): Promise<void> => {
  const input = InterpretHousingRequestBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  res.json(InterpretHousingRequestResponse.parse(await interpret(input.data.prompt)));
});

router.get("/housing/searches", async (_req, res) => {
  res.json(ListHousingSearchesResponse.parse(await listSearches()));
});

router.post("/housing/searches", async (req, res): Promise<void> => {
  const input = CreateHousingSearchBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const id = await createSearch(input.data.prompt.trim());
  res.status(201).json(CreateHousingSearchResponse.parse(await getSearch(id)));
  void beginSearch(id);
});

router.get("/housing/searches/:id", async (req, res): Promise<void> => {
  const params = GetHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getSearchRow(params.data.id);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  if (row.status === "running") {
    if (row.run_id) {
      // Polling must not hold the HTTP request open during Apify or LLM work.
      void syncSearch(row.id, JSON.parse(row.criteria) as Criteria, () => beginSearch(row.id)).catch(error => {
        logger.error({ err: error, searchId: row.id }, "Search synchronization failed");
      });
    } else {
      // A restart during interpretation or actor startup resumes from SQLite.
      void beginSearch(row.id);
    }
  }
  res.json(GetHousingSearchResponse.parse(await getSearch(row.id)));
});

router.post("/housing/searches/:id/refresh", async (req, res): Promise<void> => {
  const params = RefreshHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getSearchRow(params.data.id);
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
  void beginSearch(row.id);
});

router.post("/housing/searches/:id/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const search = await getSearch(params.data.id);
  if (!search) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  if (search.status !== "completed") {
    res.status(409).json({ error: "Attendez la fin de la recherche avant l'analyse." });
    return;
  }
  if (!search.analyzed) {
    if (analyzing.has(search.id)) {
      res.status(409).json({ error: "Une analyse est déjà en cours pour cette recherche." });
      return;
    }
    analyzing.add(search.id);
    try {
      const enriched = await analyze(search.listings, search.criteria);
      await saveAnalysis(search.id, enriched);
    } finally {
      analyzing.delete(search.id);
    }
  }
  res.json(AnalyzeHousingSearchResponse.parse(await getSearch(search.id)));
});

export default router;