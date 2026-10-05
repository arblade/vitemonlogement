import assert from "node:assert/strict";
import test from "node:test";
import data from "../data/stations.json";
import { crowMeters, MAX_STOP_METERS, nearestStop, parseLines, walkMinutes, type Station } from "./stations";

const station = (name: string, lat: number, lng: number, lines = "m|1|#ffcd00"): Station => ({ name, lat, lng, lines: parseLines(lines) });

test("parseLines : métro d'abord, ordre naturel, couleur absente = null", () => {
  assert.deepEqual(parseLines("t|T2|;m|10|#c9910d;m|2|#003ca6"), [
    { mode: "metro", name: "2", color: "#003ca6" }, { mode: "metro", name: "10", color: "#c9910d" }, { mode: "tram", name: "T2", color: null },
  ]);
  assert.deepEqual(parseLines(""), []);
});

test("marche estimée : vol d'oiseau × 1,3 à 80 m/min, au moins 1 min", () => {
  assert.equal(walkMinutes(0), 1);
  assert.equal(walkMinutes(615), 10); // 615 × 1,3 = 800 m
  assert.equal(walkMinutes(1230), 20);
});

test("nearestStop : la plus proche gagne, distance arrondie ; rien au-delà de ~30 min de marche", () => {
  const home = { lat: 50.6408, lng: 3.0611 };
  const near = station("Rihour", 50.6365, 3.0635), far = station("Gambetta", 50.6305, 3.0545, "m|1|;t|R|");
  const found = nearestStop(home, [far, near]);
  assert.equal(found?.name, "Rihour");
  assert.equal(found?.distanceMeters, Math.round(crowMeters(home, near)));
  assert.equal(found?.walkMinutes, walkMinutes(crowMeters(home, near)));
  assert.deepEqual(found?.lines, [{ mode: "metro", name: "1", color: "#ffcd00" }]);
  // Une station à 2 km (≈ 33 min estimées) n'est pas « à proximité ».
  const twoKm = station("Lointaine", home.lat + 2000 / 111_000, home.lng);
  assert.ok(crowMeters(home, twoKm) > MAX_STOP_METERS);
  assert.equal(nearestStop(home, [twoKm]), null);
  assert.equal(nearestStop(home, []), null);
});

test("base OpenStreetMap : métros et trams des grandes villes, lignes et couleurs", () => {
  const rows = data as [string, number, number, string][];
  assert.ok(rows.length > 2000, `${rows.length} stations`);
  for (const [name, lat, lng, lines] of rows) {
    assert.ok(name && lat > -22 && lat < 52 && lng > -62 && lng < 56 && lines, name);
  }
  // Lille : la gare Lille-Flandres a le métro (M1, M2) ; Bordeaux n'a que le tram ; Paris Châtelet a plusieurs métros.
  const at = (lat: number, lng: number) => nearestStop({ lat, lng });
  const lille = at(50.6366, 3.0706);
  assert.ok(lille && lille.lines.some(line => line.mode === "metro"), JSON.stringify(lille));
  assert.ok(lille.walkMinutes <= 5);
  const bordeaux = at(44.8412, -0.5733);
  assert.ok(bordeaux && bordeaux.lines.every(line => line.mode === "tram"), JSON.stringify(bordeaux));
  const chatelet = at(48.8584, 2.3474);
  assert.ok(chatelet && chatelet.lines.filter(line => line.mode === "metro").length >= 3, JSON.stringify(chatelet));
  assert.ok(chatelet.lines.every(line => line.color === null || /^#[0-9a-f]{6}$/.test(line.color)));
  // Campagne bretonne : aucune station à distance de marche.
  assert.equal(at(48.2, -3.5), null);
});
