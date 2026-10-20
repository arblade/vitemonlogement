/**
 * Moteur du banc d'essai : fait passer chaque cas par la vraie pipeline, étape par étape, sans aucun appel payant.
 *  1. interprétation : `interpret()` du code, avec la réponse du LLM rejouée (simulée ou relevée pour de vrai), puis
 *     `placeCriteria()` (lieux cités, centre de la recherche) avec un faux géocodeur ;
 *  2. requête : `actorRequest()` du code, décodée (centre, rayon, communes couvertes, filtres, mot-clé) ;
 *  3. recherche Le Bon Coin : MODÈLE du filtrage fait par le site (cercle, type, fourchettes, mot cherché) ;
 *  4. profondeur : 15 annonces lues en recherche ponctuelle, 4 jours (105 au plus) en veille quotidienne ;
 *  5. lecture sans IA : `normalize()` et les filtres du code (demandes, colocations, type de bien, bornes) ;
 *  6. analyse IA : `analyze()` du code avec une réponse simulée, puis `setAsideReason()` (annonce masquée ou non).
 * Seules les étapes 3 et 4 sont des modèles (comportement de Le Bon Coin) ; tout le reste est le code de l'application.
 */
import communes from "../../data/communes.json";
import { interpret, analyze, type JsonLlm } from "../../routes/housing/ai";
import { placeCriteria } from "../../routes/housing/anchor";
import { placeReachKm } from "../../lib/distance";
import { actorRequest, canReadPages, focusedSearchTerm, LEBONCOIN_ACTORS } from "../../routes/housing/housing-search";
import { fromFatihRecord, isDwellingType, normalize } from "../../routes/housing/apify";
import { apiValue, contradictsDeclared, matchesKnownBasics } from "../../routes/housing/criteria";
import { declaredType, matchesPropertyType } from "../../routes/housing/property-type";
import { isColocationAd, isSeekerAd } from "../../routes/housing/offer";
import { liveDays, maxPages, oneShotLimit, PAGE_SIZE, setAsideReason } from "../../routes/housing/reader";
import { resolvePlace } from "../../lib/places";
import { memoryAnalysisCache } from "../../lib/analysis-cache";
import { fatihRecord } from "../../test/fatih";
import { first, text } from "../../routes/housing/parse";
import type { Criteria, Listing } from "../../routes/housing/store";
import type { AdOutcome, BenchAd, BenchCase, CaseResult, Check, Stage } from "./types";

type Row = [string, string, string[], string, number, number, number];

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Communes dont le centre est dans le cercle de recherche (les plus peuplées d'abord). */
export function communesWithin(center: { lat: number; lon: number }, radiusKm: number) {
  const inside = (communes as Row[]).filter(([, , , , , lon, lat]) => distanceKm(center, { lat, lon }) <= radiusKm)
    .sort((a, b) => b[4] - a[4]);
  return { count: inside.length, names: inside.slice(0, 8).map(row => row[1]) };
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr");

/** Requête décodée : acteur, paramètres de l'URL Le Bon Coin, centre et rayon. */
export function decodeQuery(criteria: Criteria) {
  const request = actorRequest(criteria, oneShotLimit(), "0.10", 120);
  const input = JSON.parse(request.input) as Record<string, unknown>;
  const actor = request.path.includes(LEBONCOIN_ACTORS.url) ? "url" : "byName";
  const url = actor === "url" ? String((input.startUrls as string[])[0]) : null;
  const params: Record<string, string> = url ? Object.fromEntries(new URL(url).searchParams) : Object.fromEntries(
    Object.entries(input).filter(([key]) => !["mode", "includeSeller", "includePhone", "shippable", "category"].includes(key)).map(([key, value]) => [key, String(value)]));
  let center: { name: string; lat: number; lon: number } | null = null;
  let radiusKm = Math.max(0, Math.min(200, criteria.radius ?? 5));
  if (url) {
    const [name, , , lat, lon, radius] = params.locations.split("_");
    // Centre déplacé sur un lieu cité (« à 20 min du CHU ») : le nom reste celui de la ville.
    const commune = resolvePlace(criteria.location);
    const moved = commune.status === "resolved" && distanceKm(commune.commune, { lat: Number(lat), lon: Number(lon) }) > 0.05;
    center = { name: moved ? `${name}, lieu cité` : name, lat: Number(lat), lon: Number(lon) };
    radiusKm = Number(radius) / 1000;
  }
  return { actor, url, params, center, radiusKm };
}

const range = (value: string | undefined) => {
  if (!value) return null;
  const [low, high] = value.split("-");
  return { min: low === "min" ? null : Number(low), max: high === "max" ? null : Number(high) };
};
const inRange = (value: number | undefined, bounds: ReturnType<typeof range>) =>
  bounds == null || (value != null && (bounds.min == null || value >= bounds.min) && (bounds.max == null || value <= bounds.max));

/**
 * MODÈLE de la recherche faite par Le Bon Coin (ce n'est pas notre code) : cercle autour du centre, type de bien,
 * fourchettes de pièces, surface et prix (une annonce sans la valeur est supposée écartée), mot cherché dans le titre
 * et la description (début de mot, sans accents). Renvoie la raison d'exclusion, ou null.
 */
export function leboncoinFilter(ad: BenchAd, query: ReturnType<typeof decodeQuery>, criteria: Criteria): { reason: string; uncertain: boolean } | null {
  const point = { lat: ad.lat, lon: ad.lng };
  if (query.actor === "byName") {
    // Acteur de secours (ville non reconnue) : il cherche le lieu par son nom ; son interprétation n'est pas connue.
    const place = resolvePlace(criteria.location);
    if (place.status !== "resolved") return { reason: `lieu « ${criteria.location} » non reconnu : recherche par nom (acteur de secours), zone réellement couverte inconnue`, uncertain: true };
    if (distanceKm({ lat: place.commune.lat, lon: place.commune.lon }, point) > query.radiusKm) return { reason: `hors du rayon de ${query.radiusKm} km (acteur de secours)`, uncertain: true };
    const max = Number(query.params.price_max_filter), min = Number(query.params.price_min_filter);
    if (Number.isFinite(max) && ad.price > max) return { reason: `loyer ${ad.price} € > ${max} € (filtre du site)`, uncertain: false };
    if (Number.isFinite(min) && ad.price < min) return { reason: `loyer ${ad.price} € < ${min} € (filtre du site)`, uncertain: false };
    return null;
  }
  const distance = distanceKm(query.center!, point);
  if (distance > query.radiusKm) return { reason: `à ${distance.toFixed(1)} km du centre (${query.center!.name}), rayon ${Math.round(query.radiusKm * 10) / 10} km`, uncertain: false };
  const types = query.params.real_estate_type?.split(",") ?? [];
  if (types.length && !types.includes(ad.realEstateType ?? "2")) return { reason: `type ${ad.realEstateType ?? "2"} hors de real_estate_type=${types.join(",")}`, uncertain: false };
  const bounds: [string, number | undefined, string][] = [["rooms", ad.rooms, "pièces"], ["square", ad.area, "m²"], ["price", ad.price, "€"]];
  for (const [key, value, unit] of bounds) {
    const wanted = range(query.params[key]);
    if (!inRange(value, wanted)) return { reason: value == null ? `${key} absent de l'annonce, filtre ${key}=${query.params[key]} (hypothèse : écartée)` : `${value} ${unit} hors de ${key}=${query.params[key]}`, uncertain: value == null };
  }
  const term = query.params.text;
  if (term && !new RegExp(`(^|[^a-z0-9])${fold(term)}`).test(fold(`${ad.title} ${ad.description}`))) return { reason: `le mot « ${term} » n'apparaît pas dans l'annonce (text=${term})`, uncertain: false };
  return null;
}

/** Enregistrement Le Bon Coin (acteur `fatihtahta`) de l'annonce du banc. */
export function benchRecord(ad: BenchAd, index: number) {
  const record = fatihRecord({
    url: `https://www.leboncoin.fr/ad/locations/${9_000_000_000 + index}`, title: ad.title, description: ad.description, price: ad.price,
    area: ad.area, rooms: ad.rooms, realEstateType: ad.realEstateType, city: ad.city, zipcode: ad.zipcode, lat: ad.lat, lng: ad.lng,
    type: "city", bedrooms: ad.bedrooms, energyRate: ad.energyRate, postedAt: "2026-10-07T10:00:00.000Z",
  });
  if (!ad.attributes) return record;
  const source = JSON.parse(record.source_data) as { attributes: { key: string; value: string; value_label?: string }[] };
  for (const [key, value] of Object.entries(ad.attributes)) source.attributes.push({ key, value, value_label: value });
  return { ...record, source_data: JSON.stringify(source) };
}

/** Pourquoi `normalize()` a rendu null : les mêmes contrôles, un par un. */
function rejectionReason(record: ReturnType<typeof benchRecord>, criteria: Criteria): string {
  const data = fromFatihRecord(record);
  if (!data) return "pas une location";
  const title = text(data.subject), description = text(data.body);
  if (!isDwellingType(data)) return "type non habitable (parking, terrain)";
  const declared = declaredType(text(first(data, ["real_estate_type"])) || text(apiValue({ attributes: data.attributes }, "real_estate_type")));
  if (!matchesPropertyType(criteria.propertyType, declared, title)) return `type déclaré « ${declared} » ≠ ${criteria.propertyType} demandé`;
  if (isSeekerAd({ adType: data.ad_type, title, description })) return "prise pour une demande de logement (offer.ts : isSeekerAd)";
  if (isColocationAd({ title, description })) return "prise pour une colocation ou une chambre (offer.ts : isColocationAd)";
  return "écartée par normalize()";
}

/** Réponse simulée de l'IA d'analyse : logement entier, aucun critère tranché, sauf ce que l'annonce du banc précise. */
function analysisLlm(ad: BenchAd): JsonLlm {
  return async (_system, user) => {
    const { listings } = JSON.parse(user) as { listings: { id: number }[] };
    return { items: listings.map(({ id }) => ({ id, checks: [], offer: "entire", ...ad.analysis })) };
  };
}

/** Faux géocodeur (IGN, Nominatim) : seuls les lieux déclarés par le cas sont trouvés. */
export function benchGeocoder(bench: Pick<BenchCase, "geocoding">): typeof fetch {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname.includes("nominatim")) return json([]);
    const query = url.searchParams.get("q") ?? "";
    const hit = (bench.geocoding ?? []).find(entry => fold(query).includes(fold(entry.match)));
    if (!hit) return json({ features: [] });
    // Nom du lieu = la requête : le contrôle « chaque mot demandé est dans le résultat » (lieux repères) passe.
    return json({ features: [{ geometry: { coordinates: [hit.lng, hit.lat] }, properties: {
      score: 0.9, type: "poi", toponym: query, category: ["équipement"], city: [hit.city], depcode: [hit.depcode], label: `${hit.match}, ${hit.city}`,
    } }] });
  }) as typeof fetch;
}

export type Recording = { prompt: string; date: string; model: string; raw: Record<string, unknown> };
export type RunOptions = {
  /** Réponses réelles du LLM d'interprétation, par demande : elles remplacent la réponse simulée du cas. */
  recordings?: Record<string, Recording>;
  /** Interprétation par un vrai LLM (--live) : appelée à la place de la réponse rejouée. */
  liveLlm?: JsonLlm;
};

const show = (value: unknown) => value === undefined ? "—" : JSON.stringify(value);

function interpretationChecks(bench: BenchCase, criteria: Criteria, query: ReturnType<typeof decodeQuery>): Check[] {
  const expect = bench.expect ?? {};
  const checks: Check[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string) => checks.push({ id: `${bench.id}/interprétation/${key}`, label, status: ok ? "ok" : "échec", detail });
  const fields = ["location", "propertyType", "minPrice", "maxPrice", "minArea", "maxArea", "minRooms", "maxRooms", "minBedrooms", "minEnergyClass"] as const;
  for (const field of fields) {
    if (!(field in expect)) continue;
    const wanted = expect[field] ?? null, got = criteria[field] ?? null;
    add(field, field, wanted === got, `attendu ${show(wanted)}, obtenu ${show(got)}`);
  }
  if (expect.resolved !== undefined) {
    const resolution = resolvePlace(criteria.location);
    add("lieu-reconnu", "lieu reconnu", (resolution.status === "resolved") === expect.resolved,
      `« ${criteria.location} » : ${resolution.status === "resolved" ? `commune ${resolution.commune.name} (${resolution.commune.department})` : resolution.status === "ambiguous" ? `ambigu (${resolution.candidates.length} communes)` : "inconnu"} → acteur ${query.actor === "url" ? "URL (filtres complets, pages)" : "de secours (recherche par nom, sans type ni pièces ni surface)"}`);
  }
  if (expect.radiusAtLeast !== undefined) add("rayon", "rayon", query.radiusKm >= expect.radiusAtLeast, `attendu ≥ ${expect.radiusAtLeast} km, obtenu ${query.radiusKm} km`);
  if (expect.searchText !== undefined) {
    const term = focusedSearchTerm(criteria);
    add("mot-cherché", "mot cherché (text=)", term === expect.searchText, `attendu ${show(expect.searchText)}, obtenu ${show(term)}`);
  }
  for (const pattern of expect.wishes ?? []) {
    const found = (criteria.wishes ?? []).some(wish => new RegExp(pattern, "i").test(wish));
    add(`souhait:${pattern}`, `souhait /${pattern}/`, found, `souhaits : ${show(criteria.wishes ?? [])}`);
  }
  for (const pattern of expect.noWishes ?? []) {
    const found = (criteria.wishes ?? []).some(wish => new RegExp(pattern, "i").test(wish));
    add(`sans-souhait:${pattern}`, `pas de souhait /${pattern}/`, !found, `souhaits : ${show(criteria.wishes ?? [])}`);
  }
  return checks;
}

async function adOutcome(ad: BenchAd, index: number, criteria: Criteria, query: ReturnType<typeof decodeQuery>): Promise<AdOutcome> {
  const base = { id: ad.id, note: ad.note, expected: ad.expected, distanceKm: query.center ? Math.round(distanceKm(query.center, { lat: ad.lat, lon: ad.lng }) * 10) / 10 : null };
  const lost = (stage: Stage, reason: string, uncertain = false, watchStage: Stage = stage): AdOutcome => ({ ...base, stage, reason, watchStage, uncertain });
  const site = leboncoinFilter(ad, query, criteria);
  if (site) return lost("recherche Le Bon Coin", site.reason, site.uncertain);
  const rank = ad.rank ?? 1, age = ad.ageDays ?? 0.5;
  const oneShot = rank > oneShotLimit();
  const pages = canReadPages(criteria);
  const watchDepth = pages ? PAGE_SIZE * maxPages() : oneShotLimit();
  const watchMissed = (pages && age > liveDays()) || rank > watchDepth;
  const record = benchRecord(ad, index);
  const listing = normalize(record, criteria);
  if (!listing) return lost("lecture sans IA", rejectionReason(record, criteria));
  if (!matchesKnownBasics(listing, criteria)) return lost("lecture sans IA", "prix, surface ou pièces hors bornes (matchesKnownBasics)");
  if (contradictsDeclared(listing)) return lost("lecture sans IA", "chambres ou DPE déclarés contraires (contradictsDeclared)");
  const [observations] = await analyze([{ ...listing, id: index + 1 } as Listing], criteria, { llm: analysisLlm(ad), cache: memoryAnalysisCache(), jev: null });
  const setAside = setAsideReason(observations);
  if (setAside) return lost("analyse IA", `masquée par l'analyse (${setAside})${observations.offer?.evidence ? ` : « ${observations.offer.evidence} »` : ""}`);
  const watchStage: Stage = watchMissed ? "profondeur de lecture" : "visible";
  if (oneShot) return { ...base, stage: "profondeur de lecture", watchStage, uncertain: false,
    reason: `rang ${rank} dans la liste Le Bon Coin : la recherche ponctuelle ne lit que les ${oneShotLimit()} plus récentes${watchMissed ? ` ; la veille non plus (${age} jours, ${watchDepth} annonces au plus)` : " ; la veille la trouverait"}` };
  return { ...base, stage: "visible", watchStage, uncertain: false, reason: watchMissed ? "visible en recherche ponctuelle" : "" };
}

export async function runCase(bench: BenchCase, options: RunOptions = {}): Promise<CaseResult> {
  const recorded = options.recordings?.[bench.prompt];
  let llmOrigin = recorded ? `relevé réel (${recorded.model}, ${recorded.date})` : bench.llm.origin;
  const replay: JsonLlm = async () => structuredClone(recorded?.raw ?? bench.llm.raw);
  if (options.liveLlm) llmOrigin = "réel (en direct)";
  // Comme pipeline.ts : interprétation, puis lieux cités (géocodage, ville et centre de la recherche).
  const criteria = await placeCriteria(bench.prompt, await interpret(bench.prompt, options.liveLlm ?? replay), benchGeocoder(bench));
  const query = decodeQuery(criteria);
  const checks = interpretationChecks(bench, criteria, query);
  const ads: AdOutcome[] = [];
  for (const [index, ad] of bench.ads.entries()) {
    const outcome = await adOutcome(ad, index, criteria, query);
    ads.push(outcome);
    const shown = outcome.stage === "visible";
    const ok = ad.expected === "visible" ? shown : !shown;
    checks.push({
      id: `${bench.id}/annonce/${ad.id}`, label: `annonce « ${ad.id} » ${ad.expected}`,
      status: ok ? "ok" : outcome.uncertain ? "incertain" : "échec",
      detail: shown ? "visible" : `perdue à l'étape « ${outcome.stage} » : ${outcome.reason}`,
    });
  }
  const { places: _places, checks: _checks, ...shownCriteria } = criteria;
  return {
    id: bench.id, theme: bench.theme, title: bench.title, prompt: bench.prompt, why: bench.why, llmOrigin,
    criteria: { ...shownCriteria, places: (criteria.places ?? []).map(place => [
      `${place.label} : ${place.address}`, place.mode ? `(${place.mode})` : "",
      place.maxMinutes != null ? `≤ ${place.maxMinutes} min` : "", place.maxKm != null ? `≤ ${place.maxKm} km` : "",
      place.lat != null ? `→ trouvé (${place.lat.toFixed(4)}, ${place.lng!.toFixed(4)})` : "→ non trouvé",
      place.centered ? "· centre de la recherche" : "", placeReachKm(place) != null ? `· portée ${placeReachKm(place)!.toFixed(1)} km` : "",
    ].filter(Boolean).join(" ")) },
    query: { actor: query.actor, url: query.url, params: query.params, center: query.center, radiusKm: query.radiusKm,
      communes: query.center ? communesWithin(query.center, query.radiusKm) : { count: 0, names: [] } },
    checks, ads,
  };
}

export async function runBench(cases: BenchCase[], options: RunOptions = {}) {
  const results: CaseResult[] = [];
  for (const bench of cases) results.push(await runCase(bench, options));
  return results;
}

/** Bilan : par statut, par étape où les annonces attendues sont perdues. */
export function summarize(results: CaseResult[]) {
  const checks = results.flatMap(result => result.checks);
  const count = (status: Check["status"]) => checks.filter(check => check.status === status).length;
  const missed = results.flatMap(result => result.ads.filter(ad => ad.expected === "visible" && ad.stage !== "visible"));
  const wronglyShown = results.flatMap(result => result.ads.filter(ad => ad.expected === "écartée" && ad.stage === "visible"));
  const byStage: Record<string, number> = {};
  for (const ad of missed) byStage[ad.stage] = (byStage[ad.stage] ?? 0) + 1;
  const expectedVisible = results.flatMap(result => result.ads.filter(ad => ad.expected === "visible"));
  return {
    cases: results.length, checks: checks.length, ok: count("ok"), failed: count("échec"), uncertain: count("incertain"),
    casesPassing: results.filter(result => result.checks.every(check => check.status === "ok")).length,
    expectedVisible: expectedVisible.length, missed: missed.length, wronglyShown: wronglyShown.length,
    watchMissed: expectedVisible.filter(ad => ad.watchStage !== "visible").length, byStage,
  };
}
