import assert from "node:assert/strict";
import test from "node:test";
import { canonicalLocation, normalize, resolvePlace, suggestPlaces } from "./places";

test("normalize : casse, accents, tirets et « st » n'empêchent pas la correspondance", () => {
  assert.equal(normalize("St-Étienne"), "saint etienne");
  assert.equal(normalize("L'Haÿ-les-Roses"), "l hay les roses");
  assert.equal(normalize("  Ste Foy "), "sainte foy");
});

test("suggestPlaces : nom exact d'abord, puis préfixe par population, tolère les accents", () => {
  const names = suggestPlaces("quimp").map(commune => commune.name);
  assert.equal(names[0], "Quimper");
  assert.equal(suggestPlaces("lille")[0].name, "Lille");
  assert.equal(suggestPlaces("orleans")[0].name, "Orléans");
  const nantes = suggestPlaces("nantes")[0];
  assert.equal(nantes.department, "44");
  assert.ok(nantes.lat > 47 && nantes.lat < 47.5 && nantes.lon < -1 && nantes.lon > -2);
  assert.deepEqual(suggestPlaces("a"), [], "moins de 2 caractères : rien");
  assert.ok(suggestPlaces("saint", 5).length === 5 && suggestPlaces("saint", 5)[0].population >= suggestPlaces("saint", 5)[4].population);
});

test("suggestPlaces : un code postal trouve la commune", () => {
  assert.equal(suggestPlaces("29000")[0].name, "Quimper");
  assert.ok(suggestPlaces("75012").some(commune => commune.name === "Paris"));
});

test("resolvePlace : une ville unique est rattachée, un homonyme reste ambigu tant qu'aucun département n'est donné", () => {
  const lille = resolvePlace("lille");
  assert.ok(lille.status === "resolved" && lille.commune.code === "59350");
  const ambiguous = resolvePlace("Saint-Aubin");
  assert.equal(ambiguous.status, "ambiguous");
  assert.ok(ambiguous.status === "ambiguous" && ambiguous.candidates.length > 1);
  const byDepartment = resolvePlace("Saint-Aubin (91)");
  assert.ok(byDepartment.status === "resolved" && byDepartment.commune.department === "91");
  const byPostal = resolvePlace("Saint-Aubin 91190");
  assert.ok(byPostal.status === "resolved" && byPostal.commune.department === "91");
});

test("resolvePlace : Paris est la commune 75056 ; arrondissements, régions et textes libres restent inconnus", () => {
  const paris = resolvePlace("Paris");
  assert.ok(paris.status === "resolved" && paris.commune.code === "75056");
  assert.equal(resolvePlace("Paris 12e").status, "unknown");
  assert.equal(resolvePlace("Île-de-France").status, "unknown");
  assert.equal(resolvePlace("").status, "unknown");
});

test("canonicalLocation : corrige casse et accents, ne touche jamais l'ambigu ni l'inconnu", () => {
  assert.equal(canonicalLocation("quimper"), "Quimper");
  assert.equal(canonicalLocation("ST ETIENNE"), "Saint-Étienne");
  assert.equal(canonicalLocation("Saint-Aubin"), "Saint-Aubin");
  assert.equal(canonicalLocation("Lyon 7e"), "Lyon 7e");
  assert.equal(canonicalLocation("Paris 12e, Vincennes"), "Paris 12e, Vincennes");
  assert.equal(canonicalLocation(""), "");
});
