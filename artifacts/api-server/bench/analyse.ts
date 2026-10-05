// Analyse de l'étude (bench/etude.ts) : Jev brut, Jev en production (mot-clé + seuil), gpt-5-mini et champs Le Bon Coin
// comparés à la vérité (gpt-5.5). Aucun appel payant : lit bench/etude-cache.json.
//   node --import tsx bench/analyse.ts            → reports/etude-jev-<date>.md + bench/desaccords.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CATALOGUE } from "../src/routes/housing/catalogue";
import { fromFatihRecord } from "../src/routes/housing/apify";
import { IDS, loadItems, textOf } from "./etude";

type Answer = { choice: string | null; confidence?: number };
const cache = JSON.parse(readFileSync("bench/etude-cache.json", "utf8")) as Record<string, Record<string, { answers: Record<string, Answer>; ms: number; inputTokens: number | null; outputTokens?: number | null; error?: string }>>;
const items = loadItems().filter(item => cache[item.key]?.truth && !cache[item.key].truth.error && cache[item.key]?.jev && !cache[item.key].jev.error && cache[item.key]?.mini && !cache[item.key].mini.error);
const feature = (id: string) => CATALOGUE.find(f => f.id === id)!;
const MIN = Number(process.env.JEV_MIN_CONFIDENCE ?? 85) / 100;

/** Réponse d'un système à une question : "yes" | "no" | "unstated" (non tranché). */
type System = (item: (typeof items)[number], id: string) => string;
const truth: System = (item, id) => cache[item.key].truth.answers[id]?.choice ?? "unstated";
const jevAt = (min: number, gated: boolean): System => (item, id) => {
  const a = cache[item.key].jev.answers[id];
  if (!a?.choice) return "unstated";
  if ((a.confidence ?? 0) < min) return "unstated";
  if (gated && (id === "outdoor" || !feature(id).keyword.test(textOf(item)))) return "unstated";
  return a.choice;
};
/** Proposition : filtre mot-clé seulement là où Jev invente (sujets qu'il « devine » à partir du reste du texte). */
const RISKY = new Set(["balcony", "terrace", "garden", "duplex", "top_floor", "flatshare", "charges_included", "parking"]);
const jevProposed: System = (item, id) => RISKY.has(id) ? jevAt(MIN, true)(item, id) : jevAt(MIN, false)(item, id);
const mini: System = (item, id) => cache[item.key].mini.answers[id]?.choice ?? "unstated";
const lbcRaw = (item: (typeof items)[number]) => {
  const raw = item.raw as Record<string, unknown> | undefined;
  if (!raw) return null;
  return raw.record_type === "property_listing" ? fromFatihRecord(raw) : raw;
};
const lbc: System = (item, id) => { const raw = lbcRaw(item); const read = feature(id).structured; return raw && read ? read(raw) ?? "unstated" : "unstated"; };

const SYSTEMS: [string, System][] = [
  ["Jev brut (réponse la plus probable)", jevAt(0, false)],
  [`Jev, confiance ≥ ${MIN}`, jevAt(MIN, false)],
  [`Jev en production (mot-clé + confiance ≥ ${MIN})`, jevAt(MIN, true)],
  [`Jev proposé (mot-clé seulement sur ${RISKY.size} sujets à risque, confiance ≥ ${MIN})`, jevProposed],
  ["gpt-5-mini (effort faible, comme en production)", mini],
];

function score(system: System, ids = IDS, subset = items) {
  const s = { cells: 0, exact: 0, truthStated: 0, found: 0, decided: 0, right: 0, falseYes: 0, falseNo: 0, contradictions: 0, invented: 0 };
  for (const item of subset) for (const id of ids) {
    const t = truth(item, id), a = system(item, id);
    s.cells++; if (t === a) s.exact++;
    if (t !== "unstated") { s.truthStated++; if (a === t) s.found++; }
    if (a !== "unstated") { s.decided++; if (a === t) s.right++; else { if (a === "yes") s.falseYes++; else s.falseNo++; if (t === "unstated") s.invented++; else s.contradictions++; } }
  }
  return s;
}
const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(1)} %` : "—";
const lines: string[] = [];
const out = (...l: string[]) => lines.push(...l);

const sources = [...new Set(items.map(i => i.source))];
out(`# Étude Jev / gpt-5-mini / vérité gpt-5.5 — ${new Date().toISOString().slice(0, 10)}`, "",
  `${items.length} annonces réelles (${sources.map(s => `${s} : ${items.filter(i => i.source === s).length}`).join(", ")}), ` +
  `${IDS.length} caractéristiques + type d'offre : ${items.length * IDS.length} réponses par système. Vérité : gpt-5.5 (réflexion moyenne), mêmes questions, même texte.`, "",
  "Définitions : **tranché** = le système répond oui ou non ; **précision** = part des réponses tranchées conformes à la vérité ; " +
  "**rappel** = part des oui/non de la vérité retrouvés ; **inventé** = tranché alors que la vérité dit « non précisé » ; " +
  "**contradiction** = oui au lieu de non ou l'inverse.", "",
  "## Caractéristiques, tous systèmes", "",
  "| Système | Tranchées | Précision | Rappel | Faux oui | Faux non | Inventées | Contradictions | Accord total (3 classes) |", "|---|---|---|---|---|---|---|---|---|");
for (const [name, system] of SYSTEMS) {
  const s = score(system);
  out(`| ${name} | ${s.decided} | ${pct(s.right, s.decided)} | ${pct(s.found, s.truthStated)} | ${s.falseYes} | ${s.falseNo} | ${s.invented} | ${s.contradictions} | ${pct(s.exact, s.cells)} |`);
}
const lbcItems = items.filter(i => i.raw);
const sl = score(lbc, CATALOGUE.filter(f => f.structured).map(f => f.id), lbcItems);
out("", `Champs structurés Le Bon Coin (${lbcItems.length} annonces, ${CATALOGUE.filter(f => f.structured).length} caractéristiques lisibles) : ${sl.decided} tranchées, ` +
  `dont ${sl.decided - sl.invented} sur un point que le texte tranche aussi : accord ${pct(sl.right, sl.decided - sl.invented)}, ${sl.contradictions} contradictions ; ${sl.invented} infos absentes du texte (le champ en dit plus que la description : apport propre de l'API).`);

// Seuils de confiance de Jev
out("", "## Jev : effet du seuil de confiance (sans filtre mot-clé)", "", "| Seuil | Tranchées | Précision | Rappel | Inventées | Contradictions |", "|---|---|---|---|---|---|");
for (const min of [0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) { const s = score(jevAt(min, false)); out(`| ${min} | ${s.decided} | ${pct(s.right, s.decided)} | ${pct(s.found, s.truthStated)} | ${s.invented} | ${s.contradictions} |`); }

// Type d'offre
out("", "## Type d'offre (logement entier, chambre, non habitable)", "", "| Système | Juste | Chambres repérées (rappel) | « Chambre » à tort | Non habitable repéré |", "|---|---|---|---|---|");
const offerOf = { jev: (i: (typeof items)[number]) => cache[i.key].jev.answers.offer?.choice, mini: (i: (typeof items)[number]) => cache[i.key].mini.answers.offer?.choice };
const tOffer = (i: (typeof items)[number]) => cache[i.key].truth.answers.offer?.choice;
for (const [name, get] of Object.entries(offerOf)) {
  const right = items.filter(i => get(i) === tOffer(i)).length;
  const rooms = items.filter(i => tOffer(i) === "room"), nd = items.filter(i => tOffer(i) === "non_dwelling");
  const wrongRoom = items.filter(i => get(i) === "room" && tOffer(i) !== "room").length;
  out(`| ${name} | ${pct(right, items.length)} (${right}/${items.length}) | ${rooms.filter(i => get(i) === "room").length}/${rooms.length} | ${wrongRoom} | ${nd.filter(i => get(i) === "non_dwelling").length}/${nd.length} |`);
}

// Par caractéristique
out("", "## Par caractéristique", "", "Vérité : nombre de oui / non. Pour chaque système : précision (tranchées) · rappel.", "",
  "| Caractéristique | Vérité oui/non | Jev production | Jev proposé | Jev brut | gpt-5-mini |", "|---|---|---|---|---|---|");
for (const id of IDS) {
  const yes = items.filter(i => truth(i, id) === "yes").length, no = items.filter(i => truth(i, id) === "no").length;
  const cell = (system: System) => { const s = score(system, [id]); return `${pct(s.right, s.decided)} (${s.right}/${s.decided}) · ${pct(s.found, s.truthStated)}`; };
  out(`| ${feature(id).label} | ${yes} / ${no} | ${cell(jevAt(MIN, true))} | ${cell(jevProposed)} | ${cell(jevAt(0, false))} | ${cell(mini)} |`);
}

// Coût et temps
const tokens = (name: string, field: "inputTokens" | "outputTokens") => items.reduce((s, i) => s + (cache[i.key][name][field] ?? 0), 0);
const ms = (name: string) => { const v = items.map(i => cache[i.key][name].ms).sort((a, b) => a - b); return `${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} ms (p95 ${v[Math.floor(v.length * 0.95)]} ms)`; };
const jevCost = tokens("jev", "inputTokens") * 0.042 / 1e6, miniCost = (tokens("mini", "inputTokens") * 0.25 + tokens("mini", "outputTokens") * 2) / 1e6;
out("", "## Coût et temps (33 questions par annonce)", "", "| Système | Tokens entrée / sortie | Coût total | Par annonce | Temps moyen |", "|---|---|---|---|---|",
  `| Jev (0,042 $/M entrée) | ${tokens("jev", "inputTokens")} / — | ${jevCost.toFixed(4)} $ | ${(jevCost / items.length).toFixed(6)} $ | ${ms("jev")} |`,
  `| gpt-5-mini (0,25 / 2 $/M) | ${tokens("mini", "inputTokens")} / ${tokens("mini", "outputTokens")} | ${miniCost.toFixed(4)} $ | ${(miniCost / items.length).toFixed(6)} $ | ${ms("mini")} |`,
  `| gpt-5.5 (vérité) | ${tokens("truth", "inputTokens")} / ${tokens("truth", "outputTokens")} | — | — | ${ms("truth")} |`);

// Désaccords, pour arbitrage
const disagreements = items.flatMap(item => IDS.flatMap(id => {
  const t = truth(item, id), j = jevAt(MIN, true)(item, id), m = mini(item, id);
  return (j !== "unstated" && j !== t) || (m !== "unstated" && m !== t) ? [{ key: item.key, id, truth: t, jevProd: j, jevRaw: jevAt(0, false)(item, id), jevConfidence: cache[item.key].jev.answers[id]?.confidence, mini: m, text: textOf(item) }] : [];
}));
writeFileSync("bench/desaccords.json", JSON.stringify(disagreements, null, 2));
const file = `../../reports/etude-jev-${new Date().toISOString().slice(0, 10)}.md`;
const arbitrage = existsSync("bench/arbitrage.md") ? `\n${readFileSync("bench/arbitrage.md", "utf8")}` : "";
writeFileSync(file, lines.join("\n") + "\n" + arbitrage);
console.log(lines.join("\n"));
console.log(`\n${disagreements.length} désaccords tranchés → bench/desaccords.json ; rapport : ${file}`);
