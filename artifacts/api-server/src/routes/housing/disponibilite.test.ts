// Les dates de disponibilité n'apparaissent pas « de nulle part » : le champ Le Bon Coin `available_date` est souvent
// rempli par défaut (mois de publication), parfois déjà passé, parfois contredit par le texte : il n'est jamais affiché.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { housingListings } from "@workspace/db";
import { closeDatabase, db } from "../../lib/database";
import { useMemoryDatabase } from "../../test/helpers";

before(async () => { await useMemoryDatabase(); });
after(async () => { await closeDatabase(); });

test("annonces déjà enregistrées avec « Disponible » (lecture d'avant la correction) : la caractéristique n'est plus montrée", async () => {
  const { createSearch, getSearch } = await import("./store");
  const id = await createSearch("Un T2 à Lille, 900 € max");
  const features = [
    { label: "Disponible", value: "à partir de 10/2026", source: "annonce", evidence: "Indiqué dans l’annonce : « date de disponibilité »." },
    { label: "Disponible", value: "à partir du 30/09/2026", source: "annonce", evidence: "Indiqué dans l’annonce : « date de disponibilité »." },
    { label: "Chauffage", value: "Individuel · gaz", source: "annonce", evidence: "Indiqué dans l’annonce : « chauffage »." },
    // Date lue dans le texte par l'IA, citation à l'appui : légitime, elle reste.
    { label: "Disponibilité", value: "à partir du 2 mars", source: "ia", evidence: "Disponible à partir du 2 mars" },
  ];
  await db().insert(housingListings).values({
    searchId: id, title: "T2", url: "https://www.leboncoin.fr/ad/locations/1", description: "Disponible à partir du 2 mars", score: 70,
    features: JSON.stringify(features), analyzed: 1,
  });
  const search = (await getSearch(id))!;
  assert.deepEqual(search.listings[0].features.map(feature => feature.label), ["Chauffage", "Disponibilité"]);
});
