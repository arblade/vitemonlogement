// Banc d'essai Jev contre le LLM actuel, sur de vraies annonces. APPELS PAYANTS (Jev ≈ 0,04 $ / million de tokens,
// OpenAI ≈ 0,0013 $ / annonce) : à lancer à la main, jamais dans les tests.
//
//   pnpm --filter @workspace/api-server bench:jev -- --annoter bench/a-annoter.json
//       écrit les annonces (échantillons du dépôt, ou --annonces <fichier>) avec une vérité vide à remplir à la main :
//       pour chaque caractéristique : "yes", "no" ou "unstated" ; offer : "entire", "room", "non_dwelling" ou "unclear".
//   JEV_API_KEY=… OPENAI_API_KEY=… pnpm --filter @workspace/api-server bench:jev -- --verite bench/a-annoter.json [--sans-llm]
//       lance Jev (et le LLM pour comparer) et écrit le rapport dans reports/jev-bench-<date>.md.
//   pnpm --filter @workspace/api-server bench:jev -- --essai
//       vérifie le script avec un faux Jev local (aucun appel payant).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOGUE, sentenceWith } from "../src/routes/housing/catalogue";
import { readWithJev } from "../src/routes/housing/jev-reader";
import { analyze } from "../src/routes/housing/ai";
import { evaluateStructured } from "../src/routes/housing/criteria";
import { jevDecide, type JevDecide } from "../src/lib/jev";
import { memoryAnalysisCache } from "../src/lib/analysis-cache";
import type { Criteria, Listing } from "../src/routes/housing/store";

type Truth = { offer?: string; features: Record<string, "yes" | "no" | "unstated" | "">; wishes?: Record<string, "confirmed" | "contradicted" | "unknown" | ""> };
type BenchListing = { url: string; title: string; description: string; truth: Truth };

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const WISHES = ["balcon", "chat accepté", "parking", "cave", "lave-vaisselle", "calme"];

/** Annonces des échantillons du dépôt (Le Bon Coin, PAP, SeLoger), ou d'un fichier [{ url, title, description }]. */
function sampleListings(): BenchListing[] {
  const file = option("--annonces");
  if (file) return (JSON.parse(readFileSync(file, "utf8")) as BenchListing[]).map(item => ({ ...item, truth: item.truth ?? { features: {} } }));
  const read = (name: string) => JSON.parse(readFileSync(path.join(here, "../src/test", name), "utf8")) as Record<string, unknown>[];
  const str = (value: unknown) => typeof value === "string" ? value : "";
  return [
    ...read("leboncoin-fatih-sample.json").map(item => ({ url: str(item.url), title: str(item.title), description: str(item.description) })),
    ...read("leboncoin-clearpath-sample.json").map(item => ({ url: str(item.url), title: str(item.subject), description: str(item.body) })),
    ...read("pap-sample.json").map(item => ({ url: str(item.detailUrl), title: str(item.title), description: str(item.description) })),
    ...read("seloger-sample.json").map(item => ({ url: str(item.url), title: str(item.title), description: str(item.description) })),
  ].filter(item => item.description.length > 30).map(item => ({ ...item, truth: { offer: "", features: {} } }));
}

/** Faux Jev pour --essai : « oui » quand le mot-clé est là, 0,9 de confiance ; logement entier. */
const fakeJev: JevDecide = async (state, questions) => ({
  answers: Object.fromEntries(Object.keys(questions).map(name => [name, name === "offer"
    ? { choice: "entire", confidence: 0.9, probabilities: {} }
    : { choice: CATALOGUE.find(feature => feature.id === name && sentenceWith(state, feature.keyword)) ? "yes" : "unstated", confidence: 0.9, probabilities: {} }])),
  inputTokens: Math.ceil(state.length / 3.5) + 40 * Object.keys(questions).length,
});

const criteria: Criteria = { location: "", intent: "rent", keywords: "", radius: 5, wishes: WISHES };
const toListing = (item: BenchListing, id: number): Listing => ({
  id, source: "leboncoin", batch: "focused", title: item.title, url: item.url || `https://bench/${id}`, description: item.description,
  price: null, area: null, rooms: null, location: null, image: null, images: [], aiSummary: null, summaryEvidence: [], score: 60, features: [],
  lat: null, lng: null, geoPrecision: null, criterionResults: evaluateStructured(criteria, { price: null, area: null, rooms: null, location: null }, {}),
});

async function main() {
  const listings = sampleListings();
  const annotate = option("--annoter");
  if (annotate) {
    mkdirSync(path.dirname(path.resolve(annotate)), { recursive: true });
    const blank = Object.fromEntries(CATALOGUE.map(feature => [feature.id, ""]));
    writeFileSync(annotate, JSON.stringify(listings.map(item => ({ ...item, truth: { offer: "", features: blank, wishes: Object.fromEntries(WISHES.map(w => [w, ""])) } })), null, 2));
    console.log(`${listings.length} annonces à annoter dans ${annotate}`);
    return;
  }
  const trial = args.includes("--essai");
  const truthFile = option("--verite");
  const items = truthFile ? JSON.parse(readFileSync(truthFile, "utf8")) as BenchListing[] : listings;
  const decide = trial ? fakeJev : jevDecide;
  const withLlm = !trial && !args.includes("--sans-llm");
  const price = Number(process.env.JEV_PRICE_PER_M ?? 0.042);

  const rows: string[] = [];
  let tokens = 0, questions = 0, time = 0;
  const score = { decided: 0, right: 0, falseYes: 0, judged: 0 };
  const offerScore = { decided: 0, right: 0, judged: 0 };
  const llmAgreement = { compared: 0, same: 0 };
  for (const [index, item] of items.entries()) {
    const listing = toListing(item, index + 1);
    const started = Date.now();
    const reading = await readWithJev(listing, listing.criterionResults, decide);
    time += Date.now() - started;
    tokens += reading.inputTokens ?? 0;
    questions += reading.questions;
    for (const feature of reading.features) {
      const id = CATALOGUE.find(entry => entry.label === feature.label)?.id ?? "";
      const said = feature.value === "Non" ? "no" : "yes";
      const truth = item.truth?.features?.[id];
      score.decided++;
      if (truth) { score.judged++; if (truth === said) score.right++; if (said === "yes" && truth !== "yes") score.falseYes++; }
    }
    if (reading.offer) { offerScore.decided++; if (item.truth?.offer) { offerScore.judged++; if (item.truth.offer === reading.offer.kind) offerScore.right++; } }
    if (withLlm) {
      const [llm] = await analyze([toListing(item, index + 1)], criteria, { jev: null, cache: memoryAnalysisCache() });
      for (const check of llm.criterionResults.filter(result => result.id.startsWith("wish-"))) {
        const jevVerdict = Object.entries(reading.verdicts).find(([key]) => key.includes(check.label.toLocaleLowerCase("fr")))?.[1];
        if (!jevVerdict || check.status === "unknown") continue;
        llmAgreement.compared++;
        if (jevVerdict.status === check.status) llmAgreement.same++;
      }
    }
    rows.push(`| ${index + 1} | ${item.title.slice(0, 40).replace(/\|/g, "/")} | ${reading.offer?.kind ?? "—"} | ${reading.features.map(f => `${f.label}${f.value ? " : non" : ""}`).join(", ") || "—"} | ${reading.inputTokens ?? "?"} |`);
  }
  const pct = (a: number, b: number) => b ? `${Math.round(100 * a / b)} %` : "—";
  const report = [
    `# Banc d'essai Jev — ${new Date().toISOString().slice(0, 10)}${trial ? " (ESSAI, faux Jev : chiffres sans valeur)" : ""}`, "",
    `${items.length} annonces, ${questions} questions (${(questions / items.length).toFixed(1)} par annonce).`, "",
    "| Mesure | Valeur |", "|---|---|",
    `| Tokens d'entrée facturés par Jev | ${tokens} (${(tokens / items.length).toFixed(0)} par annonce) |`,
    `| Coût Jev estimé (${price} $ / M) | ${(tokens * price / 1e6).toFixed(5)} $ (${(tokens * price / 1e6 / items.length).toFixed(6)} $ par annonce ; LLM actuel ≈ 0,0013 $) |`,
    `| Temps moyen par annonce | ${(time / items.length).toFixed(0)} ms |`,
    `| Caractéristiques tranchées | ${score.decided} |`,
    `| Justes (sur annotées) | ${pct(score.right, score.judged)} (${score.right}/${score.judged}) |`,
    `| Faux « oui » (sur annotées) | ${score.falseYes} |`,
    `| Type d'offre tranché / juste | ${offerScore.decided} / ${pct(offerScore.right, offerScore.judged)} |`,
    withLlm ? `| Accord Jev / LLM sur les critères tranchés par les deux | ${pct(llmAgreement.same, llmAgreement.compared)} (${llmAgreement.same}/${llmAgreement.compared}) |` : "",
    "", "| # | Annonce | Offre | Caractéristiques (Jev) | Tokens |", "|---|---|---|---|---|", ...rows,
  ].filter(line => line !== "").join("\n");
  const out = path.join(here, "../../../reports", `jev-bench-${new Date().toISOString().slice(0, 10)}${trial ? "-essai" : ""}.md`);
  writeFileSync(out, `${report}\n`);
  console.log(report.split("\n").slice(0, 16).join("\n"));
  console.log(`\nRapport : ${out}`);
}

await main();
