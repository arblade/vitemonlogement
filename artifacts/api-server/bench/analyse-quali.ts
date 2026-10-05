// Analyse de l'étude qualitative (bench/etude-quali.ts), gratuite : lit bench/etude-quali-cache.json.
//   node --import tsx bench/analyse-quali.ts  → reports/etude-jev-qualitatif-<date>.md + bench/desaccords-quali.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadItems, textOf } from "./etude";
import { QUALI, qualiCache as cache } from "./etude-quali";

const ok = (key: string, name: string) => cache[key]?.[name] && !cache[key][name].error;
const items = loadItems().filter(i => ["jev", "mini", "mini54", "truth"].every(n => ok(i.key, n)));
type It = (typeof items)[number];
type System = (item: It, id: string) => string;
const truth: System = (i, id) => cache[i.key].truth.answers[id]?.choice ?? "unstated";
const jevAt = (min: number): System => (i, id) => { const a = cache[i.key].jev.answers[id]; return a?.choice && (a.confidence ?? 0) >= min ? a.choice : "unstated"; };
const llm = (name: string): System => (i, id) => cache[i.key][name].answers[id]?.choice ?? "unstated";
const SYSTEMS: [string, System][] = [["Jev brut", jevAt(0)], ["Jev, confiance ≥ 0,85", jevAt(0.85)], ["Jev, confiance ≥ 0,95", jevAt(0.95)],
  ["gpt-5-mini (effort faible)", llm("mini")], ["gpt-5.4-mini (effort faible)", llm("mini54")]];
const IDS = QUALI.map(q => q.id);

function score(system: System, ids = IDS) {
  const s = { decided: 0, right: 0, stated: 0, found: 0, invented: 0, contradictions: 0, exact: 0, cells: 0 };
  for (const i of items) for (const id of ids) {
    const t = truth(i, id), a = system(i, id);
    s.cells++; if (a === t) s.exact++;
    if (t !== "unstated") { s.stated++; if (a === t) s.found++; }
    if (a !== "unstated") { s.decided++; if (a === t) s.right++; else if (t === "unstated") s.invented++; else s.contradictions++; }
  }
  return s;
}
const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(1)} %` : "—";
const lines: string[] = [];
const out = (...l: string[]) => { lines.push(...l); };
const row = (name: string, s: ReturnType<typeof score>) => `| ${name} | ${s.decided} | ${pct(s.right, s.decided)} | ${pct(s.found, s.stated)} | ${s.invented} | ${s.contradictions} | ${pct(s.exact, s.cells)} |`;

out(`# Étude qualitative : Jev, gpt-5-mini, gpt-5.4-mini ; vérité gpt-5.5 — ${new Date().toISOString().slice(0, 10)}`, "",
  `${items.length} annonces réelles, ${IDS.length} critères qualitatifs (${QUALI.map(q => q.label).join(", ")}). Oui / non / non précisé, d'après le texte seul ; mêmes définitions données aux quatre.`, "",
  "Précision = part des oui/non conformes à la vérité ; rappel = part des oui/non de la vérité retrouvés ; inventée = tranchée alors que la vérité dit « non précisé » ; contradiction = oui au lieu de non ou l'inverse.", "",
  "## Tous critères", "", "| Système | Tranchées | Précision | Rappel | Inventées | Contradictions | Accord total |", "|---|---|---|---|---|---|---|");
for (const [name, system] of SYSTEMS) out(row(name, score(system)));
out("", "## Jev : effet du seuil de confiance", "", "| Seuil | Tranchées | Précision | Rappel | Inventées | Contradictions | Accord total |", "|---|---|---|---|---|---|---|");
for (const min of [0, 0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98]) out(row(String(min), score(jevAt(min))));

out("", "## Par critère", "", "Vérité : nombre de oui / non. Chaque cellule : précision (justes/tranchées) · rappel.", "",
  "| Critère | Vérité oui/non | Jev ≥ 0,85 | gpt-5-mini | gpt-5.4-mini |", "|---|---|---|---|---|");
for (const q of QUALI) {
  const yes = items.filter(i => truth(i, q.id) === "yes").length, no = items.filter(i => truth(i, q.id) === "no").length;
  const cell = (system: System) => { const s = score(system, [q.id]); return `${pct(s.right, s.decided)} (${s.right}/${s.decided}) · ${pct(s.found, s.stated)}`; };
  out(`| ${q.label} | ${yes} / ${no} | ${cell(jevAt(0.85))} | ${cell(llm("mini"))} | ${cell(llm("mini54"))} |`);
}

const tokens = (name: string, field: "inputTokens" | "outputTokens") => items.reduce((s, i) => s + (cache[i.key][name][field] ?? 0), 0);
const ms = (name: string) => { const v = items.map(i => cache[i.key][name].ms).sort((a, b) => a - b); return `${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} ms (p95 ${v[Math.floor(v.length * 0.95)]} ms)`; };
const cost = (name: string, input: number, output: number) => (tokens(name, "inputTokens") * input + tokens(name, "outputTokens") * output) / 1e6;
out("", `## Coût et temps (${IDS.length} questions par annonce)`, "", "| Système | Tokens entrée / sortie | Coût par annonce | Temps moyen |", "|---|---|---|---|",
  `| Jev (0,042 $/M) | ${tokens("jev", "inputTokens")} / — | ${(cost("jev", 0.042, 0) / items.length).toFixed(6)} $ | ${ms("jev")} |`,
  `| gpt-5-mini (0,25 / 2 $/M) | ${tokens("mini", "inputTokens")} / ${tokens("mini", "outputTokens")} | ${(cost("mini", 0.25, 2) / items.length).toFixed(6)} $ | ${ms("mini")} |`,
  `| gpt-5.4-mini (0,75 / 4,5 $/M) | ${tokens("mini54", "inputTokens")} / ${tokens("mini54", "outputTokens")} | ${(cost("mini54", 0.75, 4.5) / items.length).toFixed(6)} $ | ${ms("mini54")} |`,
  `| gpt-5.5 (vérité, 5 / 30 $/M) | ${tokens("truth", "inputTokens")} / ${tokens("truth", "outputTokens")} | ${(cost("truth", 5, 30) / items.length).toFixed(6)} $ | ${ms("truth")} |`);

const disagreements = items.flatMap(i => IDS.flatMap(id => {
  const t = truth(i, id), j = jevAt(0.85)(i, id), m = llm("mini")(i, id), m54 = llm("mini54")(i, id);
  return [j, m, m54].some(a => a !== "unstated" && a !== t) ? [{ key: i.key, id, truth: t, jev: j, jevRaw: cache[i.key].jev.answers[id], mini: m, mini54: m54, text: textOf(i) }] : [];
}));
writeFileSync("bench/desaccords-quali.json", JSON.stringify(disagreements, null, 1));
const arbitrage = existsSync("bench/arbitrage-quali.md") ? `\n${readFileSync("bench/arbitrage-quali.md", "utf8")}` : "";
const file = `../../reports/etude-jev-qualitatif-${new Date().toISOString().slice(0, 10)}.md`;
writeFileSync(file, lines.join("\n") + "\n" + arbitrage);
console.log(lines.join("\n"));
console.log(`\n${disagreements.length} désaccords → bench/desaccords-quali.json ; rapport : ${file}`);
