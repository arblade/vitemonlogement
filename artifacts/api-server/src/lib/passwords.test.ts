import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./passwords";

test("mot de passe haché : sel différent à chaque fois, vérification exacte, jamais en clair", async () => {
  const one = await hashPassword("un-mot-de-passe");
  const two = await hashPassword("un-mot-de-passe");
  assert.notEqual(one, two, "sel aléatoire par utilisateur");
  assert.ok(!one.includes("un-mot-de-passe"));
  assert.ok(one.startsWith("scrypt$"));
  assert.equal(await verifyPassword("un-mot-de-passe", one), true);
  assert.equal(await verifyPassword("Un-mot-de-passe", one), false);
  assert.equal(await verifyPassword("", one), false);
  assert.equal(await verifyPassword("un-mot-de-passe", "texte-invalide"), false);
});
