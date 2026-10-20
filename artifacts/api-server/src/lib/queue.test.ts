import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { housingSearches, mailOutbox } from "@workspace/db";
import { eq } from "drizzle-orm";
import { claimNextSearch, claimSearch, releaseSearch } from "./queue";
import { closeDatabase, db } from "./database";
import { createSearch, getSearchRow, watchOffsetMs } from "../routes/housing/store";
import { enqueueMail } from "./mail-outbox";
import { createWorker } from "./worker";
import { useMemoryDatabase } from "../test/helpers";

before(async () => { await useMemoryDatabase(); });
after(closeDatabase);
// Chaque test part d'une file vide : les recherches des tests précédents sont marquées terminées.
beforeEach(async () => {
  await db().update(housingSearches).set({ status: "completed", task: null, watched: 0, nextWatchAt: null, lockOwner: null, lockUntil: null });
  await db().delete(mailOutbox);
});

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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("le worker attend la prochaine échéance au lieu de sonder la base (Neon peut se mettre en veille)", async () => {
  const worker = createWorker({ owner: "w3", intervalMs: 3_000, idleMs: 30 * 60_000 });
  const now = Date.now();
  assert.equal(await worker.nextDelay(now), 30 * 60_000, "rien à faire : sommeil maximal");

  const id = await createSearch("studio à Brest");
  await db().update(housingSearches).set({ nextCheckAt: now + 10 * 60_000 }).where(eq(housingSearches.id, id));
  assert.equal(await worker.nextDelay(now), 10 * 60_000, "recherche en cours : réveil à son prochain contrôle");
  await db().update(housingSearches).set({ nextCheckAt: now + 5 * 60_000, lockOwner: "autre", lockUntil: now + 8 * 60_000 }).where(eq(housingSearches.id, id));
  assert.equal(await worker.nextDelay(now), 8 * 60_000, "bail d'une autre instance : réveil à son expiration");
  await db().update(housingSearches).set({ nextCheckAt: 0, lockOwner: null, lockUntil: null }).where(eq(housingSearches.id, id));
  assert.equal(await worker.nextDelay(now), 3_000, "échéance passée : intervalle minimal");
  await db().update(housingSearches).set({ status: "completed" }).where(eq(housingSearches.id, id));

  await db().update(housingSearches).set({ watched: 1, nextWatchAt: now + 20 * 60_000 }).where(eq(housingSearches.id, id));
  assert.equal(await worker.nextDelay(now), 20 * 60_000 + watchOffsetMs(id), "veille quotidienne : réveil à sa relève, décalage compris");
  await db().update(housingSearches).set({ nextWatchAt: now + 5 * 3_600_000 }).where(eq(housingSearches.id, id));
  assert.equal(await worker.nextDelay(now), 30 * 60_000, "relève lointaine : plafonné à idleMs");

  await enqueueMail("password-reset", "reset:test", {}, now + 60_000);
  assert.equal(await worker.nextDelay(now), 60_000, "e-mail en attente : réveil à son essai");
});

test("au repos, le worker ne touche plus la base ; wake() le relance aussitôt", async () => {
  const seen: number[] = [];
  const worker = createWorker({ owner: "w4", intervalMs: 10, idleMs: 60_000, advance: async searchId => { seen.push(searchId); return 60_000; } });
  worker.start();
  try {
    await sleep(100);
    // Recherche glissée en base sans réveil : avec un sondage toutes les 10 ms, elle serait prise.
    const id = await createSearch("T3 à Caen");
    await sleep(300);
    assert.deepEqual(seen, [], "pas de passage pendant le sommeil");
    worker.wake();
    await sleep(300);
    assert.deepEqual(seen, [id]);
  } finally { await worker.stop(); }
});

test("le worker se réveille de lui-même à l'échéance d'une recherche", async () => {
  const seen: number[] = [];
  const id = await createSearch("maison à Vannes");
  await db().update(housingSearches).set({ nextCheckAt: Date.now() + 300 }).where(eq(housingSearches.id, id));
  const worker = createWorker({ owner: "w5", intervalMs: 10, idleMs: 60_000, advance: async searchId => { seen.push(searchId); return 60_000; } });
  worker.start();
  try {
    await sleep(100);
    assert.deepEqual(seen, [], "pas avant l'échéance");
    await sleep(600);
    assert.deepEqual(seen, [id]);
  } finally { await worker.stop(); }
});
