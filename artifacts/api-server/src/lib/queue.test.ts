import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { housingSearches } from "@workspace/db";
import { claimNextSearch, claimSearch, releaseSearch } from "./queue";
import { closeDatabase, db } from "./database";
import { createSearch, getSearchRow } from "../routes/housing/store";
import { createWorker } from "./worker";
import { useMemoryDatabase } from "../test/helpers";

before(async () => { await useMemoryDatabase(); });
after(closeDatabase);
// Chaque test part d'une file vide : les recherches des tests précédents sont marquées terminées.
beforeEach(async () => { await db().update(housingSearches).set({ status: "completed", lockOwner: null, lockUntil: null }); });

test("deux processus concurrents ne réservent jamais la même recherche", async () => {
  const id = await createSearch("studio à Lille");
  const results = await Promise.all([claimNextSearch("a", 60_000), claimNextSearch("b", 60_000)]);
  assert.equal(results.filter(value => value === id).length, 1);
  assert.equal(results.filter(value => value === null).length, 1);
  const row = await getSearchRow(id);
  assert.ok(row?.lockOwner === "a" || row?.lockOwner === "b");
  await releaseSearch(id, row!.lockOwner!);
});

test("un bail expiré permet la reprise ; un bail vivant l'interdit", async () => {
  const id = await createSearch("T2 à Lyon");
  const now = 1_000_000;
  assert.equal(await claimNextSearch("a", 1_000, now), id);
  assert.equal(await claimSearch(id, "b", 1_000, now + 500), false, "bail encore valable");
  assert.equal(await claimSearch(id, "b", 1_000, now + 2_000), true, "bail expiré (processus mort)");
  await releaseSearch(id, "b");
});

test("releaseSearch ne libère que pour son propriétaire et respecte le prochain contrôle", async () => {
  const id = await createSearch("maison à Nantes");
  await claimSearch(id, "a", 60_000);
  await releaseSearch(id, "intrus", 0);
  assert.equal((await getSearchRow(id))?.lockOwner, "a");
  await releaseSearch(id, "a", Date.now() + 60_000);
  assert.equal((await getSearchRow(id))?.lockOwner, null);
  assert.equal(await claimNextSearch("c", 1_000), null, "prochain contrôle dans le futur : pas encore à traiter");
});

test("le worker traite une recherche laissée « running » sans navigateur, puis la relâche", async () => {
  const id = await createSearch("chambre à Grenoble");
  const seen: number[] = [];
  const worker = createWorker({ owner: "w1", advance: async searchId => { seen.push(searchId); return 60_000; } });
  await worker.tick();
  assert.ok(seen.includes(id));
  const row = await getSearchRow(id);
  assert.equal(row?.lockOwner, null);
  assert.ok((row?.nextCheckAt ?? 0) > Date.now());
  await worker.tick();
  assert.equal(seen.filter(value => value === id).length, 1, "pas de nouveau passage avant l'échéance");
});

test("un plantage d'étape ne bloque pas la recherche : le bail est rendu", async () => {
  const id = await createSearch("appartement à Rennes");
  const worker = createWorker({ owner: "w2", advance: async () => { throw new Error("boum"); } });
  await worker.tick();
  const row = await getSearchRow(id);
  assert.equal(row?.lockOwner, null);
  assert.ok((row?.nextCheckAt ?? 0) > Date.now());
});
