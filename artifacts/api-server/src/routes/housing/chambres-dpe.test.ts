import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { fatihRecord } from "../../test/fatih";
import { coveredByStructured, landAreaClause } from "./ai";
import { checksFor, contradictsDeclared, declaredBedrooms, declaredEnergyClass, evaluateStructured, queryMinRooms } from "./criteria";
import { leboncoinSearchUrl } from "./housing-search";
import type { Criteria } from "./store";

// Cas signalé : « 3 chambres ou plus » était lu comme « au moins 3 pièces » (une maison de 3 pièces n'a que 2 chambres) et
// « DPE minimum D » restait un souhait lu au mieux dans le texte, alors que le site donne ces deux champs.

const base: Criteria = { location: "Rennes", intent: "rent", keywords: "", radius: 5, maxPrice: 1000, propertyType: "house", minBedrooms: 3, minEnergyClass: "D" };

test("declaredBedrooms : « 3 », « 3 ch. », un nombre ; absent, vide ou incompréhensible = null (jamais deviné)", () => {
  assert.deepEqual(["3", "3 ch.", " 2 chambres ", 4, "0"].map(declaredBedrooms), [3, 3, 2, 4, 0]);
  assert.deepEqual([null, undefined, "", "abc", "trois", "2,5", "-1", "300"].map(declaredBedrooms), [null, null, null, null, null, null, null, null]);
});

test("declaredEnergyClass : une lettre de A à G (casse libre) ; « N », « vierge », absent = null", () => {
  assert.deepEqual(["d", "D", " b ", "g"].map(declaredEnergyClass), ["D", "D", "B", "G"]);
  assert.deepEqual(["N", "nc", "vierge", "", null, undefined, "H", "DD"].map(declaredEnergyClass), [null, null, null, null, null, null, null, null]);
});

test("queryMinRooms : « N chambres » suppose au moins N pièces, jamais plus ; le plus grand minimum gagne", () => {
  assert.equal(queryMinRooms({ minRooms: 3, minBedrooms: null }), 3);
  assert.equal(queryMinRooms({ minRooms: null, minBedrooms: 3 }), 3);
  assert.equal(queryMinRooms({ minRooms: 4, minBedrooms: 3 }), 4);
  assert.equal(queryMinRooms({ minRooms: 2, minBedrooms: 5 }), 5);
  assert.equal(queryMinRooms({ minRooms: null, minBedrooms: null }), null);
  assert.equal(queryMinRooms({}), null);
});

test("requête Le Bon Coin : les chambres donnent le filtre de pièces, large ; aucun filtre de DPE (non vérifié côté site)", () => {
  const params = new URL(String(leboncoinSearchUrl(base, null))).searchParams;
  assert.equal(params.get("rooms"), "3-max");
  assert.equal(params.get("energy_rate"), null, "le DPE est vérifié à la lecture, pas demandé au site");
  assert.equal(new URL(String(leboncoinSearchUrl({ ...base, minBedrooms: null }, null))).searchParams.get("rooms"), null);
  assert.equal(new URL(String(leboncoinSearchUrl({ ...base, minRooms: 5 }, null))).searchParams.get("rooms"), "5-max");
});

test("checksFor : un critère « chambres » et un critère « DPE », sans critère de pièces tant que la personne n'en demande pas", () => {
  assert.deepEqual(checksFor(base).map(check => [check.id, check.label]), [
    ["location", "Lieu : Rennes"], ["price", "Budget : 0 à 1000 €"], ["bedrooms", "Au moins 3 chambres"], ["energy", "DPE D ou mieux"],
  ]);
  assert.equal(checksFor({ ...base, minBedrooms: 1 }).find(check => check.id === "bedrooms")?.label, "Au moins 1 chambre");
  assert.ok(checksFor({ ...base, minRooms: 4 }).some(check => check.id === "rooms"));
});

const basics = { price: 900, area: 90, rooms: 4, location: "Rennes" };
const attributes = (...pairs: [string, string, string][]) => ({ attributes: pairs.map(([key, value, value_label]) => ({ key, value, value_label })) });
const status = (raw: Record<string, unknown>, id: string, criteria = base) => evaluateStructured(criteria, basics, raw).find(check => check.id === id);

test("chambres : confirmé ou contredit par le champ du site (source « api »), inconnu quand il manque", () => {
  assert.equal(status(attributes(["bedrooms", "3", "3 ch."]), "bedrooms")?.status, "confirmed");
  assert.equal(status(attributes(["bedrooms", "5", "5 ch."]), "bedrooms")?.status, "confirmed");
  const two = status(attributes(["bedrooms", "2", "2 ch."]), "bedrooms");
  assert.deepEqual([two?.status, two?.source, two?.value], ["contradicted", "api", "2 chambres"]);
  // Libellé au premier niveau (acteur de repli) ou champ absent.
  assert.equal(status({ bedrooms: "2 ch." }, "bedrooms")?.status, "contradicted");
  assert.equal(status({}, "bedrooms")?.status, "unknown");
  assert.equal(status(attributes(["bedrooms", "", ""]), "bedrooms")?.status, "unknown");
});

test("DPE : de A jusqu'à la classe demandée = confirmé, au-delà = contredit ; « N », vierge ou absent = inconnu", () => {
  const verdicts = Object.fromEntries(["a", "d", "e", "g", "n", ""].map(rate => [rate, status(attributes(["energy_rate", rate, rate.toUpperCase()]), "energy")?.status]));
  assert.deepEqual(verdicts, { a: "confirmed", d: "confirmed", e: "contradicted", g: "contradicted", n: "unknown", "": "unknown" });
  assert.equal(status({}, "energy")?.status, "unknown");
  assert.equal(status({ energy_rate: "F" }, "energy")?.status, "contradicted");
  assert.equal(status(attributes(["energy_rate", "e", "E"]), "energy", { ...base, minEnergyClass: "E" })?.status, "confirmed");
});

test("contradictsDeclared : seulement un critère chambres ou DPE contredit par le site ; ni texte lu, ni inconnu, ni autre critère", () => {
  const result = (id: string, statusValue: "confirmed" | "contradicted" | "unknown", source: "api" | "description") => ({ id, label: id, status: statusValue, source, value: "", evidence: "" });
  assert.equal(contradictsDeclared({ criterionResults: [result("bedrooms", "contradicted", "api")] }), true);
  assert.equal(contradictsDeclared({ criterionResults: [result("energy", "contradicted", "api")] }), true);
  assert.equal(contradictsDeclared({ criterionResults: [result("bedrooms", "contradicted", "description")] }), false, "lecture de texte : jamais écartée");
  assert.equal(contradictsDeclared({ criterionResults: [result("bedrooms", "unknown", "api"), result("energy", "confirmed", "api")] }), false);
  assert.equal(contradictsDeclared({ criterionResults: [result("wish-1", "contradicted", "api")] }), false);
});

test("coveredByStructured : « 3 chambres ou plus » et « DPE minimum D » ne font plus doublon avec leur critère", () => {
  const both = { bedrooms: true, energy: true };
  for (const wish of ["3 chambres ou plus", "trois chambres", "au moins 2 chambres", "chambres : 3 minimum"]) assert.equal(coveredByStructured(wish, both), true, wish);
  for (const wish of ["DPE minimum D", "classe énergie D ou mieux", "diagnostic de performance énergétique C"]) assert.equal(coveredByStructured(wish, both), true, wish);
  for (const wish of ["terrain de 1500 m2", "chambre au rez-de-chaussée", "proche de l'aéroport", "balcon"]) assert.equal(coveredByStructured(wish, both), false, wish);
  assert.equal(coveredByStructured("3 chambres ou plus", { bedrooms: false, energy: true }), false, "sans critère structuré, le souhait reste");
  assert.equal(coveredByStructured("DPE minimum D", { bedrooms: true, energy: false }), false);
});

test("landAreaClause : « un terrain de 1500 m2 » n'est pas une surface habitable ; une vraie surface ne l'est jamais", () => {
  assert.equal(landAreaClause(PROMPT, 1500), "terrain de 1500 m2");
  assert.equal(landAreaClause("Maison avec un jardin de 800 m² à Lille", 800), "jardin de 800 m²");
  assert.equal(landAreaClause("Maison avec 1 500 m² de terrain", 1500), "1 500 m² de terrain");
  assert.equal(landAreaClause("Une maison, terrain de 2000 m2 minimum", 2000), "terrain de 2000 m2");
  // Surfaces de logement, ou nombre absent de la demande : jamais touchées.
  assert.equal(landAreaClause("Un appartement de 60 m² minimum à Lille", 60), null);
  assert.equal(landAreaClause("Maison de 100 m² habitable avec terrain", 100), null);
  assert.equal(landAreaClause("Maison surface 90 m², jardin de 300 m²", 90), null);
  assert.equal(landAreaClause("Maison avec terrain", 1500), null);
  assert.equal(landAreaClause(PROMPT, null), null);
});

// --- De bout en bout : faux LLM et faux Apify -------------------------------------------------------------------------
const PROMPT = "Une maison à moins de 30min de voiture de l’aéroport de Rennes, moins de 1000€ de loyer, un DPE de minimum D. 3 chambres ou plus, un terrain de 1500 m2";
const ad = (n: number, title: string, extra: Partial<Parameters<typeof fatihRecord>[0]> = {}) => fatihRecord({
  url: `https://www.leboncoin.fr/ad/locations/60${n}`, title, description: `${title}. Terrain de 1500 m². Loyer 900 € charges comprises.`,
  price: 900, area: 100, rooms: 5, city: "Rennes", realEstateType: "1", ...extra,
});
const dataset = [
  ad(1, "Maison A : 3 chambres, DPE C", { bedrooms: 3, energyRate: "c" }),
  ad(2, "Maison B : 2 chambres, DPE C", { bedrooms: 2, energyRate: "c" }), // trop peu de chambres : écartée
  ad(3, "Maison C : 4 chambres, DPE F", { bedrooms: 4, energyRate: "f" }), // DPE trop mauvais : écartée
  ad(4, "Maison D : champs absents"), // le site ne dit rien : gardée, à vérifier
  ad(5, "Maison E : DPE non communiqué", { bedrooms: 3, energyRate: "n" }), // « N » : inconnu, gardée
  ad(6, "Maison F : 3 ch., DPE D", { bedrooms: "3 ch.", energyRate: "D" }),
  ad(7, "Maison G : 2 chambres dans la description", { energyRate: "b" }), // champ chambres absent : jamais écartée sur le texte
];
let fake: Server;
const actorInputs: Record<string, unknown>[] = [];
let proposed: Record<string, unknown> = {};

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
          content = { location: "Rennes", intent: "rent", maxPrice: 1000, radius: 5, keywords: "", propertyType: "house", ...proposed,
            uncertainChecks: [{ label: "3 chambres ou plus", availability: "description", apiField: null }, { label: "DPE minimum D", availability: "description", apiField: null },
              { label: "terrain de 1500 m2", availability: "description", apiField: null }], places: [] };
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
    if (row.status !== "running" && !row.task) return row;
  }
  throw new Error("La recherche ne se termine pas");
}

test("de bout en bout : chambres et DPE interprétés à part, souhaits sans doublon, requête large, écartées seulement sur les champs du site", async () => {
  const { createSearch, getSearch } = await import("./store");
  proposed = { minBedrooms: 3, minEnergyClass: "D" };
  const id = await createSearch(PROMPT);
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  assert.deepEqual([search?.criteria.minBedrooms, search?.criteria.minEnergyClass, search?.criteria.minRooms ?? null], [3, "D", null]);
  assert.deepEqual(search?.criteria.wishes, ["terrain de 1500 m2"], "chambres et DPE ne sont plus des souhaits en double");
  assert.deepEqual(search?.criteria.checks?.map(check => check.label), ["Lieu : Rennes", "Budget : 0 à 1000 €", "Au moins 3 chambres", "DPE D ou mieux", "terrain de 1500 m2"]);
  assert.equal(new URL(String((actorInputs.at(-1)?.startUrls as string[])[0])).searchParams.get("rooms"), "3-max");

  // B (2 chambres) et C (DPE F) contredits par le site : écartées. D, E, G : le site ne dit pas, gardées.
  assert.deepEqual(search?.listings.map(listing => listing.title).sort(), [
    "Maison A : 3 chambres, DPE C", "Maison D : champs absents", "Maison E : DPE non communiqué", "Maison F : 3 ch., DPE D", "Maison G : 2 chambres dans la description",
  ]);
  const verdict = (title: string, id: string) => search?.listings.find(listing => listing.title === title)?.criterionResults.find(check => check.id === id);
  assert.deepEqual([verdict("Maison A : 3 chambres, DPE C", "bedrooms")?.status, verdict("Maison A : 3 chambres, DPE C", "energy")?.status], ["confirmed", "confirmed"]);
  assert.deepEqual([verdict("Maison F : 3 ch., DPE D", "bedrooms")?.status, verdict("Maison F : 3 ch., DPE D", "energy")?.status], ["confirmed", "confirmed"]);
  assert.deepEqual([verdict("Maison D : champs absents", "bedrooms")?.status, verdict("Maison D : champs absents", "energy")?.status], ["unknown", "unknown"]);
  assert.equal(verdict("Maison E : DPE non communiqué", "energy")?.status, "unknown");
});

test("de bout en bout : « terrain de 1500 m2 » pris par le LLM pour la surface habitable → surface annulée, gardé comme souhait, requête sans filtre de surface", async () => {
  const { createSearch, getSearch } = await import("./store");
  proposed = { minBedrooms: 3, minEnergyClass: "D", minArea: 1500, uncertainChecksOverride: [] };
  const id = await createSearch(PROMPT);
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  assert.equal(search?.criteria.minArea ?? null, null);
  assert.equal(new URL(String((actorInputs.at(-1)?.startUrls as string[])[0])).searchParams.get("square"), null, "pas de square=1500-max : zéro résultat assuré");
  assert.deepEqual(search?.criteria.wishes, ["terrain de 1500 m2"], "gardé une seule fois, même si le LLM le liste déjà");
  assert.ok(search?.listings.length, "des annonces ressortent");
});

test("de bout en bout : valeurs inattendues du LLM (« trois », « Z », 0) ignorées ; sans chambres ni DPE, rien n'est écarté", async () => {
  const { createSearch, getSearch } = await import("./store");
  proposed = { minBedrooms: "trois", minEnergyClass: "Z" };
  const id = await createSearch(PROMPT);
  assert.equal((await runToCompletion(id)).status, "completed");
  const search = await getSearch(id);
  assert.deepEqual([search?.criteria.minBedrooms, search?.criteria.minEnergyClass], [null, null]);
  // Les souhaits « 3 chambres… » et « DPE… » restent alors des souhaits, lus dans le texte comme avant.
  assert.deepEqual(search?.criteria.wishes, ["3 chambres ou plus", "DPE minimum D", "terrain de 1500 m2"]);
  assert.equal(search?.listings.length, dataset.length, "aucune annonce écartée sans critère structuré");
  proposed = { minBedrooms: 0, minEnergyClass: " d " };
  const second = await getSearch(await createSearch(PROMPT).then(async created => { await runToCompletion(created); return created; }));
  assert.deepEqual([second?.criteria.minBedrooms, second?.criteria.minEnergyClass], [null, "D"], "0 chambre = pas d'exigence ; « d » accepté");
});
