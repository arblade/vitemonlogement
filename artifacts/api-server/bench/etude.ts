// Étude Jev / gpt-5-mini / vérité (gpt-5.5) : mêmes questions (type d'offre + 32 caractéristiques du catalogue) posées
// aux trois, sur le texte de chaque annonce. APPELS PAYANTS (Jev, OpenAI) : à la main. Réponses mises en cache dans
// bench/etude-cache.json (on ne repaie jamais une réponse déjà obtenue).
//   JEV_MODEL=jev-latest node --import tsx bench/etude.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CATALOGUE } from "../src/routes/housing/catalogue";
import { jevDecide, type JevChoiceQuestion } from "../src/lib/jev";

type Answer = { choice: string | null; confidence?: number; probabilities?: Record<string, number> };
type Reading = { answers: Record<string, Answer>; ms: number; inputTokens: number | null; outputTokens?: number | null; error?: string };
export type Item = { key: string; source: string; title: string; description: string; raw?: unknown };

const TRUTH_MODEL = process.env.TRUTH_MODEL || "gpt-5.5";
const MINI_MODEL = "gpt-5-mini";
const CACHE = "bench/etude-cache.json";
const cache: Record<string, Record<string, Reading>> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const save = () => writeFileSync(CACHE, JSON.stringify(cache));

const PRESENCE = { yes: "Oui, l'annonce le dit explicitement", no: "Non, l'annonce dit explicitement le contraire", unstated: "L'annonce ne le précise pas" };
const OFFER = {
  entire: "Un logement entier pour le locataire (studio, appartement, maison), même en résidence, même si la colocation y est possible",
  room: "Seulement une chambre ou une partie d'un logement occupé par d'autres (colocation, coliving, chez l'habitant)",
  non_dwelling: "Pas un logement : parking, garage, box, cave, local, bureau, terrain",
  unclear: "Le texte ne permet pas de trancher",
};
export const IDS = CATALOGUE.map(f => f.id);
const jevQuestions: Record<string, JevChoiceQuestion> = {
  offer: { type: "choice", instructions: "Qu'est-ce qui est loué dans cette annonce ?", criteria: OFFER },
  ...Object.fromEntries(CATALOGUE.map(f => [f.id, { type: "choice" as const, instructions: f.question, criteria: PRESENCE }])),
};
const schema = { type: "object", additionalProperties: false, required: ["offer", ...IDS], properties: {
  offer: { type: "string", enum: Object.keys(OFFER) }, ...Object.fromEntries(IDS.map(id => [id, { type: "string", enum: ["yes", "no", "unstated"] }])) } };
const questionList = [`- offer : Qu'est-ce qui est loué ? ${Object.entries(OFFER).map(([k, v]) => `${k} = ${v}`).join(" ; ")}`,
  ...CATALOGUE.map(f => `- ${f.id} : ${f.question}`)].join("\n");
const RULES = "Tu lis une annonce de location et réponds à chaque question uniquement d'après le texte. « yes » : le texte l'affirme ou l'implique clairement ; « no » : le texte dit explicitement le contraire (ex. « non meublé », « WC dans la salle de bain », « au 2e étage » pour le rez-de-chaussée) ; « unstated » : le texte n'en parle pas (une absence n'est jamais un « no »).";

export const textOf = (item: Item) => `${item.title}\n${item.description}`.slice(0, 8000);

async function openai(model: string, effort: string, item: Item): Promise<Reading> {
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, reasoning_effort: effort, max_completion_tokens: 16000,
        response_format: { type: "json_schema", json_schema: { name: "lecture", strict: true, schema } },
        messages: [{ role: "system", content: RULES }, { role: "user", content: `Annonce :\n${textOf(item)}\n\nQuestions (une réponse par identifiant) :\n${questionList}` }] }) });
    const body = await res.json() as any;
    const content = body?.choices?.[0]?.message?.content;
    if (res.ok && content) {
      const parsed = JSON.parse(content) as Record<string, string>;
      return { answers: Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, { choice: v }])), ms: Date.now() - started,
        inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null };
    }
    if (attempt >= 3) return { answers: {}, ms: Date.now() - started, inputTokens: null, error: JSON.stringify(body?.error ?? body?.choices?.[0]?.finish_reason ?? body).slice(0, 200) };
  }
}

async function jev(item: Item): Promise<Reading> {
  const started = Date.now();
  try { const result = await jevDecide(textOf(item), jevQuestions); return { answers: result.answers, ms: Date.now() - started, inputTokens: result.inputTokens }; }
  catch (error) { return { answers: {}, ms: Date.now() - started, inputTokens: null, error: String(error).slice(0, 200) }; }
}

const READERS: Record<string, (item: Item) => Promise<Reading>> = {
  jev, mini: item => openai(MINI_MODEL, "low", item), mini54: item => openai("gpt-5.4-mini", "low", item), truth: item => openai(TRUTH_MODEL, "medium", item),
};

export function loadItems(): Item[] {
  const items: Item[] = [];
  for (const x of JSON.parse(readFileSync("bench/annonces-lbc.json", "utf8"))) items.push({ key: x.url, source: `lbc-${x.city}`, title: x.title, description: x.description, raw: x.raw });
  for (const x of JSON.parse(readFileSync("bench/verite.json", "utf8"))) items.push({ key: x.url || x.title, source: "echantillons", title: x.title, description: x.description });
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const byText = [...new Map(items.map(item => [norm(item.description), item])).values()];
  return [...new Map(byText.map(item => [item.key, item])).values()].filter(item => item.description.length > 30);
}

if (process.argv[1]?.endsWith("etude.ts")) {
  const items = loadItems();
  const only = process.argv[2]?.split(",") ?? Object.keys(READERS);
  console.log(`${items.length} annonces ; lecteurs : ${only.join(", ")}`);
  const queue = items.flatMap(item => only.filter(name => !cache[item.key]?.[name] || cache[item.key][name].error).map(name => ({ item, name })));
  let done = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const reading = await READERS[job.name](job.item);
      (cache[job.item.key] ??= {})[job.name] = reading;
      if (reading.error) console.error(`${job.name} ${job.item.key} : ${reading.error}`);
      if (++done % 25 === 0) { save(); console.log(`${done} lectures`); }
    }
  }));
  save();
  console.log(`terminé : ${done} lectures`);
}
