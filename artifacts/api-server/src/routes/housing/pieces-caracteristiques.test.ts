import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { analyze, type JsonLlm } from "./ai";
import { evaluateStructured } from "./criteria";
import { memoryAnalysisCache } from "../../lib/analysis-cache";
import { closeDatabase } from "../../lib/database";
import { useMemoryDatabase } from "../../test/helpers";
import { isRoomNoise } from "./room-features";
import type { Criteria, Feature, Listing } from "./store";

// Retour d'usage : la fiche listait « Chambre · 12 m² », « Cuisine · 10 m² », « Salle de bain », « WC »… Toute annonce a ces pièces ;
// ces lignes prenaient la place de ce qui distingue le logement. Voir room-features.ts.

before(async () => { await useMemoryDatabase(); });
after(closeDatabase);

const feature = (label: string, value = "", source: Feature["source"] = "ia"): Feature => ({ label, value, evidence: "x", source });

test("pièce nommée seule, avec surface ou numéro : écartée", () => {
  for (const [label, value] of [
    ["Chambre", "12 m²"], ["Chambre", "12m2"], ["Chambre de 12 m²", ""], ["Chambre 2", ""], ["Chambre principale", "14 m²"], ["Chambres", "2 chambres"],
    ["Cuisine", "10 m²"], ["Cuisine", ""], ["Cuisine de 9,5 m²", ""],
    ["Salle de bain", ""], ["Salle de bains", "4 m²"], ["Salle d'eau", "3 m²"], ["Salle d’eau", ""],
    ["WC", ""], ["Toilettes", ""], ["Salon", "20 m²"], ["Séjour", "25 m²"], ["Séjour", "environ 25 m²"], ["Salle à manger", ""], ["Entrée", ""],
  ]) assert.equal(isRoomNoise(feature(label, value)), true, `${label} · ${value}`);
});

test("ce qui qualifie la pièce, les équipements et les nombres des champs du site : gardés", () => {
  for (const [label, value] of [
    ["Cuisine équipée", ""], ["Cuisine", "équipée"], ["Cuisine", "ouverte sur le séjour"], ["Cuisine américaine", "10 m²"],
    ["WC séparés", ""], ["WC", "séparés"], ["Séjour", "lumineux, 25 m²"], ["Salle de bain", "avec baignoire"],
    ["Baignoire", ""], ["Douche", "à l'italienne"], ["Balcon", "plein sud"], ["Étage", "3e"], ["Chauffage", "gaz individuel"], ["Dressing", "aménagé"],
  ]) assert.equal(isRoomNoise(feature(label, value)), false, `${label} · ${value}`);
  // Champs du site : on peut demander un minimum de chambres ; une seule salle de bain va de soi.
  assert.equal(isRoomNoise(feature("Chambres", "1 ch.", "annonce")), false);
  assert.equal(isRoomNoise(feature("Chambres", "3", "annonce")), false);
  assert.equal(isRoomNoise(feature("Salles de bain", "2", "annonce")), false);
  assert.equal(isRoomNoise(feature("Salles de bain", "1", "annonce")), true);
  assert.equal(isRoomNoise(feature("Cuisine", "10 m²", "annonce")), false, "un champ du site n'est jamais écarté (sauf une salle de bain unique)");
});

const description = "Appartement T2 lumineux. Chambre de 12 m². Cuisine de 10 m². Salle de bain avec baignoire. Cuisine équipée. Balcon plein sud. WC séparés.";
const criteria: Criteria = { location: "Lille", intent: "rent", keywords: "", radius: 5, maxPrice: 700, wishes: [] };
function listingOf(url: string, features: Feature[] = []): Listing {
  const base = { price: 590, area: 25, rooms: 2, location: "Lille" };
  return {
    id: -1, source: "leboncoin", batch: "focused", title: "T2 Lille", url, description, ...base, image: null, images: [],
    aiSummary: null, summaryEvidence: [], score: 60, features, criterionResults: evaluateStructured(criteria, base, {}),
    lat: null, lng: null, geoPrecision: null,
  };
}

test("l'IA a beau les proposer, les pièces ne ressortent pas des caractéristiques lues dans la description", async () => {
  const llm: JsonLlm = async (_system, user) => {
    const { listings } = JSON.parse(user) as { listings: { id: number; wantGeneral: boolean }[] };
    return {
      items: listings.map(item => ({
        id: item.id, checks: [],
        ...(item.wantGeneral ? {
          summary: "T2 lumineux.", summaryEvidence: ["Appartement T2 lumineux"],
          features: [
            { label: "Chambre", value: "12 m²", evidence: "Chambre de 12 m²" },
            { label: "Cuisine", value: "10 m²", evidence: "Cuisine de 10 m²" },
            { label: "Salle de bain", value: "", evidence: "Salle de bain" },
            { label: "WC", value: "", evidence: "WC" },
            { label: "Balcon", value: "plein sud", evidence: "Balcon plein sud" },
            { label: "Cuisine équipée", value: "", evidence: "Cuisine équipée" },
          ],
        } : {}),
      })),
    };
  };
  const [result] = await analyze([listingOf("https://www.leboncoin.fr/ad/locations/501")], criteria, { llm, cache: memoryAnalysisCache() });
  assert.deepEqual(result.features.map(item => item.label), ["Balcon", "Cuisine équipée"]);
});

test("les annonces déjà enregistrées sont nettoyées à l'affichage ; les nombres du site restent", async () => {
  const { createSearch, completeSearch, getSearch } = await import("./store");
  const id = await createSearch("T2 à Lille");
  await completeSearch(id, [listingOf("https://www.leboncoin.fr/ad/locations/502", [
    feature("Chambres", "1 ch.", "annonce"), feature("Salles de bain", "1", "annonce"), feature("Étage", "3", "annonce"),
    feature("Chambre", "12 m²"), feature("Cuisine", "10 m²"), feature("Toilettes"), feature("Cuisine équipée"), feature("Balcon", "plein sud"),
  ])], "focused");
  const search = await getSearch(id);
  assert.deepEqual(search?.listings[0].features.map(item => `${item.label}${item.value ? ` · ${item.value}` : ""}`),
    ["Chambres · 1 ch.", "Étage · 3", "Cuisine équipée", "Balcon · plein sud"]);
});
