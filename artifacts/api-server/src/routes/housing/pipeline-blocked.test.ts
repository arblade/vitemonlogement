import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";

// Crédit du service IA épuisé : inutile de réessayer, la recherche échoue tout de suite avec un message clair
// (et non après plusieurs minutes d'attente, avec le texte technique du fournisseur).
let fake: Server;
let openaiCalls = 0;

before(async () => {
  fake = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      openaiCalls++;
      res.statusCode = 429;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "You have no credits remaining.", type: "insufficient_quota", code: "credit_balance_exhausted" } }));
    });
  });
  await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  process.env.OPENAI_API_KEY = "test";
  process.env.APIFY_TOKEN = "test";
  const { useMemoryDatabase } = await import("../../test/helpers");
  await useMemoryDatabase();
});
after(async () => {
  fake.close();
  const { closeDatabase } = await import("../../lib/database");
  await closeDatabase();
});

test("crédit IA épuisé : échec immédiat (un seul passage du worker), message sans détail technique", async () => {
  const { createSearch, getSearch } = await import("./store");
  const { advanceSearch } = await import("./pipeline");
  const id = await createSearch("Un studio à Lille");
  const next = await advanceSearch(id);
  const search = await getSearch(id);
  assert.equal(next, 0);
  assert.ok(openaiCalls >= 1 && openaiCalls <= 3, `appels OpenAI : ${openaiCalls}`); // le SDK refait lui-même 2 essais rapides
  assert.equal(search?.status, "failed");
  assert.equal(search?.stage, "failed");
  assert.match(search?.error ?? "", /momentanément indisponible/);
  assert.doesNotMatch(search?.error ?? "", /credit|openai|429/i);
});

test("blockingFailure : crédit, quota et clé invalide sont bloquants ; une panne passagère ne l'est pas", async () => {
  const { blockingFailure } = await import("./pipeline");
  assert.ok(blockingFailure({ status: 429, code: "credit_balance_exhausted" }));
  assert.ok(blockingFailure({ status: 429, code: "insufficient_quota" }));
  assert.ok(blockingFailure({ status: 401, code: "invalid_api_key" }));
  assert.equal(blockingFailure({ status: 429, code: "rate_limit_exceeded" }), null);
  assert.equal(blockingFailure({ status: 503 }), null);
  assert.equal(blockingFailure(new Error("timeout")), null);
  assert.equal(blockingFailure(undefined), null);
});
