// Collecte d'annonces Le Bon Coin réelles pour le banc d'essai (APIFY_TOKEN ; ≈ 0,001 $ l'annonce). À lancer à la main.
import { writeFileSync } from "node:fs";
import { housingActorInput } from "../src/routes/housing/housing-search";
import { normalize } from "../src/routes/housing/apify";
import type { Criteria } from "../src/routes/housing/store";

const cities = (process.argv[2] ?? "Lyon,Bordeaux,Nantes,Toulouse,Rennes").split(",");
const perCity = Number(process.argv[3] ?? 25);
const out: { url: string; title: string; description: string; city: string; raw: unknown }[] = [];
for (const city of cities) {
  const criteria: Criteria = { location: city, intent: "rent", keywords: "", radius: 10, wishes: [] };
  const { actor, input } = housingActorInput(criteria, perCity);
  const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?maxItems=${perCity}&maxTotalChargeUsd=0.08&timeout=240`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const items = await res.json() as unknown[];
  if (!res.ok || !Array.isArray(items)) { console.error(city, res.status, JSON.stringify(items).slice(0, 200)); continue; }
  let kept = 0;
  for (const raw of items) {
    const listing = normalize(raw, criteria);
    if (!listing || (listing.description ?? "").length < 80) continue;
    // Ni vendeur ni photos dans le dépôt : seuls les champs utiles à l'étude sont gardés.
    const { seller, media, source_data, relationships, source_context, ...kept_raw } = raw as Record<string, unknown>;
    const source = (source_data ?? {}) as Record<string, unknown>; // attributs Le Bon Coin, lus par fromFatihRecord
    out.push({ url: listing.url, title: listing.title, description: listing.description ?? "", city, raw: { ...kept_raw, source_data: { attributes: source.attributes, location: source.location } } }); kept++;
  }
  console.log(`${city} (${actor}) : ${items.length} reçues, ${kept} gardées`);
}
const unique = [...new Map(out.map(item => [item.description, item])).values()];
writeFileSync("bench/annonces-lbc.json", JSON.stringify(unique, null, 2));
console.log(`${unique.length} annonces dans bench/annonces-lbc.json`);
