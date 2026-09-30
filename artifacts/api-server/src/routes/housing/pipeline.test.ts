import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";

// Bout en bout, sans réseau ni secret : de faux serveurs Apify et OpenAI locaux répondent au vrai code
// (interprétation → run Apify → récupération → analyse IA → enregistrement) piloté par le vrai worker.
const ads = [1, 2].map(n => ({
  url: `https://www.leboncoin.fr/ad/locations/${n}`,
  title: `Studio ${n} Lille`,
  description: `Studio ${n} calme. Les chats sont acceptés. Loyer 600 € par mois.`,
  price_euros: 600, square: 28, rooms: 1, location: { city: "Lille" },
  images: { urls_large: [`https://img.leboncoin.fr/${n}.jpg`] },
}));
const counts = { interpret: 0, analyze: 0, apifyRuns: 0 };
let fake: Server;

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/actors/")) { counts.apifyRuns++; return json({ data: { id: "run-1" } }); }
      if (url.startsWith("/v2/actor-runs/")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds-1" } });
      if (url.startsWith("/v2/datasets/")) return json(ads);
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        let content: unknown;
        if (request.messages[0].content.includes("Interprète une demande")) {
          counts.interpret++;
          content = { location: "Lille", intent: "rent", maxPrice: 700, radius: 5, keywords: "", uncertainChecks: [{ label: "chat accepté", availability: "description", apiField: null }] };
        } else {
          counts.analyze++;
          const { listings } = JSON.parse(request.messages[1].content) as { listings: { id: number; toVerify: { id: string }[]; wantGeneral: boolean }[] };
          content = { items: listings.map(item => ({
            id: item.id,
            checks: item.toVerify.map(check => ({ id: check.id, status: "confirmed", value: "Chats acceptés", evidence: "Les chats sont acceptés" })),
            ...(item.wantGeneral ? { summary: "Studio calme.", summaryEvidence: ["calme"], features: [] } : {}),
          })) };
        }
        return json({ id: "x", object: "chat.completion", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }] });
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.APIFY_BASE_URL = origin;
  process.env.APIFY_TOKEN = "test";
  process.env.OPENAI_BASE_URL = `${origin}/v1`;
  process.env.OPENAI_API_KEY = "test";
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
});
after(async () => {
  fake.close();
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});

async function runToCompletion(id: number) {
  const { createWorker } = await import("../../lib/worker");
  const { db } = await import("../../lib/database");
  const worker = createWorker({ owner: "e2e" });
  for (let i = 0; i < 6; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id)); // saute l'attente entre deux contrôles
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    if (row.status !== "running") return row;
  }
  throw new Error("La recherche ne se termine pas");
}

test("le worker mène une recherche jusqu'au bout sans aucun navigateur, puis une 2e recherche réutilise l'analyse", async () => {
  const { createSearch, getSearch } = await import("./store");

  const first = await createSearch("Un studio à Lille, 700 € max, chat accepté");
  assert.equal((await runToCompletion(first)).status, "completed");
  const one = await getSearch(first);
  assert.equal(one?.listings.length, 2);
  assert.equal(one?.criteria.location, "Lille");
  assert.equal(one?.listings[0].criterionResults.find(check => check.label === "chat accepté")?.status, "confirmed");
  assert.equal(one?.listings[0].aiSummary, "Studio calme.");
  assert.equal(counts.analyze, 1, "un seul appel d'analyse pour les deux annonces");

  const second = await createSearch("Studio Lille 700 euros, chats acceptés");
  assert.equal((await runToCompletion(second)).status, "completed");
  const two = await getSearch(second);
  assert.equal(two?.listings.length, 2);
  assert.equal(counts.interpret, 2, "chaque recherche est bien interprétée");
  assert.equal(counts.apifyRuns, 2);
  assert.equal(counts.analyze, 1, "les mêmes annonces ne sont PAS ré-analysées par le LLM");
  assert.equal(two?.listings[0].criterionResults.find(check => check.label === "chat accepté")?.status, "confirmed");
});

test("des échecs répétés d'Apify n'entraînent pas de boucle infinie : la recherche passe en échec après 3 tentatives", async () => {
  const { createSearch } = await import("./store");
  const { MAX_STEP_ATTEMPTS } = await import("./pipeline");
  const previous = process.env.APIFY_BASE_URL;
  process.env.APIFY_BASE_URL = "http://127.0.0.1:1"; // connexion refusée
  try {
    const id = await createSearch("Un studio à Lille, 700 € max");
    const row = await runToCompletion(id);
    assert.equal(row.status, "failed");
    assert.equal(MAX_STEP_ATTEMPTS, 3);
  } finally {
    process.env.APIFY_BASE_URL = previous;
  }
});
