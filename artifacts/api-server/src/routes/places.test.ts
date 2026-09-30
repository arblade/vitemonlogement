import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { after, before } from "node:test";
import { closeDatabase } from "../lib/database";
import { useMemoryDatabase } from "../test/helpers";

process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";

let server: Server;
let base = "";
let cookie = "";

before(async () => {
  await useMemoryDatabase();
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const register = await fetch(`${base}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "Arblade", email: "villes@example.com", password: "motdepasse-1" }) });
  cookie = (register.headers.get("set-cookie") ?? "").split(";")[0];
});
after(async () => { server.close(); await closeDatabase(); });

test("GET /places/suggest exige la session, puis renvoie des communes triées", async () => {
  assert.equal((await fetch(`${base}/places/suggest?q=quimp`)).status, 401);
  const response = await fetch(`${base}/places/suggest?q=quimp&limit=3`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const communes = await response.json() as { name: string; code: string; lat: number }[];
  assert.ok(communes.length >= 1 && communes.length <= 3);
  assert.equal(communes[0].name, "Quimper");
  assert.equal(communes[0].code, "29232");
});

test("GET /places/suggest : requête trop courte ou absente → liste vide, limite bornée", async () => {
  assert.deepEqual(await (await fetch(`${base}/places/suggest?q=a`, { headers: { cookie } })).json(), []);
  assert.deepEqual(await (await fetch(`${base}/places/suggest`, { headers: { cookie } })).json(), []);
  const many = await (await fetch(`${base}/places/suggest?q=saint&limit=999`, { headers: { cookie } })).json() as unknown[];
  assert.equal(many.length, 20);
});
