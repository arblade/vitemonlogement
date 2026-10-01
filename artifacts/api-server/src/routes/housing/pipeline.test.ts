import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { fatihRecord } from "../../test/fatih";

// Bout en bout, sans réseau ni secret : de faux serveurs Apify et OpenAI locaux répondent au vrai code
// (interprétation → run Apify → récupération → analyse IA → enregistrement) piloté par le vrai worker.
const ads = [1, 2].map(n => fatihRecord({
  url: `https://www.leboncoin.fr/ad/locations/${n}`,
  title: `Studio ${n} Lille`,
  description: `Studio ${n} calme. Les chats sont acceptés. Loyer 600 € par mois.`,
  price: 600, area: 28, rooms: 1, images: [`https://img.leboncoin.fr/${n}.jpg?rule=ad-image`],
  ...(n === 1 ? { lat: 50.6365, lng: 3.0635, type: "streetNumber" } : { lat: 50.63, lng: 3.06, type: "city" }),
}));
const counts = { interpret: 0, analyze: 0, apifyRuns: 0, geocode: 0 };
const actorStarts: string[] = []; // tous les acteurs Apify lancés, quels qu'ils soient
const openaiBodies: { model?: string; reasoning_effort?: string; max_completion_tokens?: number; messages?: { content: string }[] }[] = [];
let fake: Server;

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/")) actorStarts.push(url.split("/")[3]);
      if (req.method === "POST" && url.startsWith("/v2/acts/fatihtahta~leboncoin-fr-scraper/runs")) { counts.apifyRuns++; return json({ data: { id: "run-1" } }); }
      if (url.startsWith("/v2/actor-runs/")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds-1" } });
      if (url.startsWith("/v2/datasets/")) return json(ads);
      if (url.startsWith("/geocodage/search")) {
        counts.geocode++;
        return json({ features: [{ geometry: { coordinates: [3.0706, 50.6372] }, properties: { type: "housenumber", score: 0.95, label: "1 Place de la Gare 59000 Lille" } }] });
      }
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        openaiBodies.push(JSON.parse(body));
        let content: unknown;
        if (request.messages[0].content.includes("Interprète une demande")) {
          counts.interpret++;
          const places = request.messages[1].content.includes("travaille") ? [{ label: "Travail", kind: "work", address: "1 place de la Gare", mode: "bike" }] : [];
          content = { location: "Lille", intent: "rent", maxPrice: 700, radius: 5, keywords: "", uncertainChecks: [{ label: "chat accepté", availability: "description", apiField: null }], places };
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
  process.env.GEOCODER_BASE_URL = `${origin}/geocodage`;
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
    if (row.status !== "running" && !row.task) return row; // terminée, et plus aucune tâche en cours
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
  assert.deepEqual([...new Set(actorStarts)], ["fatihtahta~leboncoin-fr-scraper"], "réglage en dur : Le Bon Coin seul, ni SeLoger ni PAP");
  assert.ok(one?.listings.every(listing => listing.source === "leboncoin"));

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

test("lieu de vie : extrait de la demande, géocodé une fois et enregistré avec la recherche ; position des annonces conservée", async () => {
  const { createSearch, getSearch } = await import("./store");
  const before = counts.geocode;
  const id = await createSearch("Un studio à Lille, je travaille au 1 place de la Gare, j'y vais à vélo");
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  assert.deepEqual(search?.criteria.places, [{ id: "place-1", label: "Travail", kind: "work", address: "1 place de la Gare", mode: "bike",
    lat: 50.6372, lng: 3.0706, resolved: "1 Place de la Gare 59000 Lille" }]);
  assert.equal(counts.geocode - before, 1);
  const exact = search?.listings.find(item => item.url.endsWith("/1"));
  const vague = search?.listings.find(item => item.url.endsWith("/2"));
  assert.deepEqual([exact?.lat, exact?.lng, exact?.geoPrecision], [50.6365, 3.0635, "streetNumber"]);
  assert.equal(vague?.geoPrecision, "city");
});

test("sans lieu cité, aucun géocodage (et un géocodeur en panne ne bloque jamais la recherche)", async () => {
  const { createSearch, getSearch } = await import("./store");
  const before = counts.geocode;
  const id = await createSearch("Un studio à Lille, 700 € max");
  assert.equal((await runToCompletion(id)).status, "completed");
  assert.deepEqual((await getSearch(id))?.criteria.places, []);
  assert.equal(counts.geocode, before);
  const previous = process.env.GEOCODER_BASE_URL;
  process.env.GEOCODER_BASE_URL = "http://127.0.0.1:1";
  try {
    const down = await createSearch("Un studio à Lille, je travaille au 1 place de la Gare");
    assert.equal((await runToCompletion(down)).status, "completed");
    const place = (await getSearch(down))?.criteria.places?.[0];
    assert.equal(place?.address, "1 place de la Gare");
    assert.equal(place?.lat, null, "gardé, mais sans coordonnées : pas de point sur la carte");
  } finally {
    process.env.GEOCODER_BASE_URL = previous;
  }
});

test("OpenAI : la consigne d'analyse interdit de répéter le libellé dans la valeur d'une caractéristique (« Balcon » + « vue dégagée sur le balcon »)", () => {
  const analysis = openaiBodies.find(body => body.messages?.[0].content.includes("Tu lis des annonces immobilières"));
  assert.ok(analysis, "un appel d'analyse a eu lieu");
  assert.match(analysis.messages![0].content, /sans jamais répéter les mots du label/);
});

test("OpenAI : gpt-5-mini en réflexion « faible » pour l'interprétation comme pour l'analyse (moitié prix, sans réponse coupée)", async () => {
  const { REASONING_EFFORT } = await import("./ai");
  assert.equal(REASONING_EFFORT, "low");
  assert.ok(openaiBodies.length >= 2, "au moins un appel d'interprétation et un d'analyse ont eu lieu");
  for (const body of openaiBodies) {
    assert.equal(body.model, "gpt-5-mini");
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.max_completion_tokens, 8192);
  }
});
