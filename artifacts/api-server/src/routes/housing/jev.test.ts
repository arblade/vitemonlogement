// Lecture des annonces en trois étages : Le Bon Coin (certain, gratuit), Jev (décisions typées, peu cher), LLM (critères
// complexes, résumé, adresse). Aucun appel réel : faux Jev (fonction ou faux serveur HTTP) et faux LLM.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { analyze, type JsonLlm } from "./ai";
import { CATALOGUE, catalogueFor, sentenceWith, specificities, wantsAbsence } from "./catalogue";
import { evaluateStructured } from "./criteria";
import { normalize } from "./apify";
import { readWithJev } from "./jev-reader";
import { jevDecide, readAnswers, type JevChoiceQuestion, type JevDecide } from "../../lib/jev";
import { memoryAnalysisCache } from "../../lib/analysis-cache";
import { fatihRecord } from "../../test/fatih";
import type { Criteria, Listing } from "./store";

const criteriaOf = (wishes: string[]): Criteria => ({ location: "Lille", intent: "rent", keywords: "", radius: 5, maxPrice: 900, wishes });
const spec = (value: string) => ({ attributes: [{ key: "specificities", value_label: value }] });

// --- Étage 1 : Le Bon Coin ------------------------------------------------------------------------------------------

test("« Spécificités » de Le Bon Coin : cases cochées lues, chaîne ou liste", () => {
  assert.deepEqual(specificities(spec("Cave, Interphone, Animaux autorisés")), ["cave", "interphone", "animaux autorisés"]);
  assert.deepEqual(specificities({ attributes: [{ key: "specificities", values_label: ["Gardien", "Cuisine équipée"] }] }), ["gardien", "cuisine équipée"]);
  assert.deepEqual(specificities({}), []);
});

test("critères tranchés par Le Bon Coin seul : case cochée = oui ; case absente = non précisé (jamais non) ; « sans … » inversé", () => {
  const criteria = criteriaOf(["cave", "chat accepté", "interphone", "gardien", "sans ascenseur", "pas de rez-de-chaussée", "balcon"]);
  const raw = { ...spec("Cave, Animaux autorisés, Interphone"), attributes: [...spec("Cave, Animaux autorisés, Interphone").attributes,
    { key: "elevator", value_label: "Non" }, { key: "floor_property", value_label: "['Pas de rez-de-chaussée', 'Dernier étage']" }] };
  const results = evaluateStructured(criteria, { price: 600, area: 30, rooms: 1, location: "Lille" }, raw);
  const status = (label: string) => results.find(check => check.label === label)?.status;
  assert.equal(status("cave"), "confirmed");
  assert.equal(status("chat accepté"), "confirmed");
  assert.equal(status("interphone"), "confirmed");
  assert.equal(status("gardien"), "unknown", "case non cochée : non précisé, pas « non »");
  assert.equal(status("sans ascenseur"), "confirmed", "pas d'ascenseur : le souhait « sans ascenseur » est satisfait");
  assert.equal(status("pas de rez-de-chaussée"), "confirmed");
  assert.equal(status("balcon"), "unknown");
  assert.equal(results.find(check => check.label === "cave")?.source, "api");
});

test("caractéristiques affichées sans IA : cases cochées, chauffage, dernier étage ; jamais de date de disponibilité (champ auto-rempli, souvent faux)", () => {
  const record = fatihRecord({ url: "https://www.leboncoin.fr/ad/locations/1", title: "T2", description: "Bel appartement.", price: 700, area: 40, rooms: 2 });
  const data = JSON.parse(record.source_data as string);
  data.attributes.push(
    { key: "specificities", value_label: "Avec garage ou place de parking, Cuisine équipée, Cave, Interphone, Gardien" },
    { key: "heating_type", value_label: "Individuel" }, { key: "heating_mode", value_label: "Gaz" },
    { key: "available_date", value_label: "01/11/2026" }, { key: "floor_property", value_label: "['Dernier étage']" },
  );
  const listing = normalize({ ...record, source_data: JSON.stringify(data) }, criteriaOf([]))!;
  const shown = Object.fromEntries(listing.features.map(feature => [feature.label, feature.value]));
  for (const label of ["Parking", "Cuisine équipée", "Cave", "Interphone", "Gardien", "Dernier étage"]) assert.equal(shown[label], "", label);
  assert.equal(shown.Chauffage, "Individuel · gaz");
  // « available_date » : souvent rempli par défaut (mois de publication), parfois déjà passé ou contredit par le texte.
  assert.equal(shown.Disponible, undefined);
  assert.ok(!listing.features.some(feature => /\d{1,2}\/\d{4}|disponib/i.test(`${feature.label} ${feature.value}`)));
  assert.ok(listing.features.every(feature => feature.source === "annonce"));
});

// --- Catalogue -------------------------------------------------------------------------------------------------------

test("catalogue : un souhait simple vise une caractéristique ; une phrase complexe reste au LLM", () => {
  assert.equal(catalogueFor("balcon")?.id, "balcony");
  assert.equal(catalogueFor("chat accepté")?.id, "pets");
  assert.equal(catalogueFor("proche métro")?.id, "transport");
  assert.equal(catalogueFor("lave-vaisselle")?.id, "dishwasher");
  assert.equal(catalogueFor("calme"), undefined);
  assert.equal(catalogueFor("à moins de 20 minutes de mon travail en vélo par la piste cyclable"), undefined);
  assert.ok(wantsAbsence("sans ascenseur") && wantsAbsence("pas de rez-de-chaussée") && wantsAbsence("non meublé"));
  assert.ok(!wantsAbsence("balcon"));
  assert.equal(sentenceWith("Appartement lumineux. Joli balcon plein sud ! Proche métro.", /balcon/i), "Joli balcon plein sud !");
  assert.equal(sentenceWith("Appartement lumineux.", /balcon/i), null);
  assert.equal(new Set(CATALOGUE.map(feature => feature.id)).size, CATALOGUE.length, "identifiants uniques");
});

// --- Client Jev (faux serveur HTTP) -----------------------------------------------------------------------------------

test("client Jev : requête (clé, texte, questions) et réponses lues quel que soit leur habillage", async () => {
  let received: { auth?: string; body?: { state: string; questions: Record<string, JevChoiceQuestion>; model?: string } } = {};
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      received = { auth: req.headers.authorization, body: JSON.parse(body) };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ model: "jev-1.13", answers: {
        balcony: { choice: "yes", confidence: 0.97, probabilities: { yes: 0.97, no: 0.01, unstated: 0.02 } },
        offer: { probabilities: { entire: 0.2, room: 0.8 } },
      }, usage: { input_tokens: 412 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  process.env.JEV_API_KEY = "jev_test";
  process.env.JEV_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/systemone`;
  process.env.JEV_MODEL = "jev-1.13";
  try {
    const question = { type: "choice" as const, instructions: "Balcon ?", criteria: { yes: "oui", no: "non", unstated: "?" } };
    const result = await jevDecide("Joli balcon.", { balcony: question, offer: question, missing: question });
    assert.equal(received.auth, "Bearer jev_test");
    assert.equal(received.body?.state, "Joli balcon.");
    assert.equal(received.body?.model, "jev-1.13");
    assert.deepEqual(Object.keys(received.body!.questions), ["balcony", "offer", "missing"]);
    assert.equal(result.inputTokens, 412);
    assert.deepEqual(result.answers.balcony, { choice: "yes", confidence: 0.97, probabilities: { yes: 0.97, no: 0.01, unstated: 0.02 } });
    assert.equal(result.answers.offer.choice, "room", "sans « choice » : l'option la plus probable");
    assert.equal(result.answers.offer.confidence, 0.8);
    assert.equal(result.answers.missing, undefined, "question sans réponse : rien");
  } finally {
    server.close();
    delete process.env.JEV_API_KEY; delete process.env.JEV_MODEL; process.env.JEV_BASE_URL = "http://127.0.0.1:1";
  }
  assert.deepEqual(readAnswers({ decisions: { x: { answer: "no", confidence: "0.9" } } }, ["x"]).x, { choice: "no", confidence: 0.9, probabilities: {} });
});

// --- Étage 2 : lecture par Jev, garde-fous ----------------------------------------------------------------------------

type Scripted = Record<string, { choice: string; confidence: number }>;
/** Faux Jev : répond selon un script, et garde les questions posées. */
function fakeJev(script: Scripted) {
  const asked: string[][] = [];
  const decide: JevDecide = async (_state, questions) => {
    asked.push(Object.keys(questions));
    return { answers: Object.fromEntries(Object.keys(questions).filter(name => script[name]).map(name => [name, { ...script[name], probabilities: {} }])), inputTokens: 300 };
  };
  return { decide, asked };
}
const listing = (description: string, extra: Partial<Listing> = {}) => ({ title: "Studio Lille", description, features: [], ...extra }) as Pick<Listing, "title" | "description" | "features">;
const wish = (id: string, label: string) => ({ id, label, status: "unknown" as const, source: "unknown" as const, value: "", evidence: "" });

test("Jev : questions seulement sur les sujets présents dans l'annonce et pas déjà donnés par Le Bon Coin", async () => {
  const { decide, asked } = fakeJev({});
  await readWithJev(listing("Studio avec balcon et cave. Ascenseur. Proche métro.", {
    features: [{ label: "Ascenseur", value: "Oui", source: "annonce", evidence: "" }],
  } as Partial<Listing>), [], decide);
  assert.deepEqual(asked[0].sort(), ["balcony", "cellar", "offer", "outdoor", "transport"].filter(id => id !== "outdoor").sort(),
    "pas l'ascenseur (Le Bon Coin l'a dit), pas le jardin (absent du texte)");
});

test("Jev : réponse retenue au-dessus du seuil, avec la phrase de l'annonce comme preuve ; « non » explicite ; incertain ignoré", async () => {
  const { decide } = fakeJev({ balcony: { choice: "yes", confidence: 0.96 }, pets: { choice: "no", confidence: 0.92 }, cellar: { choice: "yes", confidence: 0.7 } });
  const reading = await readWithJev(listing("Studio refait. Grand balcon sur cour. Animaux non acceptés. Cave possible."), [], decide);
  assert.deepEqual(reading.features, [
    { label: "Balcon", value: "", source: "ia", evidence: "Grand balcon sur cour." },
    { label: "Animaux acceptés", value: "Non", source: "ia", evidence: "Animaux non acceptés." },
  ], "la cave (0,70) n'est pas retenue");
});

test("Jev : critères de l'utilisateur tranchés (« sans … » inversé) ; sujet absent du texte → laissé au LLM", async () => {
  const { decide } = fakeJev({ balcony: { choice: "yes", confidence: 0.95 }, elevator: { choice: "no", confidence: 0.9 }, pets: { choice: "yes", confidence: 0.99 } });
  const checks = [wish("wish-1", "balcon"), wish("wish-2", "sans ascenseur"), wish("wish-3", "chat accepté"), wish("wish-4", "calme")];
  const reading = await readWithJev(listing("Joli balcon. Immeuble sans ascenseur."), checks, decide);
  const verdicts = Object.values(reading.verdicts);
  assert.equal(verdicts.length, 2, "chat (non mentionné) et calme (complexe) restent au LLM");
  assert.deepEqual(verdicts.map(verdict => [verdict.status, verdict.evidence]), [["confirmed", "Joli balcon."], ["confirmed", "Immeuble sans ascenseur."]]);
});

test("Jev : écarter une annonce (chambre) exige 0,90 et une phrase qui le montre", async () => {
  const room = (confidence: number, text: string) => readWithJev(listing(text), [], fakeJev({ offer: { choice: "room", confidence } }).decide);
  assert.deepEqual((await room(0.95, "Chambre dans une colocation de 4. Cuisine partagée.")).offer, { kind: "room", evidence: "Chambre dans une colocation de 4." });
  assert.equal((await room(0.88, "Chambre dans une colocation de 4.")).offer, null, "pas assez sûr : le LLM tranchera");
  assert.equal((await room(0.97, "Studio lumineux proche gare.")).offer, null, "rien dans le texte ne le montre");
  const entire = await readWithJev(listing("Studio lumineux."), [], fakeJev({ offer: { choice: "entire", confidence: 0.9 } }).decide);
  assert.deepEqual(entire.offer, { kind: "entire", evidence: "" });
});

// --- Les trois étages ensemble ----------------------------------------------------------------------------------------

/** Faux LLM : garde ce qu'on lui demande, répond pour les critères (« calme » confirmé en citant), résumé et adresse. */
function fakeLlm() {
  const payloads: { toVerify: { id: string; label: string }[]; wantGeneral: boolean; wantFeatures: boolean; wantOffer: boolean }[] = [];
  const llm: JsonLlm = async (_system, user) => {
    const { listings } = JSON.parse(user) as { listings: (typeof payloads[number] & { id: number })[] };
    payloads.push(...listings);
    return { items: listings.map(item => ({
      id: item.id,
      checks: item.toVerify.map(check => /calme/.test(check.label) ? { id: check.id, status: "confirmed", value: "calme", evidence: "rue très calme" } : { id: check.id, status: "unknown", value: "", evidence: "" }),
      ...(item.wantGeneral ? { summary: "Studio avec balcon, rue calme.", summaryEvidence: ["rue très calme"], features: [{ label: "Vue", value: "dégagée", evidence: "rue très calme" }],
        offer: "entire", offerEvidence: "", address: null } : {}),
    })) };
  };
  return { llm, payloads };
}
const fullListing = (criteria: Criteria): Listing => ({
  id: 1, source: "leboncoin", batch: "focused", title: "Studio Lille", url: "https://www.leboncoin.fr/ad/locations/42",
  description: "Studio dans une rue très calme. Joli balcon. Cave. Animaux acceptés.", price: 600, area: 25, rooms: 1, location: "Lille",
  image: null, images: [], aiSummary: null, summaryEvidence: [], score: 60, features: [], lat: null, lng: null, geoPrecision: null,
  criterionResults: evaluateStructured(criteria, { price: 600, area: 25, rooms: 1, location: "Lille" }, {}),
});

test("trois étages : Jev tranche balcon et chat, le LLM ne lit plus que « calme », le résumé et l'adresse", async () => {
  const criteria = criteriaOf(["balcon", "chat accepté", "calme"]);
  const { decide } = fakeJev({ offer: { choice: "entire", confidence: 0.95 }, balcony: { choice: "yes", confidence: 0.97 }, pets: { choice: "yes", confidence: 0.95 }, cellar: { choice: "yes", confidence: 0.93 } });
  const { llm, payloads } = fakeLlm();
  const [result] = await analyze([fullListing(criteria)], criteria, { llm, jev: decide, cache: memoryAnalysisCache() });
  assert.deepEqual(payloads[0].toVerify.map(check => check.label), ["calme"], "balcon et chat ne sont plus demandés au LLM");
  assert.equal(payloads[0].wantFeatures, false);
  assert.equal(payloads[0].wantOffer, false);
  assert.equal(payloads[0].wantGeneral, true, "résumé et adresse : toujours le LLM");
  const status = (label: string) => result.criterionResults.find(check => check.label === label);
  assert.equal(status("balcon")?.status, "confirmed");
  assert.equal(status("balcon")?.evidence, "Joli balcon.");
  assert.equal(status("chat accepté")?.status, "confirmed");
  assert.equal(status("calme")?.status, "confirmed");
  assert.deepEqual(result.features.map(feature => feature.label).sort(), ["Animaux acceptés", "Balcon", "Cave"], "les caractéristiques viennent de Jev, pas du LLM");
  assert.equal(result.aiSummary, "Studio avec balcon, rue calme.");
});

test("Jev en panne : le LLM fait tout, comme avant", async () => {
  const criteria = criteriaOf(["balcon", "calme"]);
  const { llm, payloads } = fakeLlm();
  const broken: JevDecide = async () => { throw new Error("Jev 503"); };
  const [result] = await analyze([fullListing(criteria)], criteria, { llm, jev: broken, cache: memoryAnalysisCache() });
  assert.deepEqual(payloads[0].toVerify.map(check => check.label), ["balcon", "calme"]);
  assert.equal(payloads[0].wantFeatures, true);
  assert.equal(payloads[0].wantOffer, true);
  assert.deepEqual(result.features.map(feature => feature.label), ["Vue"]);
});

test("moteur LLM (par défaut) : Jev n'est jamais appelé", async () => {
  const criteria = criteriaOf(["balcon"]);
  const { llm, payloads } = fakeLlm();
  const { decide, asked } = fakeJev({});
  await analyze([fullListing(criteria)], criteria, { llm, jev: null, cache: memoryAnalysisCache() });
  assert.equal(asked.length, 0);
  void decide;
  assert.equal(payloads[0].wantFeatures, true);
});

test("critères tous tranchés par Jev, extraction générale en cache : aucun appel au LLM, et rien n'est redemandé ensuite", async () => {
  const cache = memoryAnalysisCache();
  const { llm, payloads } = fakeLlm();
  const first = criteriaOf([]);
  await analyze([fullListing(first)], first, { llm, jev: fakeJev({ offer: { choice: "entire", confidence: 0.95 } }).decide, cache });
  assert.equal(payloads.length, 1);
  const second = criteriaOf(["balcon"]);
  const jev = fakeJev({ balcony: { choice: "yes", confidence: 0.97 } });
  const [result] = await analyze([fullListing(second)], second, { llm, jev: jev.decide, cache });
  assert.equal(payloads.length, 1, "pas de nouvel appel au LLM");
  assert.equal(result.criterionResults.find(check => check.label === "balcon")?.status, "confirmed");
  await analyze([fullListing(second)], second, { llm, jev: jev.decide, cache });
  assert.equal(jev.asked.length, 1, "en cache : Jev n'est pas rappelé");
});

// --- Un « non » des champs n'est pas une certitude : la description est lue quand même ---------------------------------

const withFields = (criteria: Criteria, description: string, raw: Record<string, unknown>, features: Listing["features"] = []): Listing => ({
  ...fullListing(criteria), description, features,
  criterionResults: evaluateStructured(criteria, { price: 600, area: 25, rooms: 1, location: "Lille" }, raw),
});
/** Faux LLM qui confirme le parking s'il le lit, et sinon ne sait pas. */
const parkingLlm = () => {
  const payloads: { toVerify: { id: string; label: string }[]; structured: { label: string }[] }[] = [];
  const llm: JsonLlm = async (_system, user) => {
    const { listings } = JSON.parse(user) as { listings: (typeof payloads[number] & { id: number; wantGeneral: boolean })[] };
    payloads.push(...listings);
    return { items: listings.map(item => ({ id: item.id, checks: item.toVerify.map(check => /parking/.test(check.label) && /parking incluse/.test(JSON.stringify(listings))
      ? { id: check.id, status: "confirmed", value: "1 place", evidence: "Place de parking incluse." } : { id: check.id, status: "unknown", value: "", evidence: "" }),
      ...(item.wantGeneral ? { summary: null, summaryEvidence: [], features: [] } : {}) })) };
  };
  return { llm, payloads };
};

test("moteur LLM : « 0 place de parking » dans les champs, « place de parking incluse » dans le texte → le texte l'emporte", async () => {
  const criteria = criteriaOf(["parking"]);
  const listing = withFields(criteria, "Studio rénové. Place de parking incluse.", { attributes: [{ key: "nb_parkings", value: "0" }] });
  assert.equal(listing.criterionResults.find(check => check.label === "parking")?.status, "contradicted", "avant lecture : le champ dit non");
  const { llm, payloads } = parkingLlm();
  const [result] = await analyze([listing], criteria, { llm, jev: null, cache: memoryAnalysisCache() });
  assert.deepEqual(payloads[0].toVerify.map(check => check.label), ["parking"], "revérifié dans la description");
  assert.ok(!payloads[0].structured.some(check => check.label === "parking"), "pas présenté au LLM comme un fait établi");
  const parking = result.criterionResults.find(check => check.label === "parking")!;
  assert.equal(parking.status, "confirmed");
  assert.equal(parking.source, "description");
  assert.equal(parking.evidence, "Place de parking incluse.");
});

test("moteur LLM : le texte ne dit rien → le « non » des champs reste affiché", async () => {
  const criteria = criteriaOf(["parking"]);
  const listing = withFields(criteria, "Studio rénové, lumineux.", { attributes: [{ key: "nb_parkings", value: "0" }] });
  const [result] = await analyze([listing], criteria, { llm: parkingLlm().llm, jev: null, cache: memoryAnalysisCache() });
  const parking = result.criterionResults.find(check => check.label === "parking")!;
  assert.equal(parking.status, "contradicted");
  assert.equal(parking.source, "api");
});

test("moteur Jev : « Ascenseur : Non » dans les champs, « avec ascenseur » dans le texte → Jev relit, le oui remplace le non", async () => {
  const criteria = criteriaOf(["ascenseur"]);
  const listing = withFields(criteria, "Immeuble récent avec ascenseur. Studio lumineux.", { attributes: [{ key: "elevator", value_label: "Non" }] },
    [{ label: "Ascenseur", value: "Non", source: "annonce", evidence: "Indiqué dans l’annonce : « elevator »." }]);
  const jev = fakeJev({ offer: { choice: "entire", confidence: 0.95 }, elevator: { choice: "yes", confidence: 0.96 } });
  const { llm, payloads } = fakeLlm();
  const [result] = await analyze([listing], criteria, { llm, jev: jev.decide, cache: memoryAnalysisCache() });
  assert.ok(jev.asked[0].includes("elevator"), "le « non » des champs n'empêche pas de demander");
  assert.deepEqual(payloads[0].toVerify, [], "tranché par Jev : rien de plus pour le LLM");
  const elevator = result.criterionResults.find(check => check.label === "ascenseur")!;
  assert.deepEqual([elevator.status, elevator.evidence], ["confirmed", "Immeuble récent avec ascenseur."]);
  assert.deepEqual(result.features.filter(feature => feature.label === "Ascenseur").map(feature => [feature.value, feature.source]), [["", "ia"]], "plus d'« Ascenseur : Non »");
});

test("un « oui » des champs fait foi : pas redemandé ; « non » des champs et du texte : affiché une seule fois", async () => {
  const { decide, asked } = fakeJev({});
  await readWithJev(listing("Ascenseur et parking.", { features: [
    { label: "Ascenseur", value: "Oui", source: "annonce", evidence: "" }, { label: "Stationnement", value: "1 place(s)", source: "annonce", evidence: "" },
  ] } as Partial<Listing>), [], decide);
  assert.ok(!asked[0].includes("elevator") && !asked[0].includes("parking"));
  const { mergeFeatures } = await import("./ai");
  const no = (label: string, source: "annonce" | "ia") => ({ label, value: "Non", source, evidence: "" });
  assert.deepEqual(mergeFeatures([no("Ascenseur", "annonce")], [no("Ascenseur", "ia")]).map(feature => feature.source), ["annonce"]);
});
