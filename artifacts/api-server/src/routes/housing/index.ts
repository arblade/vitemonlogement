import { Router, type IRouter } from "express";
import {
  InterpretHousingRequestBody, InterpretHousingRequestResponse,
  CreateHousingSearchBody, CreateHousingSearchResponse,
  ListHousingSearchesResponse, GetHousingSearchParams,
  GetHousingSearchResponse, AnalyzeHousingSearchParams,
  AnalyzeHousingSearchResponse, AnalyzeHousingSearchBody, RefreshHousingSearchParams,
  RefreshHousingSearchResponse, GetListingRoutesParams, GetListingRoutesResponse,
  WatchHousingSearchParams, WatchHousingSearchBody, WatchHousingSearchResponse, UnwatchHousingSearchParams, UnwatchHousingSearchResponse,
  VisitHousingSearchParams, GetWatchedSearchResponse,
} from "@workspace/api-zod";
import { interpret } from "./ai";
import {
  createSearch, getOwnedSearchRow, getPublicSearch, getSearch, isPrecise, listSearches, markVisited, requestAnalysis, requestExtend,
  startWatching, stopWatching, watchedSearch,
} from "./store";
import { nextParisTime } from "../../lib/paris-time";
import { commuteOptions, RoutingQuotaError, routingAvailable } from "../../lib/travel";
import { logger } from "../../lib/logger";
import { costlyRateLimit } from "../../lib/quota";
import { wakeWorker } from "../../lib/worker-registry";

const router: IRouter = Router();

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
  res.status(201).json(CreateHousingSearchResponse.parse(await getPublicSearch(id)));
  wakeWorker(); // le worker serveur prend le relais ; le navigateur ne fait que suivre l'avancement
});

// Simple lecture : l'avancement ne dépend plus des appels du navigateur.
router.get("/housing/searches/:id", async (req, res): Promise<void> => {
  const params = GetHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  res.json(GetHousingSearchResponse.parse(await getPublicSearch(row.id)));
});

// « Étendre » : la page suivante, plus ancienne (35 annonces au plus, une lecture Apify).
router.post("/housing/searches/:id/refresh", costlyRateLimit, async (req, res): Promise<void> => {
  const params = RefreshHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  if (row.status !== "completed") {
    res.status(409).json({ error: "Attendez la fin de la recherche avant d’en chercher d’autres." });
    return;
  }
  if (!await requestExtend(row.id)) {
    res.status(409).json({ error: "Une lecture est déjà en cours." });
    return;
  }
  res.status(202).json(RefreshHousingSearchResponse.parse(await getPublicSearch(row.id)));
  wakeWorker();
});

// Annonces affichées en faisant défiler : leur analyse IA est faite en arrière-plan. Pas de costlyRateLimit : la
// dépense est bornée par les annonces déjà lues (une annonce n'est analysée qu'une fois, cache partagé).
router.post("/housing/searches/:id/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  const body = AnalyzeHousingSearchBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Requête invalide." }); return; }
  if (await requestAnalysis(row.id, body.data.listingIds)) wakeWorker();
  res.status(202).json(AnalyzeHousingSearchResponse.parse(await getPublicSearch(row.id)));
});

// Veille quotidienne : une seule par compte, aux heures choisies (heure de Paris).
router.put("/housing/searches/:id/watch", async (req, res): Promise<void> => {
  const params = WatchHousingSearchParams.safeParse(req.params);
  const body = WatchHousingSearchBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choisissez une ou deux heures de passage." }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  if (row.status === "failed") { res.status(409).json({ error: "Cette recherche n’a pas abouti : relancez-la avant de la suivre." }); return; }
  const times = [...new Set(body.data.times)].sort();
  await startWatching(row.id, req.userId!, times, nextParisTime(times, Date.now())!);
  res.json(WatchHousingSearchResponse.parse((await getSearch(row.id))!));
});

router.delete("/housing/searches/:id/watch", async (req, res): Promise<void> => {
  const params = UnwatchHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  await stopWatching(row.id, req.userId!);
  res.json(UnwatchHousingSearchResponse.parse((await getSearch(row.id))!));
});

router.post("/housing/searches/:id/visit", async (req, res): Promise<void> => {
  const params = VisitHousingSearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  if (!row) { res.status(404).json({ error: "Recherche introuvable." }); return; }
  await markVisited(row.id, req.userId!);
  res.status(204).end();
});

router.get("/housing/watch", async (req, res) => {
  res.json(GetWatchedSearchResponse.parse({ search: await watchedSearch(req.userId!) }));
});

// Trajets annonce → lieux de vie. Pas de costlyRateLimit : les trajets déjà calculés sont servis depuis la base,
// et chaque vrai appel Google est décompté d'un plafond quotidien dédié (lib/travel.ts).
router.get("/housing/searches/:id/listings/:listingId/routes", async (req, res): Promise<void> => {
  const params = GetListingRoutesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await getOwnedSearchRow(params.data.id, req.userId!);
  const search = row ? await getSearch(row.id) : null;
  const listing = search?.listings.find(item => item.id === params.data.listingId);
  if (!search || !listing) { res.status(404).json({ error: "Annonce introuvable." }); return; }
  if (!routingAvailable()) { res.status(503).json({ error: "Les temps de trajet ne sont pas disponibles." }); return; }
  const places = (search.criteria.places ?? []).filter(place => place.lat != null && place.lng != null);
  if (!isPrecise(listing) || !places.length) { res.json(GetListingRoutesResponse.parse({ routes: [] })); return; }
  const routes = [];
  for (const place of places) {
    try {
      const from = { lat: listing.lat, lng: listing.lng }, to = { lat: place.lat!, lng: place.lng! };
      for (const option of await commuteOptions(from, to, place.mode ?? null)) routes.push({ placeId: place.id, ...option });
    } catch (error) {
      if (error instanceof RoutingQuotaError) {
        if (!routes.length) { res.status(429).json({ error: "Trop de calculs de trajet aujourd’hui. Réessayez demain." }); return; }
        break;
      }
      logger.error({ err: error, searchId: search.id, listingId: listing.id }, "Travel route failed");
    }
  }
  res.json(GetListingRoutesResponse.parse({ routes }));
});

export default router;
