// Vérité terrain posée par un gros modèle OpenAI (OPENAI_API_KEY ; modèle : TRUTH_MODEL, défaut gpt-5.5). APPEL PAYANT, à la main.
import { readFileSync, writeFileSync } from "node:fs";
import { CATALOGUE } from "../src/routes/housing/catalogue.ts";
const model = process.env.TRUTH_MODEL || "gpt-5.5";
const items = JSON.parse(readFileSync("bench/verite.json", "utf8"));
const ids = CATALOGUE.map(f => f.id);
const schema = { type: "object", additionalProperties: false, required: ["offer", ...ids], properties: {
  offer: { type: "string", enum: ["entire", "room", "non_dwelling", "unclear"] },
  ...Object.fromEntries(ids.map(id => [id, { type: "string", enum: ["yes", "no", "unstated"] }])) } };
const questions = CATALOGUE.map(f => `- ${f.id} : ${f.question}`).join("\n");
const cache = new Map();
let usage = { in: 0, out: 0 };
async function label(item) {
  if (cache.has(item.description)) return cache.get(item.description);
  const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, reasoning_effort: "medium", response_format: { type: "json_schema", json_schema: { name: "truth", strict: true, schema } },
      messages: [{ role: "system", content: "Tu annotes une annonce de location. Réponds uniquement d'après le texte fourni. « yes » : le texte l'affirme ou l'implique clairement ; « no » : le texte le nie explicitement (ex. « non meublé », WC dans la salle de bain pour « séparés ») ; « unstated » : le texte n'en parle pas (une absence n'est jamais un « non »). offer : entire = logement entier loué à un ménage ; room = chambre (colocation ou partie d'un logement) ; non_dwelling = local non habitable ; unclear." },
        { role: "user", content: `Titre : ${item.title}\n\nDescription :\n${item.description}\n\nQuestions (une réponse par identifiant) :\n${questions}` }] }) });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body).slice(0, 300));
  usage.in += body.usage.prompt_tokens; usage.out += body.usage.completion_tokens;
  const parsed = JSON.parse(body.choices[0].message.content);
  cache.set(item.description, parsed);
  return parsed;
}
const mine = JSON.parse(readFileSync("bench/verite.json", "utf8"));
let same = 0, total = 0, offerSame = 0, offerTotal = 0; const diffs = [];
for (const [i, item] of items.entries()) {
  const { offer, ...features } = await label(item);
  const hand = mine[i].truth;
  item.truth = { ...item.truth, offer, features };
  if (hand.offer) { offerTotal++; if (hand.offer === offer) offerSame++; }
  for (const id of ids) if (hand.features[id]) { total++; if (hand.features[id] === features[id]) same++; else diffs.push(`#${i + 1} ${id}: moi ${hand.features[id]} / ${model} ${features[id]}`); }
}
writeFileSync("bench/verite-llm.json", JSON.stringify(items, null, 2));
console.log(`${model} : ${usage.in} tokens entrée, ${usage.out} sortie`);
console.log(`Accord avec ma vérité : ${same}/${total} (${Math.round(100 * same / total)} %), offre ${offerSame}/${offerTotal}`);
console.log(diffs.slice(0, 60).join("\n"));
