import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { after, before } from "node:test";
import { closeDatabase } from "../lib/database";
import { useMemoryDatabase } from "../test/helpers";

process.env.APP_PASSWORD = "Arblade";
process.env.SESSION_SECRET = "secret-de-test";
process.env.TRUST_PROXY = "1";

let server: Server;
let base = "";
let ip = 0;

const post = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.2.0.${++ip}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});
const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });
async function signUp(email: string) {
  const response = await post("/auth/register", { code: "Arblade", email, password: "motdepasse-1" });
  assert.equal(response.status, 201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}
const listing = (n: number) => ({ url: `https://www.leboncoin.fr/ad/locations/${n}`, title: `Studio ${n}`, image: null, price: 590.5, area: 25, rooms: 1, location: "Lille", score: 80, searchId: 1, savedAt: new Date(1_700_000_000_000 + n * 1000).toISOString() });

before(async () => {
  await useMemoryDatabase();
  const { createSearch } = await import("../routes/housing/store");
  await createSearch("Ancienne recherche, avant les comptes"); // sans propriétaire
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server.close(); await closeDatabase(); });

test("le premier compte adopte les recherches antérieures aux comptes ; le second ne les voit pas", async () => {
  const first = await signUp("dev@example.com");
  const second = await signUp("autre@example.com");
  const mine = await (await get("/housing/searches", first)).json() as { id: number; prompt: string }[];
  assert.equal(mine.length, 1);
  assert.equal(mine[0].prompt, "Ancienne recherche, avant les comptes");
  assert.deepEqual(await (await get("/housing/searches", second)).json(), []);
  assert.equal((await get(`/housing/searches/${mine[0].id}`, first)).status, 200);
});

test("la recherche d'un autre compte est introuvable (404) : lecture, rafraîchissement et analyse", async () => {
  const first = await signUp("proprietaire@example.com");
  const second = await signUp("intrus@example.com");
  const { createSearch } = await import("../routes/housing/store");
  const owned = await (await import("../lib/users")).findUserByEmail("proprietaire@example.com");
  const id = await createSearch("Recherche privée", owned!.id);
  assert.equal((await get(`/housing/searches/${id}`, first)).status, 200);
  assert.equal((await get(`/housing/searches/${id}`, second)).status, 404);
  assert.equal((await post(`/housing/searches/${id}/refresh`, {}, second)).status, 404);
  assert.equal((await post(`/housing/searches/${id}/analyze`, {}, second)).status, 404);
  const listed = await (await get("/housing/searches", second)).json() as { id: number }[];
  assert.ok(!listed.some(search => search.id === id));
});

test("favoris : ajout, doublon ignoré, liste triée, suppression, et isolation entre comptes", async () => {
  const one = await signUp("fav-un@example.com");
  const two = await signUp("fav-deux@example.com");
  const put = (cookie: string, item: object) => fetch(`${base}/favorites`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(item) });
  assert.equal((await put(one, listing(1))).status, 200);
  assert.equal((await put(one, listing(2))).status, 200);
  assert.equal((await put(one, { ...listing(1), url: "https://www.leboncoin.fr/ad/locations/1/" })).status, 200, "même annonce, « / » final : pas de doublon");
  const mine = await (await get("/favorites", one)).json() as { url: string; price: number }[];
  assert.deepEqual(mine.map(item => item.url), [listing(2).url, listing(1).url], "le plus récent d'abord");
  assert.equal(mine[0].price, 590.5);
  assert.deepEqual(await (await get("/favorites", two)).json(), [], "les favoris d'un autre compte restent invisibles");
  assert.equal((await fetch(`${base}/favorites?url=${encodeURIComponent(listing(1).url)}`, { method: "DELETE", headers: { cookie: two } })).status, 204);
  assert.equal(((await (await get("/favorites", one)).json()) as unknown[]).length, 2, "supprimer chez l'un ne touche pas l'autre");
  assert.equal((await fetch(`${base}/favorites?url=${encodeURIComponent(listing(1).url)}`, { method: "DELETE", headers: { cookie: one } })).status, 204);
  assert.equal(((await (await get("/favorites", one)).json()) as unknown[]).length, 1);
});

test("favoris : données invalides refusées, import des favoris du navigateur", async () => {
  const cookie = await signUp("import@example.com");
  const put = (item: unknown) => fetch(`${base}/favorites`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(item) });
  assert.equal((await put({ url: "javascript:alert(1)", title: "x" })).status, 400);
  assert.equal((await put({ url: "https://www.leboncoin.fr/ad/locations/9" })).status, 400, "titre obligatoire");
  const result = await (await post("/favorites/import", { items: [listing(3), listing(4), { url: "pas-une-url", title: "x" }, null] }, cookie)).json();
  assert.deepEqual(result, { imported: 2 });
  assert.equal(((await (await get("/favorites", cookie)).json()) as unknown[]).length, 2);
});
