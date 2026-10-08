// Banc d'essai de la pipeline « demande → critères → requête Le Bon Coin → lecture → analyse ». Voir src/bench/pipeline/README.md.
//
//   pnpm --filter @workspace/api-server bench:pipeline
//       aucun appel payant ; écrit reports/banc-pipeline-<date>.md et compare à la référence (baseline.json).
//   pnpm --filter @workspace/api-server bench:pipeline -- --maj-reference
//       enregistre l'état actuel comme référence (après une amélioration).
//   pnpm --filter @workspace/api-server bench:pipeline -- --cas paris-rayon,maison-jardin
//       seulement ces cas.
//   pnpm --filter @workspace/api-server bench:pipeline -- --simule
//       ignore les relevés réels, rejoue les réponses simulées (c'est ce que fait `pnpm test`).
//   OPENAI_API_KEY=… pnpm --filter @workspace/api-server bench:pipeline -- --live
//       APPEL PAYANT (gpt-5-mini, ≈ 0,001 $ par demande, ≈ 0,03 $ pour tout le banc) : interprète chaque demande avec le vrai
//       LLM et enregistre ses réponses dans enregistrements.json (rejouées ensuite sans frais). Sur demande explicite seulement.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CASES } from "../src/bench/pipeline/cases";
import { runBench, summarize, type Recording } from "../src/bench/pipeline/engine";
import { compareWithBaseline, markdownReport, toBaseline, type Baseline } from "../src/bench/pipeline/report";
import type { JsonLlm } from "../src/routes/housing/ai";

const here = path.dirname(fileURLToPath(import.meta.url));
const benchDir = path.join(here, "../src/bench/pipeline");
const baselineFile = path.join(benchDir, "baseline.json");
const recordingsFile = path.join(benchDir, "enregistrements.json");
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const readJson = <T>(file: string, fallback: T): T => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T : fallback;

async function liveLlm(recordings: Record<string, Recording>): Promise<JsonLlm> {
  const { default: OpenAI } = await import("openai");
  const { REASONING_EFFORT } = await import("../src/routes/housing/ai");
  if (!process.env.OPENAI_API_KEY) throw new Error("--live : OPENAI_API_KEY manquante.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  // Mêmes réglages que jsonResponse() dans ai.ts.
  return async (system, user) => {
    const response = await client.chat.completions.create({
      model: "gpt-5-mini", reasoning_effort: REASONING_EFFORT, max_completion_tokens: 8192,
      response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    const raw = JSON.parse(response.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    recordings[user] = { prompt: user, date: new Date().toISOString().slice(0, 10), model: "gpt-5-mini", raw };
    return structuredClone(raw);
  };
}

async function main() {
  const only = option("--cas")?.split(",");
  const cases = only ? CASES.filter(bench => only.includes(bench.id)) : CASES;
  const recordings = readJson<Record<string, Recording>>(recordingsFile, {});
  const live = args.includes("--live");
  // La référence (et `pnpm test`) porte sur les réponses simulées : seule une exécution simulée lui est comparée.
  const simulatedOnly = !live && (args.includes("--simule") || args.includes("--maj-reference") || !cases.some(bench => recordings[bench.prompt]));
  const results = await runBench(cases, {
    recordings: simulatedOnly ? undefined : recordings,
    liveLlm: live ? await liveLlm(recordings) : undefined,
  });
  if (live) writeFileSync(recordingsFile, `${JSON.stringify(recordings, null, 2)}\n`);

  const baseline = simulatedOnly ? readJson<Baseline | undefined>(baselineFile, undefined) : undefined;
  const date = new Date().toISOString().slice(0, 10);
  const reportsDir = path.join(here, "../../../reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportFile = path.join(reportsDir, `banc-pipeline-${date}${live ? "-live" : ""}.md`);
  writeFileSync(reportFile, `${markdownReport(results, { date, baseline })}\n`);

  const summary = summarize(results);
  console.log(`Banc pipeline : ${summary.casesPassing}/${summary.cases} cas réussis · contrôles ${summary.ok} ✅ ${summary.failed} ❌ ${summary.uncertain} ❔`);
  console.log(`Annonces attendues : ${summary.expectedVisible}, perdues ${summary.missed} (veille : ${summary.watchMissed}) ; montrées à tort : ${summary.wronglyShown}`);
  console.log(`Pertes par étape : ${JSON.stringify(summary.byStage)}`);
  for (const result of results) {
    const failed = result.checks.filter(check => check.status !== "ok");
    console.log(`${failed.some(c => c.status === "échec") ? "❌" : failed.length ? "❔" : "✅"} ${result.id}`);
    for (const check of failed) console.log(`     ${check.status === "échec" ? "❌" : "❔"} ${check.label} — ${check.detail}`);
  }
  console.log(`Rapport : ${path.relative(process.cwd(), reportFile)}`);
  if (args.includes("--maj-reference")) {
    if (only) throw new Error("--maj-reference : lancer sur tout le banc (sans --cas).");
    writeFileSync(baselineFile, `${JSON.stringify(toBaseline(results), null, 2)}\n`);
    console.log("Référence mise à jour.");
  } else if (!simulatedOnly) {
    console.log("Réponses réelles du LLM utilisées : pas de comparaison avec la référence (relancer avec --simule).");
  } else if (baseline) {
    const { regressions, progress } = compareWithBaseline(results, baseline);
    console.log(`Référence : ${progress.length} progrès, ${regressions.length} régressions.`);
    for (const check of regressions) console.log(`  RÉGRESSION ${check.id} — ${check.detail}`);
    if (regressions.length) process.exitCode = 1;
  }
}

main().catch(error => { console.error(error); process.exit(1); });
