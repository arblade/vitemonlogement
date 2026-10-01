import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { analyze, ANALYSIS_VERSION, type JsonLlm } from "./ai";
import { evaluateStructured } from "./criteria";
import { dbAnalysisCache, memoryAnalysisCache } from "../../lib/analysis-cache";
import { closeDatabase } from "../../lib/database";
import { useMemoryDatabase } from "../../test/helpers";
import type { Criteria, Listing } from "./store";

const description = "Beau studio lumineux au 3e étage avec ascenseur. Les chats sont acceptés. Loyer 590 € charges comprises.";
const criteriaOf = (wishes: string[]): Criteria => ({ location: "Lille", intent: "rent", keywords: "", radius: 5, maxPrice: 700, wishes });

function listingOf(url: string, criteria: Criteria, id = -1, text = description): Listing {
  const base = { price: 590, area: 25, rooms: 1, location: "Lille" };
  return {
    id, source: "leboncoin", batch: "focused", title: "Studio Lille", url, description: text, ...base, image: null, images: [],
    aiSummary: null, summaryEvidence: [], score: 60, features: [],
    criterionResults: evaluateStructured(criteria, base, {}), lat: null, lng: null, geoPrecision: null,
  };
}

/** LLM factice : répond pour les critères demandés en citant le texte, et compte ses appels. */
function fakeLlm() {
  const calls: { asked: string[]; wantGeneral: boolean[] }[] = [];
  const llm: JsonLlm = async (_system, user) => {
    const { listings } = JSON.parse(user) as { listings: { id: number; toVerify: { id: string; label: string }[]; wantGeneral: boolean }[] };
    calls.push({ asked: listings.flatMap(item => item.toVerify.map(check => check.label)), wantGeneral: listings.map(item => item.wantGeneral) });
    return {
      items: listings.map(item => ({
        id: item.id,
        checks: item.toVerify.map(check => /chat/i.test(check.label)
          ? { id: check.id, status: "confirmed", value: "Chats acceptés", evidence: "Les chats sont acceptés" }
          : { id: check.id, status: "unknown", value: "", evidence: "" }),
        ...(item.wantGeneral ? {
          summary: "Studio au 3e étage avec ascenseur.", summaryEvidence: ["au 3e étage avec ascenseur"],
          features: [{ label: "Étage", value: "3e", evidence: "au 3e étage" }],
        } : {}),
      })),
    };
  };
  return { llm, calls };
}

test("une annonce déjà analysée n'est plus renvoyée au LLM (même critère, autre recherche)", async () => {
  const cache = memoryAnalysisCache();
  const { llm, calls } = fakeLlm();
  const first = criteriaOf(["chat accepté"]);
  const a = await analyze([listingOf("https://www.leboncoin.fr/ad/locations/1", first)], first, { llm, cache });
  assert.equal(calls.length, 1);
  assert.equal(a[0].criterionResults.find(check => check.id === "wish-1")?.status, "confirmed");
  assert.equal(a[0].aiSummary, "Studio au 3e étage avec ascenseur.");

  // Autre recherche : « chat accepté » n'a plus le même id (wish-2) mais le même libellé, avec des accents/majuscules différents.
  const second = criteriaOf(["budget serré", "Chat Accepté"]);
  const b = await analyze([listingOf("https://www.leboncoin.fr/ad/locations/1/", second, -7)], second, { llm, cache });
  assert.equal(calls.length, 2, "seul le nouveau critère est posé");
  assert.deepEqual(calls[1].asked, ["budget serré"]);
  assert.deepEqual(calls[1].wantGeneral, [false], "l'extraction générale est déjà en cache");
  assert.equal(b[0].criterionResults.find(check => check.label === "Chat Accepté")?.status, "confirmed");
  assert.equal(b[0].aiSummary, "Studio au 3e étage avec ascenseur.");

  const c = await analyze([listingOf("https://www.leboncoin.fr/ad/locations/1", second)], second, { llm, cache });
  assert.equal(calls.length, 2, "tout est en cache : aucun appel LLM");
  assert.equal(c[0].features[0]?.label, "Étage");
});

test("une nouvelle version d'analyse ré-analyse l'annonce", async () => {
  const cache = memoryAnalysisCache();
  const { llm, calls } = fakeLlm();
  const criteria = criteriaOf(["chat accepté"]);
  const listing = () => listingOf("https://www.leboncoin.fr/ad/locations/2", criteria);
  await analyze([listing()], criteria, { llm, cache, version: 1 });
  await analyze([listing()], criteria, { llm, cache, version: 1 });
  assert.equal(calls.length, 1);
  await analyze([listing()], criteria, { llm, cache, version: 2 });
  assert.equal(calls.length, 2, "la V2 relance l'analyse");
  assert.ok(ANALYSIS_VERSION >= 1);
});

test("une annonce modifiée est ré-analysée", async () => {
  const cache = memoryAnalysisCache();
  const { llm, calls } = fakeLlm();
  const criteria = criteriaOf(["chat accepté"]);
  await analyze([listingOf("https://www.leboncoin.fr/ad/locations/3", criteria)], criteria, { llm, cache });
  await analyze([listingOf("https://www.leboncoin.fr/ad/locations/3", criteria, -1, description + " Disponible de suite.")], criteria, { llm, cache });
  assert.equal(calls.length, 2);
});

test("une citation inventée est refusée et « inconnu » est mémorisé (pas reposé)", async () => {
  const cache = memoryAnalysisCache();
  const criteria = criteriaOf(["piscine"]);
  let count = 0;
  const llm: JsonLlm = async (_system, user) => {
    count++;
    const { listings } = JSON.parse(user) as { listings: { id: number; toVerify: { id: string }[] }[] };
    return { items: listings.map(item => ({ id: item.id, checks: item.toVerify.map(check => ({ id: check.id, status: "confirmed", value: "Piscine", evidence: "Piscine privée chauffée" })) })) };
  };
  const listing = () => listingOf("https://www.leboncoin.fr/ad/locations/4", criteria);
  const first = await analyze([listing()], criteria, { llm, cache });
  assert.equal(first[0].criterionResults.find(check => check.id === "wish-1")?.status, "unknown");
  await analyze([listing()], criteria, { llm, cache });
  assert.equal(count, 1);
});

test("une réponse incomplète du LLM n'est pas mémorisée : l'annonce sera reposée", async () => {
  const cache = memoryAnalysisCache();
  const criteria = criteriaOf(["chat accepté"]);
  let count = 0;
  const llm: JsonLlm = async () => { count++; return { items: [] }; };
  const listing = () => listingOf("https://www.leboncoin.fr/ad/locations/5", criteria);
  await analyze([listing()], criteria, { llm, cache });
  await analyze([listing()], criteria, { llm, cache });
  assert.equal(count, 2);
});

test("les valeurs API priment : un critère structuré n'est jamais envoyé au LLM", async () => {
  const cache = memoryAnalysisCache();
  const { llm, calls } = fakeLlm();
  const criteria = criteriaOf([]);
  const out = await analyze([listingOf("https://www.leboncoin.fr/ad/locations/6", criteria)], criteria, { llm, cache });
  assert.deepEqual(calls[0].asked, []);
  assert.equal(out[0].criterionResults.find(check => check.id === "price")?.source, "api");
});

test("le cache en base est isolé par version et par texte", async t => {
  await useMemoryDatabase();
  after(closeDatabase);
  const key = { urlKey: "https://www.leboncoin.fr/ad/locations/9", descriptionHash: "h1" };
  await dbAnalysisCache.save([{ ...key, general: { summary: "s", summaryEvidence: ["e"], features: [] }, verdicts: { chat: { status: "confirmed", value: "v", evidence: "e" } } }], 1);
  assert.equal((await dbAnalysisCache.load([key], 1)).get(key.urlKey)?.verdicts.chat?.status, "confirmed");
  assert.equal((await dbAnalysisCache.load([key], 2)).size, 0, "version différente : rien");
  assert.equal((await dbAnalysisCache.load([{ ...key, descriptionHash: "h2" }], 1)).size, 0, "texte différent : rien");
  await dbAnalysisCache.save([{ ...key, verdicts: { balcon: { status: "unknown", value: "", evidence: "" } } }], 1);
  const merged = (await dbAnalysisCache.load([key], 1)).get(key.urlKey)!;
  assert.deepEqual(Object.keys(merged.verdicts).sort(), ["balcon", "chat"], "les verdicts s'accumulent");
  assert.equal(merged.general?.summary, "s", "l'extraction générale est conservée");
  void t;
});
