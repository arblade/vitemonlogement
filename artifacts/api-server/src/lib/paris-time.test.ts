import assert from "node:assert/strict";
import test from "node:test";
import { fromParis, isClockTime, leboncoinDate, nextParisTime } from "./paris-time";

test("dates Le Bon Coin : heure de Paris étiquetée « Z », été (UTC+2) comme hiver (UTC+1)", () => {
  assert.equal(new Date(leboncoinDate("2026-10-01T20:49:09.000Z")!).toISOString(), "2026-10-01T18:49:09.000Z");
  assert.equal(new Date(leboncoinDate("2026-12-01 08:00:00")!).toISOString(), "2026-12-01T07:00:00.000Z");
  assert.equal(leboncoinDate(""), null);
  assert.equal(leboncoinDate(undefined), null);
  assert.equal(leboncoinDate("hier"), null);
});

test("prochain passage à 8 h et 18 h (heure de Paris)", () => {
  const at = (iso: string) => new Date(nextParisTime(["08:00", "18:00"], Date.parse(iso))!).toISOString();
  assert.equal(at("2026-10-01T05:00:00Z"), "2026-10-01T06:00:00.000Z", "7 h à Paris → 8 h");
  assert.equal(at("2026-10-01T06:00:00Z"), "2026-10-01T16:00:00.000Z", "8 h pile → 18 h");
  assert.equal(at("2026-10-01T17:30:00Z"), "2026-10-02T06:00:00.000Z", "19 h 30 → lendemain 8 h");
  assert.equal(at("2026-12-15T12:00:00Z"), "2026-12-15T17:00:00.000Z", "hiver : 18 h = 17 h UTC");
});

test("changement d'heure : le passage reste à 8 h de Paris", () => {
  // Nuit du 24 au 25 octobre 2026 : passage à l'heure d'hiver.
  assert.equal(new Date(nextParisTime(["08:00"], Date.parse("2026-10-24T08:00:00Z"))!).toISOString(), "2026-10-25T07:00:00.000Z");
  // Nuit du 28 au 29 mars 2026 : passage à l'heure d'été.
  assert.equal(new Date(nextParisTime(["08:00"], Date.parse("2026-03-28T08:00:00Z"))!).toISOString(), "2026-03-29T06:00:00.000Z");
  assert.equal(new Date(fromParis(2026, 3, 29, 8)).toISOString(), "2026-03-29T06:00:00.000Z");
});

test("créneaux invalides ignorés", () => {
  assert.equal(isClockTime("08:00"), true);
  assert.equal(isClockTime("24:00"), false);
  assert.equal(isClockTime("8h"), false);
  assert.equal(nextParisTime(["8h", "nimporte"], Date.now()), null);
  assert.ok(nextParisTime(["8h", "18:00"], Date.now()));
});
