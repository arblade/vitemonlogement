import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_COLOR, linesIn, MAX_SPAN, toLines } from "./transit-lines";

// Deux lignes inventées : un métro lillois (couleur officielle) et un tram bordelais (sans couleur).
const sample = toLines([
  ["m", "1", "#ffd400", [[3.06, 50.63, 3.07, 50.64], [3.07, 50.64, 3.08, 50.645]]],
  ["t", "A", "", [[-0.58, 44.84, -0.56, 44.85]]],
]);
const lille = { west: 3.0, south: 50.6, east: 3.1, north: 50.7 };

test("toLines : tracés en [lng, lat] et emprise de chaque ligne", () => {
  assert.deepEqual(sample[0].paths[1], [[3.07, 50.64], [3.08, 50.645]]);
  assert.deepEqual(sample[0].box, [3.06, 50.63, 3.08, 50.645]);
  assert.equal(sample[1].color, null);
});

test("linesIn : seulement les lignes de la zone, en GeoJSON, couleur officielle ou couleur du mode", () => {
  const lines = linesIn(lille, sample);
  assert.equal(lines.type, "FeatureCollection");
  assert.deepEqual(lines.features.map(feature => feature.properties), [{ mode: "metro", name: "1", color: "#ffd400" }]);
  assert.equal(lines.features[0].geometry.type, "MultiLineString");
  const bordeaux = linesIn({ west: -0.7, south: 44.8, east: -0.5, north: 44.9 }, sample);
  assert.deepEqual(bordeaux.features[0].properties, { mode: "tram", name: "A", color: FALLBACK_COLOR.tram });
});

test("linesIn : zone invalide ou trop grande (plus d'une agglomération) → aucune ligne", () => {
  for (const box of [
    { ...lille, east: Number.NaN }, { ...lille, east: lille.west - 1 },
    { west: -5, south: 42, east: 8, north: 51 }, { ...lille, east: lille.west + MAX_SPAN + 0.1 },
  ]) assert.deepEqual(linesIn(box, sample).features, [], JSON.stringify(box));
});

test("base OpenStreetMap : Lille (métro 1 jaune, 2 rouge), Paris (14 lignes de métro), traits sans doublon de couleur", () => {
  const lilleLines = linesIn(lille).features.map(feature => feature.properties);
  assert.ok(lilleLines.some(line => line.mode === "metro" && line.name === "1" && line.color === "#ffd400"), JSON.stringify(lilleLines));
  assert.ok(lilleLines.some(line => line.mode === "metro" && line.name === "2"));
  assert.ok(lilleLines.some(line => line.mode === "tram"));
  const paris = linesIn({ west: 2.2, south: 48.8, east: 2.45, north: 48.92 }).features.filter(feature => feature.properties.mode === "metro");
  assert.ok(new Set(paris.map(feature => feature.properties.name)).size >= 14, String(paris.length));
  for (const feature of linesIn(lille).features) assert.match(feature.properties.color, /^#[0-9a-f]{6}$/);
  // Métro dessiné après le tram (au-dessus).
  const modes = linesIn(lille).features.map(feature => feature.properties.mode);
  assert.ok(modes.lastIndexOf("tram") < modes.indexOf("metro"));
});
