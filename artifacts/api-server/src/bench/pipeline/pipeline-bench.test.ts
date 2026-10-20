import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CASES } from "./cases";
import { benchRecord, decodeQuery, distanceKm, leboncoinFilter, runBench, runCase } from "./engine";
import { compareWithBaseline, type Baseline } from "./report";
import { setAsideReason } from "../../routes/housing/reader";
import type { BenchAd, BenchCase } from "./types";
import type { Criteria } from "../../routes/housing/store";

// Banc d'essai de la pipeline (voir README.md) : réponses du LLM rejouées, aucun appel payant.
const baseline = JSON.parse(readFileSync(new URL("./baseline.json", import.meta.url), "utf8")) as Baseline;

test("banc pipeline : aucun contrôle qui passait dans la référence ne régresse", async () => {
  const results = await runBench(CASES);
  const { regressions, added } = compareWithBaseline(results, baseline);
  assert.deepEqual(regressions.map(check => `${check.id} — ${check.detail}`), [],
    "régression : corriger, ou si c'est voulu, mettre à jour la référence (pnpm --filter @workspace/api-server bench:pipeline -- --maj-reference)");
  assert.deepEqual(added.map(check => check.id), [], "contrôles absents de la référence : la mettre à jour (--maj-reference)");
});

test("banc pipeline : identifiants de cas et d'annonces uniques", () => {
  assert.equal(new Set(CASES.map(bench => bench.id)).size, CASES.length);
  for (const bench of CASES) assert.equal(new Set(bench.ads.map(ad => ad.id)).size, bench.ads.length, bench.id);
});

const lille: Criteria = { location: "Lille", intent: "rent", keywords: "", radius: 5, maxPrice: 800, minRooms: 2, maxRooms: 2 };
const ad = (fields: Partial<BenchAd>): BenchAd => ({ id: "a", note: "", title: "T2", description: "Appartement.", price: 700, area: 40, rooms: 2, lat: 50.6365, lng: 3.0635, expected: "visible", ...fields });

test("banc pipeline : modèle du filtre Le Bon Coin (rayon, fourchettes, mot obligatoire)", () => {
  const query = decodeQuery(lille);
  assert.equal(query.actor, "url");
  assert.equal(query.radiusKm, 5);
  assert.equal(query.params.price, "min-800");
  assert.equal(leboncoinFilter(ad({}), query, lille), null);
  assert.match(leboncoinFilter(ad({ lat: 50.6362, lng: 3.1619 }), query, lille)!.reason, /8\.1 km/); // Villeneuve-d'Ascq
  assert.match(leboncoinFilter(ad({ price: 820 }), query, lille)!.reason, /820 €/);
  assert.match(leboncoinFilter(ad({ rooms: 3 }), query, lille)!.reason, /pièces/);
  const withTerm = decodeQuery({ ...lille, wishes: ["balcon"] });
  assert.equal(withTerm.params.text, "balcon");
  assert.match(leboncoinFilter(ad({ description: "Belle terrasse." }), withTerm, lille)!.reason, /balcon/);
  assert.equal(leboncoinFilter(ad({ description: "Deux balcons." }), withTerm, lille), null);
  // Lieu non reconnu : acteur de secours, résultat « incertain ».
  const unknown = { ...lille, location: "Lille, France" };
  assert.equal(leboncoinFilter(ad({}), decodeQuery(unknown), unknown)!.uncertain, true);
  assert.ok(Math.abs(distanceKm({ lat: 48.8589, lon: 2.347 }, { lat: 48.8478, lon: 2.26 }) - 6.5) < 0.2);
});

test("banc pipeline : l'étape où une annonce est perdue est bien attribuée", async () => {
  const bench: BenchCase = {
    id: "essai", theme: "essai", title: "essai", prompt: "T2 à Lille, 800 € maximum",
    llm: { origin: "simulée", raw: { location: "Lille", maxPrice: 800, minRooms: 2, maxRooms: 2, radius: 5, keywords: "", uncertainChecks: [] } },
    expect: { location: "Lille", maxPrice: 800, maxArea: 30 },
    ads: [
      ad({ id: "ok" }),
      ad({ id: "loin", lat: 50.6887, lng: 3.1843 }),
      ad({ id: "profond", rank: 30, ageDays: 2 }),
      ad({ id: "demande", title: "Recherche T2", description: "Couple cherche un T2." , expected: "écartée" }),
      ad({ id: "chambre", description: "Je loue une chambre dans mon T2.", analysis: { offer: "room", offerEvidence: "Je loue une chambre dans mon T2." } }),
    ],
  };
  const result = await runCase(bench);
  const stage = (id: string) => result.ads.find(outcome => outcome.id === id)!;
  assert.equal(stage("ok").stage, "visible");
  assert.equal(stage("loin").stage, "recherche Le Bon Coin");
  assert.equal(stage("profond").stage, "profondeur de lecture");
  assert.equal(stage("profond").watchStage, "visible");
  assert.equal(stage("demande").stage, "lecture sans IA");
  assert.equal(stage("chambre").stage, "analyse IA");
  const status = (suffix: string) => result.checks.find(check => check.id.endsWith(suffix))!.status;
  assert.equal(status("/interprétation/maxPrice"), "ok");
  assert.equal(status("/interprétation/maxArea"), "échec");
  assert.equal(status("/annonce/demande"), "ok");
  assert.equal(status("/annonce/loin"), "échec");
  // Un relevé réel du LLM remplace la réponse simulée.
  const recorded = await runCase(bench, { recordings: { [bench.prompt]: { prompt: bench.prompt, date: "2026-10-08", model: "gpt-5-mini", raw: { location: "Roubaix", radius: 5 } } } });
  assert.equal(recorded.criteria.location, "Roubaix");
  assert.match(recorded.llmOrigin, /relevé réel/);
});

test("banc pipeline : l'annonce du banc est lue par le vrai code (normalize) avec ses champs en plus", async () => {
  const record = benchRecord(ad({ attributes: { nb_parkings: "1" }, bedrooms: 1 }), 0);
  const attributes = (JSON.parse(record.source_data) as { attributes: { key: string }[] }).attributes.map(a => a.key);
  assert.ok(attributes.includes("nb_parkings") && attributes.includes("bedrooms"));
});

test("setAsideReason : chambre ou local cité, ou chiffres contredits par la description", () => {
  const offer = (kind: "entire" | "room" | "non_dwelling" | "unclear") => ({ kind, evidence: "x" });
  const check = (id: string, status: "confirmed" | "contradicted", source: "api" | "description") => ({ id, label: id, status, source, value: "", evidence: "" });
  assert.equal(setAsideReason({ offer: offer("room"), criterionResults: [] }), "room");
  assert.equal(setAsideReason({ offer: offer("non_dwelling"), criterionResults: [] }), "non_dwelling");
  assert.equal(setAsideReason({ offer: offer("unclear"), criterionResults: [check("area", "contradicted", "description")] }), "mismatch");
  assert.equal(setAsideReason({ offer: offer("entire"), criterionResults: [check("area", "contradicted", "api"), check("wish-1", "contradicted", "description")] }), null);
  assert.equal(setAsideReason({ offer: null, criterionResults: [] }), null);
});
