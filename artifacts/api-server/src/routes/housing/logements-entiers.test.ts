import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";

// Cas signalé en production : « T1 ou T2 à Lille » renvoyait des parkings et des chambres en colocation.
// Les annonces imitent celles relevées le 01/10/2026 (features/enquete-parkings-colocations.md).
const ad = (n: number, title: string, extra: Record<string, unknown> = {}) => ({
  url: `https://www.leboncoin.fr/ad/locations/90${n}`, subject: title, body: `${title}. Loyer charges comprises.`,
  price_euros: 600, square: 30, rooms: 2, real_estate_type: "Appartement", location: { city: "Lille" }, ...extra,
});
const dataset = [
  ad(1, "Parking 10 m² Lille", { real_estate_type: "Parking", rooms: undefined, price_euros: 51 }),
  ad(2, "Chambre avec SDB privée - Coliving - Lille Centre"),
  ad(3, "Appartement T2 Gambetta"),
  ad(4, "Garage box fermé", { real_estate_type: undefined, rooms: undefined, attributes: [{ key: "real_estate_type", value: "4", value_label: "Parking" }] }),
  ad(5, "Appartement 3 pièces Fives", { rooms: 3 }),
  ad(6, "Studio lumineux Wazemmes", { rooms: 1 }),
  ad(7, "T2 Vieux-Lille"),
  ad(8, "Studio meublé Vauban", { rooms: 1 }),
  ad(9, "Studio Moulins", { rooms: 1 }),
  ad(10, "T2 Bois Blanc"),
];

let fake: Server;
const actorInputs: Record<string, unknown>[] = [];
let analyzeCalls = 0;

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/actors/")) { actorInputs.push(JSON.parse(body)); return json({ data: { id: "run-1" } }); }
      if (url.startsWith("/v2/actor-runs/")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds-1" } });
      if (url.startsWith("/v2/datasets/")) return json(dataset);
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        let content: unknown;
        if (request.messages[0].content.includes("Interprète une demande")) {
          // Le LLM recopie l'exemple du format : ce faux critère ne doit pas survivre.
          content = { location: "Lille", intent: "rent", maxPrice: 700, minRooms: 1, maxRooms: 2, radius: 5, keywords: "",
            uncertainChecks: [{ label: "souhait exact de l'utilisateur", availability: "description", apiField: null }], places: [] };
        } else {
          analyzeCalls++;
          const { listings } = JSON.parse(request.messages[1].content) as { listings: { id: number; title: string; wantGeneral: boolean }[] };
          content = { items: listings.map(item => ({
            id: item.id, checks: [],
            ...(item.wantGeneral ? {
              summary: "Logement.", summaryEvidence: [item.title], features: [],
              ...(item.title.includes("Coliving") ? { offer: "room", offerEvidence: "Chambre avec SDB privée - Coliving" }
                // Citation inventée : absente du texte, elle ne suffit pas à écarter l'annonce.
                : item.title.includes("Wazemmes") ? { offer: "room", offerEvidence: "chambre dans un appartement partagé" }
                : { offer: "entire", offerEvidence: "" }),
            } : {}),
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
  const worker = createWorker({ owner: "test" });
  for (let i = 0; i < 6; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    if (row.status !== "running") return row;
  }
  throw new Error("La recherche ne se termine pas");
}

test("« T1 ou T2 à Lille » : appartements et maisons de 1 à 2 pièces demandés, ni parking ni chambre parmi les 5 retenus", async () => {
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("Je cherche un T1 ou un T2 à Lille, 700 € max");
  assert.equal((await runToCompletion(id)).status, "completed");

  const search = await getSearch(id);
  assert.deepEqual([search?.criteria.minRooms, search?.criteria.maxRooms], [1, 2]);
  assert.deepEqual(search?.criteria.checks?.map(check => check.label), ["Lieu : Lille", "Budget : 0 à 700 €", "1 à 2 pièces"],
    "pas de critère « souhait exact de l'utilisateur »");

  const params = new URL(String(actorInputs[0].searchUrl)).searchParams;
  assert.equal(params.get("real_estate_type"), "1,2");
  assert.equal(params.get("rooms"), "1-2");
  assert.equal(params.get("price"), "min-700");
  assert.match(String(params.get("locations")), /^Lille_59000__50\.\d+_3\.\d+_5000$/);

  // Parkings (libellé ou code) écartés à la lecture, T3 écarté par le maximum de pièces, chambre écartée par l'analyse :
  // les 5 places sont remplies par les annonces suivantes (2e appel d'analyse).
  assert.deepEqual(search?.listings.map(listing => listing.title), [
    "Appartement T2 Gambetta", "Studio lumineux Wazemmes", "T2 Vieux-Lille", "Studio meublé Vauban", "Studio Moulins",
  ]);
  assert.equal(analyzeCalls, 2);
});

test("59 vraies annonces Le Bon Coin (Lille, Rennes, Quimper) : exactement les 11 parkings écartés à la lecture, rien d'autre", async () => {
  const { readFileSync } = await import("node:fs");
  const { normalize } = await import("./apify");
  const sample = JSON.parse(readFileSync(new URL("../../test/leboncoin-types.json", import.meta.url), "utf8")) as { subject: string; real_estate_type: string }[];
  const criteria = { location: "Lille", intent: "rent" as const, keywords: "", radius: 5 };
  const dropped = sample.filter(item => !normalize(item, criteria));
  assert.equal(sample.length, 59);
  assert.equal(dropped.length, 11);
  assert.ok(dropped.every(item => item.real_estate_type === "Parking"), dropped.map(item => item.subject).join(", "));
});

test("validOffer : « chambre » ou « non habitable » seulement avec une citation présente dans l'annonce ; roomRange", async () => {
  const { validOffer, roomRange } = await import("./ai");
  const text = "Chambre avec SDB privée - Coliving - Lille Centre\nMaison de 11 chambres.";
  assert.deepEqual(validOffer({ offer: "room", offerEvidence: "Chambre avec SDB privée - Coliving" }, text), { kind: "room", evidence: "Chambre avec SDB privée - Coliving" });
  assert.deepEqual(validOffer({ offer: "room", offerEvidence: "colocation à 4" }, text), { kind: "unclear", evidence: "" });
  assert.deepEqual(validOffer({ offer: "non_dwelling", offerEvidence: "" }, text), { kind: "unclear", evidence: "" });
  assert.deepEqual(validOffer({ offer: "entire" }, text), { kind: "entire", evidence: "" });
  assert.deepEqual(validOffer({ offer: "villa" }, text), { kind: "unclear", evidence: "" });
  assert.deepEqual(roomRange(1, 2), { minRooms: 1, maxRooms: 2 });
  assert.deepEqual(roomRange(3, 2), { minRooms: 2, maxRooms: 3 });
  assert.deepEqual(roomRange(0, null), { minRooms: null, maxRooms: null });
});
