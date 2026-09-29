import { Router, type IRouter } from "express";
import {
  InterpretHousingRequestBody, InterpretHousingRequestResponse,
  CreateHousingSearchBody, CreateHousingSearchResponse,
  ListHousingSearchesResponse, GetHousingSearchParams,
  GetHousingSearchResponse, AnalyzeHousingSearchParams,
  AnalyzeHousingSearchResponse,
} from "@workspace/api-zod";
import { interpret, analyze } from "./ai";
import { startSearch, syncSearch } from "./apify";
import { createSearch, getSearch, getSearchRow, listSearches, reserveUsage, saveAnalysis, setFailure, setRun } from "./store";

const router: IRouter = Router();
const analyzing = new Set<number>();

router.post("/housing/interpret", async (req, res): Promise<void> => {
  const input = InterpretHousingRequestBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: input.error.message });
    return;
  }
  if (!reserveUsage("interpret", 20)) {
    res.status(429).json({ error: "Limite quotidienne de 20 interprétations atteinte pour cette démo." });
    return;
  }
  res.json(InterpretHousingRequestResponse.parse(await interpret(input.data.prompt)));
});

router.get("/housing/searches", (_req, res) => {
  res.json(ListHousingSearchesResponse.parse(listSearches()));
});

router.post("/housing/searches", async (req, res): Promise<void> => {
  const input = CreateHousingSearchBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: input.error.message });
    return;
  }
  const { prompt, criteria } = input.data;
  if (!criteria.location.trim()) {
    res.status(400).json({ error: "Une ville ou un département est nécessaire pour lancer la recherche." });
    return;
  }
  if (!reserveUsage("search", 5)) {
    res.status(429).json({ error: "Limite quotidienne de 5 recherches Apify atteinte pour cette démo. Réessayez demain." });
    return;
  }
  const id = createSearch(prompt, criteria);
  try {
    const runId = await startSearch(criteria);
    setRun(id, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "La recherche Apify a échoué.";
    setFailure(id, message);
    req.log.error({ err: error, searchId: id }, "Unable to start Apify run");
    res.status(502).json({ error: message });
    return;
  }
  res.status(201).json(CreateHousingSearchResponse.parse(getSearch(id)));
});

router.get("/housing/searches/:id", async (req, res): Promise<void> => {
  const params = GetHousingSearchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const row = getSearchRow(params.data.id);
  if (!row) {
    res.status(404).json({ error: "Recherche introuvable." });
    return;
  }
  if (row.status === "running" && row.run_id) {
    try {
      await syncSearch(row.id, JSON.parse(row.criteria));
    } catch {
      // A temporary Apify polling error should not hide persisted search state.
    }
  }
  res.json(GetHousingSearchResponse.parse(getSearch(row.id)));
});

router.post("/housing/searches/:id/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeHousingSearchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const search = getSearch(params.data.id);
  if (!search) {
    res.status(404).json({ error: "Recherche introuvable." });
    return;
  }
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
      saveAnalysis(search.id, enriched);
    } finally {
      analyzing.delete(search.id);
    }
  }
  res.json(AnalyzeHousingSearchResponse.parse(getSearch(search.id)));
});

export default router;