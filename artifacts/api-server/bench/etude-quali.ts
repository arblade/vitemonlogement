// Étude qualitative : critères subjectifs (calme, lumineux, état…) lus par Jev, gpt-5-mini, gpt-5.4-mini ; vérité
// gpt-5.5. APPELS PAYANTS, à la main ; réponses mises en cache dans bench/etude-quali-cache.json.
//   JEV_MODEL=jev-latest node --import tsx bench/etude-quali.ts [lecteurs]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { jevDecide, type JevChoiceQuestion } from "../src/lib/jev";
import { loadItems, textOf, type Item } from "./etude";

/** Critères qualitatifs : oui = l'annonce le dit ou le décrit clairement ; non = elle dit le contraire ; sinon non précisé. */
export const QUALI: { id: string; label: string; question: string; yes: string; no: string }[] = [
  { id: "quiet", label: "Calme", question: "Le logement est-il calme ?", yes: "« calme », « au calme », rue piétonne ou résidentielle tranquille, sans nuisance, côté cour", no: "bruyant, sur un axe passant, au-dessus d'un bar, nuisances sonores" },
  { id: "bright", label: "Lumineux", question: "Le logement est-il lumineux ?", yes: "« lumineux », « baigné de lumière », exposition sud, grandes fenêtres, traversant", no: "sombre, peu de lumière, rez-de-chaussée sur cour sombre, sans fenêtre" },
  { id: "good_condition", label: "Bon état", question: "Le logement est-il en bon état ?", yes: "« bon état », « très bon état », refait, rénové, neuf, impeccable", no: "travaux à prévoir, à rafraîchir, vétuste, en l'état" },
  { id: "view", label: "Vue dégagée", question: "Le logement a-t-il une vue dégagée ou une belle vue ?", yes: "vue dégagée, sans vis-à-vis, belle vue, vue sur parc, fleuve ou monuments", no: "vis-à-vis, vue sur mur ou cour fermée" },
  { id: "charm", label: "Cachet", question: "Le logement a-t-il du cachet ou du charme ?", yes: "cachet, charme, ancien, moulures, parquet ancien, poutres, pierres apparentes, haussmannien", no: "rien ne le dit en sens contraire en général : « no » seulement si l'annonce dit sans charme ou impersonnel" },
  { id: "spacious", label: "Spacieux", question: "Le logement est-il spacieux pour son type ?", yes: "« spacieux », « grand », surface généreuse pour le type (ex. studio de 30 m², T2 de 50 m²)", no: "« petit », « compact », exigu, surface faible pour le type (ex. studio de 12 m²)" },
  { id: "storage", label: "Rangements", question: "Le logement a-t-il de bons rangements ?", yes: "nombreux rangements, placards, dressing, cellier", no: "peu ou pas de rangements" },
  { id: "well_located", label: "Bien situé", question: "Le logement est-il bien situé (centre, commerces et services à pied) ?", yes: "centre-ville, quartier recherché, commerces, transports et services à pied", no: "isolé, loin de tout, voiture indispensable" },
  { id: "energy", label: "Économe en énergie", question: "Le logement est-il économe en énergie ou bien isolé ?", yes: "DPE A, B ou C, bien isolé, double vitrage récent, isolation refaite, faibles charges d'énergie", no: "DPE E, F ou G, mal isolé, passoire thermique, dépenses d'énergie élevées" },
  { id: "student", label: "Adapté à un étudiant", question: "Le logement convient-il à un étudiant ?", yes: "« idéal étudiant », proche des universités ou écoles, petite surface meublée à prix modéré, bail étudiant", no: "réservé aux non-étudiants, grande surface familiale chère, étudiants refusés" },
  { id: "family", label: "Adapté à une famille", question: "Le logement convient-il à une famille avec enfants ?", yes: "plusieurs chambres, écoles à proximité, jardin, quartier familial", no: "studio ou T1, une seule chambre, colocation, chambre seule" },
  { id: "upscale", label: "Standing", question: "Le logement est-il haut de gamme ou de standing ?", yes: "« standing », « haut de gamme », « luxueux », prestations de qualité, résidence de standing", no: "« simple », « basique », entrée de gamme" },
];
const RULES = "Tu lis une annonce de location et réponds à chaque question uniquement d'après le texte. « yes » : le texte l'affirme ou le décrit clairement ; « no » : le texte dit ou montre clairement le contraire ; « unstated » : le texte ne permet pas de trancher (une absence n'est jamais un « no »).";
const OPTIONS = ["yes", "no", "unstated"];
const jevQuestions: Record<string, JevChoiceQuestion> = Object.fromEntries(QUALI.map(q => [q.id, { type: "choice" as const, instructions: q.question,
  criteria: { yes: `Oui, l'annonce le dit ou le décrit clairement (${q.yes})`, no: `Non, l'annonce dit ou montre le contraire (${q.no})`, unstated: "L'annonce ne permet pas de trancher" } }]));
const schema = { type: "object", additionalProperties: false, required: QUALI.map(q => q.id), properties: Object.fromEntries(QUALI.map(q => [q.id, { type: "string", enum: OPTIONS }])) };
const list = QUALI.map(q => `- ${q.id} : ${q.question} (yes : ${q.yes} ; no : ${q.no})`).join("\n");

type Reading = { answers: Record<string, { choice: string | null; confidence?: number; probabilities?: Record<string, number> }>; ms: number; inputTokens: number | null; outputTokens?: number | null; error?: string };
const CACHE = "bench/etude-quali-cache.json";
export const qualiCache: Record<string, Record<string, Reading>> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

async function openai(model: string, effort: string, item: Item): Promise<Reading> {
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, reasoning_effort: effort, max_completion_tokens: 16000, response_format: { type: "json_schema", json_schema: { name: "lecture", strict: true, schema } },
        messages: [{ role: "system", content: RULES }, { role: "user", content: `Annonce :\n${textOf(item)}\n\nQuestions (une réponse par identifiant) :\n${list}` }] }) });
    const body = await res.json() as any;
    const content = body?.choices?.[0]?.message?.content;
    if (res.ok && content) return { answers: Object.fromEntries(Object.entries(JSON.parse(content) as Record<string, string>).map(([k, v]) => [k, { choice: v }])),
      ms: Date.now() - started, inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null };
    if (attempt >= 3) return { answers: {}, ms: Date.now() - started, inputTokens: null, error: JSON.stringify(body?.error ?? body?.choices?.[0]?.finish_reason ?? body).slice(0, 200) };
  }
}
export const QUALI_READERS: Record<string, (item: Item) => Promise<Reading>> = {
  jev: async item => { const started = Date.now(); try { const r = await jevDecide(textOf(item), jevQuestions); return { answers: r.answers, ms: Date.now() - started, inputTokens: r.inputTokens }; } catch (e) { return { answers: {}, ms: Date.now() - started, inputTokens: null, error: String(e).slice(0, 200) }; } },
  mini: item => openai("gpt-5-mini", "low", item),
  mini54: item => openai("gpt-5.4-mini", "low", item),
  truth: item => openai(process.env.TRUTH_MODEL || "gpt-5.5", "medium", item),
};

if (process.argv[1]?.endsWith("etude-quali.ts")) {
  const items = loadItems();
  const only = process.argv[2]?.split(",") ?? Object.keys(QUALI_READERS);
  const queue = items.flatMap(item => only.filter(name => !qualiCache[item.key]?.[name] || qualiCache[item.key][name].error).map(name => ({ item, name })));
  console.log(`${items.length} annonces, ${queue.length} lectures à faire (${only.join(", ")})`);
  let done = 0;
  const save = () => writeFileSync(CACHE, JSON.stringify(qualiCache));
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const reading = await QUALI_READERS[job.name](job.item);
      (qualiCache[job.item.key] ??= {})[job.name] = reading;
      if (reading.error) console.error(`${job.name} ${job.item.key} : ${reading.error}`);
      if (++done % 50 === 0) { save(); console.log(`${done} lectures`); }
    }
  }));
  save();
  console.log(`terminé : ${done} lectures`);
}
