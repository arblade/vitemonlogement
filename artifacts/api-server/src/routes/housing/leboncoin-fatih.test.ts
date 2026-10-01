import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromFatihRecord, normalize } from "./apify";
import type { Criteria } from "./store";

// Mêmes annonces Lille lues le 01/10/2026 par les deux acteurs (vendeurs et références retirés).
const sample = (name: string) => JSON.parse(readFileSync(new URL(`../../test/${name}`, import.meta.url), "utf8")) as Record<string, unknown>[];
const fatih = sample("leboncoin-fatih-sample.json");
const clearpath = sample("leboncoin-clearpath-sample.json");
const J = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
const criteria: Criteria = { location: "Lille", intent: "rent", keywords: "", radius: 5, maxPrice: 700, minRooms: 1, maxRooms: 2, wishes: ["meublé", "parking", "ascenseur"] };

test("fatihtahta et clearpath, 6 mêmes annonces réelles : titre, loyer, surface, pièces, lieu, position, photos, description et critères identiques", () => {
  assert.equal(clearpath.length, 6);
  for (const reference of clearpath) {
    const record = fatih.find(item => item.url === reference.url);
    assert.ok(record, String(reference.url));
    const mine = normalize(record, criteria)!;
    const theirs = normalize(reference, criteria)!;
    const core = (l: typeof mine) => ({
      title: l.title, price: l.price, area: l.area, rooms: l.rooms, location: l.location, lat: l.lat, lng: l.lng, geoPrecision: l.geoPrecision,
      images: l.images, description: l.description.replace(/\s+/g, " ").trim(), criteria: l.criterionResults.map(check => `${check.label}=${check.status}`),
      energy: l.features.filter(f => /énergie|GES/.test(f.label)).map(f => `${f.label}=${f.value}`),
    });
    assert.deepEqual(core(mine), core(theirs), String(reference.url));
    assert.equal(mine.source, "leboncoin");
  }
});

test("fatihtahta, 10 vraies annonces : toutes lues, en location, photos en grande taille", () => {
  const listings = fatih.map(record => normalize(record, { ...criteria, wishes: [] }));
  assert.ok(listings.every(listing => listing !== null));
  assert.ok(listings.every(listing => listing!.images.every(image => image.includes("rule=ad-large"))));
  assert.ok(listings.every(listing => listing!.price! > 0 && listing!.lat != null));
});

test("fatihtahta : une vente (deal_type) ou un parking (type de bien) est écarté à la lecture", () => {
  const home = fatih[0];
  const listing = J(home.listing);
  assert.equal(fromFatihRecord({ ...home, listing: JSON.stringify({ ...listing, deal_type: "sale" }) }), null);
  assert.equal(normalize({ ...home, listing: JSON.stringify({ ...listing, deal_type: "sale" }) }, criteria), null);
  assert.equal(normalize({ ...home, listing: JSON.stringify({ ...listing, deal_type: undefined }) }, criteria), null, "type de transaction absent");
  const raw = J(home.source_data) as { attributes: { key: string; value: string }[] };
  const parking = { ...raw, attributes: raw.attributes.map(a => a.key === "real_estate_type" ? { ...a, value: "4", value_label: "Parking" } : a) };
  assert.equal(normalize({ ...home, source_data: JSON.stringify(parking) }, criteria), null);
  assert.equal(normalize({ ...home, url: "https://www.leboncoin.fr/ad/ventes_immobilieres/1" }, criteria), null, "URL de vente");
});
