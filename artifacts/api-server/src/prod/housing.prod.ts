import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { housingSearches } from "@workspace/db";
import { closeDatabase, db } from "../lib/database";
import { createWorker } from "../lib/worker";
import { interpret } from "../routes/housing/ai";
import { isHousingListingUrl } from "../routes/housing/housing-search";
import { createSearch, getSearch } from "../routes/housing/store";
import { useMemoryDatabase } from "../test/helpers";

// Tests « prod » : vrais OpenAI et Apify (coût réel, ~0,02 € au total). À lancer explicitement : pnpm test:prod.
const PROMPT = "Un studio à Lille, 700 € maximum, avec un balcon";

before(async () => { await useMemoryDatabase(); });
after(async () => { await closeDatabase(); });

test("prod : OpenAI interprète une demande en critères structurés", async () => {
  const criteria = await interpret(PROMPT);
  assert.match(criteria.location, /lille/i);
  assert.equal(criteria.intent, "rent");
  assert.equal(criteria.maxPrice, 700);
  assert.ok((criteria.wishes ?? []).some(wish => /balcon/i.test(wish)), `souhait « balcon » attendu, reçu : ${(criteria.wishes ?? []).join(", ")}`);
});

test("prod : recherche complète Apify + analyse OpenAI, de bout en bout", { timeout: 240_000 }, async () => {
  const id = await createSearch(PROMPT);
  const worker = createWorker({ owner: "prod-e2e" });
  let status = "running";
  for (let i = 0; i < 40 && status === "running"; i++) {
    await db().update(housingSearches).set({ nextCheckAt: 0 }).where(eq(housingSearches.id, id));
    await worker.tick();
    const [row] = await db().select().from(housingSearches).where(eq(housingSearches.id, id));
    status = row.status;
    if (status === "running") await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  const search = await getSearch(id);
  assert.equal(status, "completed", `recherche non terminée : ${status} ${search ? "" : "(introuvable)"}`);
  assert.ok(search && search.listings.length > 0, "au moins une annonce attendue");
  assert.ok(search.listings.length <= 10, "les limites de résultats sont respectées");
  for (const listing of search.listings) {
    assert.ok(isHousingListingUrl(listing.url), `URL non locative : ${listing.url}`);
    if (listing.price !== null) assert.ok(listing.price <= 700, `budget dépassé : ${listing.price} €`);
    assert.ok(listing.criterionResults.length > 0, "chaque annonce a des vérifications de critères");
  }
  assert.ok(search.listings.some(listing => listing.aiSummary), "au moins un résumé IA est produit");
  console.log(`# prod : ${search.listings.length} annonces, statut ${status}`);
});
