import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { fatihRecord } from "../../test/fatih";
import { housingActorInput } from "./housing-search";
import { declaredType, matchesPropertyType, realEstateTypes } from "./property-type";

// Cas signalé en production : « Une maison à moins de 30 min de l'aéroport de Rennes… » ne renvoyait que des appartements,
// faute de critère « type de bien » : la requête demandait toujours « maison ou appartement » (real_estate_type=1,2).

const base = { location: "Rennes", intent: "rent" as const, keywords: "", radius: 10, maxPrice: 1000 };
const queryOf = (criteria: Parameters<typeof housingActorInput>[0]) => new URL(String(((housingActorInput(criteria).input as { startUrls: string[] }).startUrls)[0])).searchParams;

test("real_estate_type : maison = 1 + 5, appartement = 2 + 5, sans préférence = 1 + 2 comme avant", () => {
  assert.equal(realEstateTypes("house"), "1,5");
  assert.equal(realEstateTypes("apartment"), "2,5");
  assert.equal(realEstateTypes(null), "1,2");
  assert.equal(realEstateTypes(undefined), "1,2");
});

test("requête Le Bon Coin : le type demandé part dans real_estate_type, jamais en mot-clé ; les autres filtres restent", () => {
  const house = queryOf({ ...base, propertyType: "house", keywords: "maison avec terrain", minRooms: 4 });
  assert.equal(house.get("real_estate_type"), "1,5");
  assert.equal(house.get("text"), null, "« maison » en mot-clé ferait perdre pavillons, villas et longères");
  assert.equal(house.get("price"), "min-1000");
  assert.equal(house.get("rooms"), "4-max");
  assert.equal(queryOf({ ...base, propertyType: "apartment", keywords: "appartement" }).get("real_estate_type"), "2,5");
  assert.equal(queryOf({ ...base, propertyType: "apartment", keywords: "appartement" }).get("text"), null);
  // Sans type demandé : comportement inchangé (mot-clé « maison » et 1,2).
  const none = queryOf({ ...base, keywords: "maison" });
  assert.deepEqual([none.get("real_estate_type"), none.get("text")], ["1,2", "maison"]);
  // Un autre type de logement ou un équipement reste un mot-clé, comme avant.
  assert.equal(queryOf({ ...base, propertyType: "apartment", keywords: "studio" }).get("text"), "studio");
  assert.equal(queryOf({ ...base, propertyType: "house", keywords: "maison", wishes: ["jardin"] }).get("text"), "jardin");
});

test("declaredType : libellé ou code Le Bon Coin ; type absent ou inconnu = null", () => {
  assert.deepEqual(["Maison", "1", " maison "].map(declaredType), ["house", "house", "house"]);
  assert.deepEqual(["Appartement", "2"].map(declaredType), ["apartment", "apartment"]);
  assert.deepEqual(["Autre", "5"].map(declaredType), ["other", "other"]);
  assert.deepEqual(["", "Parking", "7"].map(declaredType), [null, null, null]);
});

test("matchesPropertyType : écarté seulement si l'annonce se déclare clairement de l'autre type ET que son titre ne dit pas le contraire", () => {
  // Maison demandée.
  assert.equal(matchesPropertyType("house", "house", "Maison T4"), true);
  assert.equal(matchesPropertyType("house", "apartment", "Appartement T2 Gambetta"), false);
  assert.equal(matchesPropertyType("house", "apartment", "Studio meublé"), false);
  assert.equal(matchesPropertyType("house", "apartment", "Jolie maison de ville T4"), true, "maison mal classée par son auteur : gardée");
  assert.equal(matchesPropertyType("house", "apartment", "Pavillon 90 m²"), true);
  assert.equal(matchesPropertyType("house", "apartment", "Villa avec piscine"), true);
  assert.equal(matchesPropertyType("house", "other", "Chalet à louer"), true, "« Autre » : jamais écarté d'avance");
  assert.equal(matchesPropertyType("house", null, "T3 Fives"), true, "type absent : gardée");
  // Appartement demandé : un « T3 » seul ne prouve rien (il y en a dans les maisons).
  assert.equal(matchesPropertyType("apartment", "house", "Maison T3 Fives"), false);
  assert.equal(matchesPropertyType("apartment", "house", "Studio au calme"), true);
  assert.equal(matchesPropertyType("apartment", "house", "Appartement dans maison de ville"), true);
  assert.equal(matchesPropertyType("apartment", "apartment", "T2"), true);
  // Pas de préférence : tout passe.
  assert.equal(matchesPropertyType(null, "apartment", "Appartement"), true);
  assert.equal(matchesPropertyType(undefined, "house", "Maison"), true);
});

test("lecture : maison demandée, les appartements déclarés comme tels sont écartés ; maison mal classée, « Autre » et type absent restent", async () => {
  const { normalize } = await import("./apify");
  const record = (n: number, title: string, type: "1" | "2" | "5") => fatihRecord({ url: `https://www.leboncoin.fr/ad/locations/80${n}`, title, description: `${title}. Loyer 900 €.`, price: 900, area: 90, rooms: 4, city: "Rennes", realEstateType: type });
  const kept = (criteria: Parameters<typeof normalize>[1], title: string, type: "1" | "2" | "5") => normalize(record(1, title, type), criteria) !== null;
  const house = { ...base, propertyType: "house" as const };
  assert.equal(kept(house, "Maison T4 avec jardin", "1"), true);
  assert.equal(kept(house, "Appartement T3 centre", "2"), false);
  assert.equal(kept(house, "Maison de ville T4", "2"), true);
  assert.equal(kept(house, "Chalet 3 chambres", "5"), true);
  assert.equal(kept({ ...base, propertyType: "apartment" as const }, "Maison T4 avec jardin", "1"), false);
  assert.equal(kept(base, "Maison T4 avec jardin", "1"), true, "sans préférence : rien n'est écarté");
  assert.equal(kept(base, "Appartement T3 centre", "2"), true);
});

test("classification d'une annonce sans le champ (acteur de repli) : gardée", async () => {
  const { normalize } = await import("./apify");
  const bare = { url: "https://www.leboncoin.fr/ad/locations/811", subject: "T3 Fives", body: "Loyer 700 €.", price_euros: 700, square: 60, rooms: 3, location: { city: "Rennes" } };
  assert.notEqual(normalize(bare, { ...base, propertyType: "house" }), null);
});

// --- De bout en bout : la demande de l'utilisateur, un faux LLM et un faux Apify ---------------------------------------
const PROMPT = "Une maison à moins de 30min de voiture de l’aéroport de Rennes, moins de 1000€ de loyer, un DPE de minimum D. 3 chambres ou plus, un terrain de 1500 m2";
const ad = (n: number, title: string, realEstateType: "1" | "2" | "5", rooms = 4) => fatihRecord({
  url: `https://www.leboncoin.fr/ad/locations/70${n}`, title, description: `${title}. Loyer 900 € charges comprises.`, price: 900, area: 90, rooms, city: "Rennes", realEstateType,
});
const dataset = [
  ad(1, "Maison T4 avec terrain 1500 m²", "1"),
  ad(2, "Appartement T4 Villejean", "2"),
  ad(3, "Longère rénovée, 4 chambres", "1", 5),
  ad(4, "Studio meublé Beaulieu", "2", 1),
  ad(5, "Maison de campagne à Melesse", "2"), // mal classée « Appartement » par son auteur, le titre dit « maison »
  ad(6, "Chalet toutes saisons, 3 chambres", "5", 4),
];
let fake: Server;
const actorInputs: Record<string, unknown>[] = [];
let proposed: unknown = "house";

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v2/acts/fatihtahta~leboncoin-fr-scraper/runs")) { actorInputs.push(JSON.parse(body)); return json({ data: { id: "run-1" } }); }
      if (url.startsWith("/v2/actor-runs/")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds-1" } });
      if (url.startsWith("/v2/datasets/")) return json(dataset);
      if (url.endsWith("/chat/completions")) {
        const request = JSON.parse(body) as { messages: { content: string }[] };
        let content: unknown;
        if (request.messages[0].content.includes("Interprète une demande")) {
          content = { location: "Rennes", intent: "rent", maxPrice: 1000, minRooms: 4, radius: 15, keywords: "maison terrain", propertyType: proposed,
            uncertainChecks: [{ label: "DPE D minimum", availability: "description", apiField: null }, { label: "terrain de 1500 m²", availability: "description", apiField: null }], places: [] };
        } else {
          const { listings } = JSON.parse(request.messages[1].content) as { listings: { id: number; title: string; wantGeneral: boolean }[] };
          content = { items: listings.map(item => ({ id: item.id, checks: [], ...(item.wantGeneral ? { summary: "Logement.", summaryEvidence: [item.title], features: [], offer: "entire", offerEvidence: "" } : {}) })) };
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
    if (row.status !== "running" && !row.task) return row; // terminée, et plus aucune tâche en cours
  }
  throw new Error("La recherche ne se termine pas");
}


test("de bout en bout : « une maison… » est interprétée en maison, demandée à Le Bon Coin en type 1+5, et les appartements ne ressortent pas", async () => {
  const { createSearch, getSearch } = await import("./store");
  proposed = "house";
  const id = await createSearch(PROMPT);
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  assert.equal(search?.criteria.propertyType, "house");
  const params = new URL(String((actorInputs.at(-1)?.startUrls as string[])[0])).searchParams;
  assert.equal(params.get("real_estate_type"), "1,5");
  assert.equal(params.get("text"), null);
  assert.equal(params.get("rooms"), "4-max");
  // Les deux appartements déclarés comme tels sont écartés ; la maison mal classée (titre « maison ») et le chalet « Autre » restent.
  assert.deepEqual(search?.listings.map(listing => listing.title).sort(), [
    "Chalet toutes saisons, 3 chambres", "Longère rénovée, 4 chambres", "Maison T4 avec terrain 1500 m²", "Maison de campagne à Melesse",
  ].sort());
});

test("de bout en bout : une valeur inattendue du LLM (« villa ») ne devient pas un filtre ; sans type, rien n'est écarté", async () => {
  const { createSearch, getSearch } = await import("./store");
  proposed = "villa";
  const id = await createSearch(PROMPT);
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  assert.equal(search?.criteria.propertyType, null);
  assert.equal(new URL(String((actorInputs.at(-1)?.startUrls as string[])[0])).searchParams.get("real_estate_type"), "1,2");
  // Sans type demandé, l'appartement T4 ressort (seul le studio d'une pièce est écarté, par le minimum de pièces).
  assert.equal(search?.listings.length, 5);
  assert.ok(search?.listings.some(listing => listing.title === "Appartement T4 Villejean"));
});
