// Régénère src/data/communes.json depuis l'API Découpage administratif (geo.api.gouv.fr), sans contours.
// Usage : pnpm --filter @workspace/api-server run data:communes
// Format compact : [code INSEE, nom, codes postaux, code département, population, longitude, latitude].
import { writeFileSync } from "node:fs";

const url = "https://geo.api.gouv.fr/communes?fields=nom,code,codesPostaux,codeDepartement,population,centre&format=json&geometry=centre";
const response = await fetch(url);
if (!response.ok) throw new Error(`geo.api.gouv.fr a répondu ${response.status}`);
const communes = await response.json();
const rows = communes
  .filter(c => c.centre?.coordinates)
  .map(c => [c.code, c.nom, c.codesPostaux ?? [], c.codeDepartement ?? "", c.population ?? 0, ...c.centre.coordinates])
  .sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(new URL("../src/data/communes.json", import.meta.url), JSON.stringify(rows));
console.log(`${rows.length} communes écrites.`);
