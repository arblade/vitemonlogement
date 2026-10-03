// Vérité terrain posée à la main (lecture des 39 annonces des échantillons) : tout ce qui n'est pas dit vaut « unstated ».
import { readFileSync, writeFileSync } from "node:fs";
const a = JSON.parse(readFileSync("bench/a-annoter.json", "utf8"));
const Y = (...ids) => Object.fromEntries(ids.map(i => [i, "yes"]));
const N = (...ids) => Object.fromEntries(ids.map(i => [i, "no"]));
const T = {
  1: ["entire", { ...Y("furnished", "kitchen", "duplex", "top_floor") }],
  2: ["entire", { ...Y("renovated", "terrace", "outdoor"), ...N("no_fees", "charges_included", "separate_wc") }],
  3: ["room", Y("furnished", "separate_wc", "kitchen", "transport")],
  4: ["entire", { ...Y("furnished", "kitchen", "separate_wc"), ...N() }],
  5: ["entire", Y("renovated", "transport", "charges_included", "students")],
  6: ["entire", Y("caretaker", "cellar", "parking", "kitchen", "transport")],
  7: ["entire", Y("furnished", "dishwasher", "kitchen", "charges_included", "transport")],
  8: ["entire", { ...Y("elevator", "balcony", "outdoor", "separate_wc", "transport"), ...N("charges_included") }],
  9: ["entire", { ...Y("kitchen", "transport"), ...N("no_fees") }],
  10: ["entire", { ...Y("garden", "outdoor", "furnished", "kitchen", "parquet", "transport"), ...N("charges_included") }],
  17: ["entire", { ...Y("transport"), ...N("furnished") }],
  18: ["entire", { ...Y("top_floor", "kitchen", "washer", "parquet", "double_glazing"), ...N("charges_included") }],
  19: ["room", Y("furnished", "students", "renovated")],
  20: ["entire", Y("top_floor", "kitchen", "bathtub", "double_glazing")],
  21: ["entire", { ...Y("ground_floor", "kitchen", "washer", "charges_included", "transport"), ...N("separate_wc") }],
  22: ["entire", { ...Y("renovated", "parking", "kitchen", "terrace", "outdoor", "separate_wc", "transport"), ...N("charges_included") }],
  23: ["entire", Y("furnished", "elevator", "double_glazing", "kitchen")],
  24: ["room", { ...Y("kitchen", "washer", "furnished", "apl", "transport"), ...N("charges_included") }],
  25: ["room", Y("furnished", "renovated", "outdoor")],
  26: ["entire", Y("furnished", "duplex", "transport", "students")],
  27: ["entire", Y("renovated", "furnished", "ground_floor", "kitchen", "students")],
  28: ["room", Y("cellar", "outdoor", "kitchen", "transport")],
  29: ["entire", { ...Y("kitchen", "separate_wc", "elevator"), ...N("charges_included") }],
  30: ["entire", Y("furnished", "kitchen")],
  31: ["entire", Y("furnished", "kitchen", "washer", "students")],
  32: ["entire", Y("parquet", "fireplace", "kitchen", "transport")],
  33: ["entire", Y("parking", "charges_included", "transport")],
  34: ["entire", { ...Y("furnished", "elevator", "parking", "kitchen", "washer", "transport"), ...N("charges_included") }],
  35: ["entire", { ...Y("furnished", "kitchen", "separate_wc"), ...N("no_fees", "charges_included") }],
  38: ["entire", {}],
};
const dup = { 11: 2, 12: 3, 13: 4, 14: 6, 15: 8, 16: 10 };
a.forEach((item, i) => {
  const n = i + 1, src = dup[n] ?? n, t = T[src];
  if (!t) { item.truth.offer = ""; item.truth.features = Object.fromEntries(Object.keys(item.truth.features).map(k => [k, ""])); return; }
  item.truth.offer = t[0];
  item.truth.features = Object.fromEntries(Object.keys(item.truth.features).map(k => [k, t[1][k] ?? "unstated"]));
});
writeFileSync("bench/verite.json", JSON.stringify(a, null, 2));
console.log("écrit bench/verite.json");
