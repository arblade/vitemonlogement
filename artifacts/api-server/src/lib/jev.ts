// Client Jev (TypeSafe) : décisions typées (choix parmi des options, avec probabilités), sans génération de texte.
// API en accès anticipé (septembre 2026) : l'adresse et le format de réponse varient selon l'accès (TypeSafe direct,
// OpenRouter, AI/ML API…), d'où une adresse configurable et une lecture souple de la réponse. Le banc d'essai
// (scripts/jev-bench.ts) vérifie le format réel avant toute mise en service.
import { intEnv } from "./env";

export type JevChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type JevAnswer = { choice: string | null; confidence: number; probabilities: Record<string, number> };
export type JevResult = { answers: Record<string, JevAnswer>; inputTokens: number | null };
/** Appel injectable (tests, banc d'essai) : un texte, des questions, des réponses. */
export type JevDecide = (state: string, questions: Record<string, JevChoiceQuestion>) => Promise<JevResult>;

export const DEFAULT_JEV_URL = "https://api.typesafe.ai/v1/systemone";

export const jevConfigured = () => Boolean(process.env.JEV_API_KEY?.trim());

/** Moteur d'analyse des annonces : « jev » (Le Bon Coin, puis Jev, puis le LLM) seulement si demandé ET configuré. */
export const analysisEngine = () => process.env.ANALYSIS_ENGINE === "jev" && jevConfigured() ? "jev" as const : "llm" as const;

/** Seuils de probabilité (en centièmes) : en dessous, la réponse de Jev est ignorée (le critère reste « à vérifier » ou va au LLM). */
export const jevMinConfidence = () => intEnv("JEV_MIN_CONFIDENCE", 85) / 100;
/** Écarter une annonce (chambre, local non habitable) exige plus de certitude. */
export const jevHideConfidence = () => intEnv("JEV_HIDE_CONFIDENCE", 90) / 100;

const toNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;

/** Une réponse, quel que soit son habillage : { choice, confidence, probabilities }, { answer, … }, ou { probabilities } seules. */
export function readAnswer(raw: unknown): JevAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const probabilities: Record<string, number> = {};
  const rawProbabilities = data.probabilities ?? data.distribution ?? data.scores;
  if (rawProbabilities && typeof rawProbabilities === "object" && !Array.isArray(rawProbabilities)) {
    for (const [key, value] of Object.entries(rawProbabilities)) { const n = toNumber(value); if (n != null) probabilities[key] = n; }
  }
  const declared = [data.choice, data.answer, data.value, data.label].find(value => typeof value === "string") as string | undefined;
  const best = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
  const choice = declared ?? best ?? null;
  const confidence = toNumber(data.confidence) ?? (choice != null ? probabilities[choice] : undefined) ?? 0;
  return choice == null ? null : { choice, confidence: Math.max(0, Math.min(1, confidence)), probabilities };
}

/** Réponses d'un appel : sous `answers`, `decisions`, `results`, ou directement au premier niveau. */
export function readAnswers(body: unknown, names: string[]): Record<string, JevAnswer> {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const container = [data.answers, data.decisions, data.results, data.outputs].find(value => value && typeof value === "object") as Record<string, unknown> | undefined ?? data;
  const answers: Record<string, JevAnswer> = {};
  for (const name of names) { const answer = readAnswer(container[name]); if (answer) answers[name] = answer; }
  return answers;
}

/** Appel réel à Jev (JEV_API_KEY ; JEV_BASE_URL et JEV_MODEL facultatifs). */
export const jevDecide: JevDecide = async (state, questions) => {
  const key = process.env.JEV_API_KEY?.trim();
  if (!key) throw new Error("JEV_API_KEY n'est pas configurée.");
  const response = await fetch(process.env.JEV_BASE_URL?.trim() || DEFAULT_JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...(process.env.JEV_MODEL?.trim() ? { model: process.env.JEV_MODEL.trim() } : {}), state, questions }),
    signal: AbortSignal.timeout(intEnv("JEV_TIMEOUT_MS", 15_000)),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(`Jev ${response.status}: ${JSON.stringify(body?.error ?? body ?? "").slice(0, 200)}`);
  const usage = body?.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  return { answers: readAnswers(body, Object.keys(questions)), inputTokens: toNumber(usage.input_tokens ?? usage.prompt_tokens) };
};
