import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { checkQuotas, consume } from "./quota";
import { closeDatabase } from "./database";
import { useMemoryDatabase } from "../test/helpers";

before(async () => { await useMemoryDatabase(); });
after(closeDatabase);

const HOUR = 3_600_000;
const limits = { ipPerHour: 3, cookiePerHour: 100, globalPerDay: 1000 };

test("consume compte par fenêtre et repart à zéro à la fenêtre suivante", async () => {
  const t0 = 10 * HOUR;
  assert.equal((await consume("k", HOUR, t0)).count, 1);
  assert.equal((await consume("k", HOUR, t0 + 10)).count, 2);
  const next = await consume("k", HOUR, t0 + HOUR);
  assert.equal(next.count, 1);
  assert.equal(next.retryAfterSeconds, 3600);
});

test("plafond par IP : 3 par heure, la 4e est refusée, une autre IP n'est pas touchée", async () => {
  const now = 50 * HOUR;
  for (let i = 0; i < 3; i++) assert.equal((await checkQuotas("1.1.1.1", "v1", limits, now + i)).allowed, true);
  const refused = await checkQuotas("1.1.1.1", "v1", limits, now + 10);
  assert.equal(refused.allowed, false);
  assert.equal(!refused.allowed && refused.scope, "ip");
  assert.equal((await checkQuotas("2.2.2.2", "v2", limits, now + 11)).allowed, true);
  assert.equal((await checkQuotas("1.1.1.1", "v1", limits, now + HOUR)).allowed, true, "nouvelle heure");
});

test("plafond par cookie : deux IP différentes avec le même cookie partagent le quota", async () => {
  const now = 70 * HOUR;
  const tight = { ipPerHour: 100, cookiePerHour: 2, globalPerDay: 1000 };
  assert.equal((await checkQuotas("3.3.3.1", "cookie-a", tight, now)).allowed, true);
  assert.equal((await checkQuotas("3.3.3.2", "cookie-a", tight, now)).allowed, true);
  const refused = await checkQuotas("3.3.3.3", "cookie-a", tight, now);
  assert.equal(!refused.allowed && refused.scope, "cookie");
  assert.equal((await checkQuotas("3.3.3.3", "cookie-b", tight, now)).allowed, true);
});

test("plafond global de l'application par jour", async () => {
  const now = 100 * 24 * HOUR;
  const tight = { ipPerHour: 100, cookiePerHour: 100, globalPerDay: 2 };
  assert.equal((await checkQuotas("4.4.4.1", "g1", tight, now)).allowed, true);
  assert.equal((await checkQuotas("4.4.4.2", "g2", tight, now)).allowed, true);
  const refused = await checkQuotas("4.4.4.3", "g3", tight, now);
  assert.equal(!refused.allowed && refused.scope, "global");
});
