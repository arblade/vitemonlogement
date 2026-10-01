import assert from "node:assert/strict";
import test from "node:test";
import { checksFor, classifyWish, evaluateStructured, matchesKnownBasics, matchesValue } from "./criteria";
import { focusedSearchTerm } from "./housing-search";
import type { Criteria } from "./store";

const base: Criteria = { location: "Lille", intent: "rent", keywords: "", radius: 5, wishes: [] };
const listing = { price: 600, area: 30, rooms: 1, location: "Lille" };

test("classifyWish : seuls parking, meublé et ascenseur sont hybrides", () => {
  assert.equal(classifyWish("place de parking"), "parking");
  assert.equal(classifyWish("garage"), "parking");
  assert.equal(classifyWish("meublé"), "furnished");
  assert.equal(classifyWish("ascenseur"), "elevator");
  assert.equal(classifyWish("calme"), null);
});

test("checksFor : lieu, budget, surface, pièces et souhaits sont tous représentés", () => {
  const checks = checksFor({ ...base, maxPrice: 700, minArea: 25, minRooms: 1, wishes: ["chat accepté", "parking"] });
  assert.deepEqual(checks.map(check => check.id), ["location", "price", "area", "rooms", "wish-1", "wish-2"]);
  assert.equal(checks.find(check => check.id === "wish-1")?.availability, "description");
  assert.equal(checks.find(check => check.id === "wish-2")?.availability, "hybrid");
});

test("evaluateStructured : budget respecté / dépassé / absent", () => {
  const criteria = { ...base, maxPrice: 650 };
  const status = (price: number | null) => evaluateStructured(criteria, { ...listing, price }, {}).find(check => check.id === "price")?.status;
  assert.equal(status(600), "confirmed");
  assert.equal(status(700), "contradicted");
  assert.equal(status(null), "unknown"); // donnée absente ≠ contredite
});

test("evaluateStructured : une ville voisine reste inconnue, pas contredite", () => {
  const results = evaluateStructured(base, { ...listing, location: "Villeneuve-d'Ascq" }, {});
  assert.equal(results.find(check => check.id === "location")?.status, "unknown");
});

test("evaluateStructured : parking selon nb_parkings (direct ou dans attributes)", () => {
  const criteria = { ...base, wishes: ["parking"] };
  const of = (raw: Record<string, unknown>) => evaluateStructured(criteria, listing, raw).find(check => check.id === "wish-1")?.status;
  assert.equal(of({ nb_parkings: 1 }), "confirmed");
  assert.equal(of({ attributes: [{ key: "nb_parkings", value: "2" }] }), "confirmed");
  assert.equal(of({ nb_parkings: 0 }), "contradicted");
  assert.equal(of({}), "unknown");
});

test("evaluateStructured : « non meublé » inverse le sens de la vérification", () => {
  const criteria = { ...base, wishes: ["non meublé"] };
  const of = (raw: Record<string, unknown>) => evaluateStructured(criteria, listing, raw).find(check => check.id === "wish-1")?.status;
  assert.equal(of({ furnished: "Non meublé" }), "confirmed");
  assert.equal(of({ furnished: "Meublé" }), "contradicted");
  assert.equal(of({}), "unknown");
});

test("matchesKnownBasics écarte seulement ce qui est connu et hors bornes", () => {
  const criteria = { ...base, minPrice: 500, maxPrice: 650, minArea: 25, minRooms: 2 };
  assert.equal(matchesKnownBasics({ price: 600, area: 30, rooms: 2, location: null }, criteria), true);
  assert.equal(matchesKnownBasics({ price: 700, area: 30, rooms: 2, location: null }, criteria), false);
  assert.equal(matchesKnownBasics({ price: null, area: null, rooms: null, location: null }, criteria), true);
  assert.equal(matchesKnownBasics({ price: 600, area: 20, rooms: 2, location: null }, criteria), false);
});

test("focusedSearchTerm : cas courants", () => {
  const term = (wishes: string[], keywords = "") => focusedSearchTerm({ ...base, wishes, keywords });
  assert.equal(term(["place de parking"]), "parking");
  assert.equal(term([], "un studio"), "studio");
  assert.equal(term(["calme"]), null);
});

// Écarts constatés dans reports/logiscope-evaluation-prompts-2026-09-29.md : ces tests décrivent le
// comportement VOULU et sont marqués « todo » tant que le code ne le respecte pas. Ils ne font pas échouer la suite ;
// dès qu'un correctif les fait passer, retirer `todo`.
test("focusedSearchTerm : « meublé » seul doit devenir le mot-clé", { todo: "\\b ne reconnaît pas la fin de mot accentuée" }, () => {
  assert.equal(focusedSearchTerm({ ...base, wishes: ["meublé"] }), "meublé");
});
test("focusedSearchTerm : un critère négatif ne doit pas devenir le mot-clé", { todo: "« sans balcon » donne « balcon »" }, () => {
  assert.equal(focusedSearchTerm({ ...base, wishes: ["sans balcon"] }), null);
});
test("focusedSearchTerm : « balcon ou terrasse » ne doit pas privilégier arbitrairement « balcon »", { todo: "alternatives non gérées" }, () => {
  assert.notEqual(focusedSearchTerm({ ...base, wishes: ["balcon ou terrasse"] }), "balcon");
});
test("« parking sécurisé » ne doit pas être confirmé par nb_parkings seul", { todo: "faux positif : le champ prouve une place, pas sa sécurité" }, () => {
  const criteria = { ...base, wishes: ["parking sécurisé"] };
  const status = evaluateStructured(criteria, listing, { nb_parkings: 1 }).find(check => check.id === "wish-1")?.status;
  assert.notEqual(status, "confirmed");
});

test("evaluateStructured : les preuves sont en langage courant, sans mention d'API", () => {
  const results = evaluateStructured({ ...base, maxPrice: 650, minArea: 20 }, listing, {}).filter(check => check.source === "api");
  assert.ok(results.length >= 2);
  for (const result of results) {
    assert.match(result.evidence, /^Indiqué dans l’annonce : « .+ »\.$/);
    assert.doesNotMatch(result.evidence, /API|structur/i);
  }
});

test("fourchette de pièces : libellés, bornes min et max, annonce sans nombre de pièces laissée à l'analyse", () => {
  const label = (minRooms: number | null, maxRooms: number | null) => checksFor({ ...base, minRooms, maxRooms }).find(check => check.id === "rooms")?.label;
  assert.equal(label(1, 2), "1 à 2 pièces");
  assert.equal(label(2, 2), "2 pièces");
  assert.equal(label(1, 1), "1 pièce");
  assert.equal(label(2, null), "Au moins 2 pièces");
  assert.equal(label(null, 3), "Au plus 3 pièces");
  assert.equal(label(null, null), undefined);
  const t1t2 = { ...base, minRooms: 1, maxRooms: 2 };
  assert.deepEqual([1, 2, 3].map(rooms => matchesValue("rooms", rooms, t1t2)), [true, true, false]);
  assert.equal(matchesKnownBasics({ price: 600, area: 60, rooms: 3, location: "Lille" }, t1t2), false);
  assert.equal(matchesKnownBasics({ price: 600, area: 30, rooms: null, location: "Lille" }, t1t2), true);
});
