// Régénère src/data/stations.json : les stations de métro et de tram de France, d'après OpenStreetMap (Overpass).
// Usage : pnpm --filter @workspace/api-server run data:stations   (OVERPASS_URL pour changer de serveur)
// Seuls les arrêts desservis par une ligne de métro ou de tram (relation route=subway|tram|light_rail) sont gardés :
// pas de trains touristiques ni d'arrêts abandonnés. Les quais et arrêts d'une même station (même nom, < 300 m) sont
// fusionnés. Format compact : [nom, latitude, longitude, lignes] ; une ligne = "m|1|#ffcd00" (m métro, t tram).
// Données © les contributeurs d'OpenStreetMap, licence ODbL.
import { writeFileSync } from "node:fs";

const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const area = 'area["ISO3166-1"="FR"][admin_level=2]->.fr;';

async function overpass(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: `[out:json][timeout:600];${query}` }), signal: AbortSignal.timeout(900_000) });
      if (response.ok) return (await response.json()).elements;
      if (attempt === 6) throw new Error(`Overpass a répondu ${response.status}`);
    } catch (error) {
      if (attempt === 6) throw error; // serveur muet ou coupé : on réessaie, puis on abandonne
    }
    await new Promise(resolve => setTimeout(resolve, 10_000 * attempt));
  }
}

const normalize = value => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function meters(a, b) {
  const rad = value => value * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const routes = await overpass(`${area}rel["type"="route"]["route"~"^(subway|tram|light_rail)$"](area.fr);out body qt;`);
console.log(`${routes.length} relations de lignes lues`);
const ids = [...new Set(routes.flatMap(route => route.members
  .filter(member => member.type === "node" && /^(stop|platform)/.test(member.role)).map(member => member.ref)))];
const nodes = new Map();
for (let i = 0; i < ids.length; i += 300) {
  for (const node of await overpass(`node(id:${ids.slice(i, i + 300).join(",")});out qt;`)) nodes.set(node.id, node);
  console.log(`${nodes.size} / ${ids.length} arrêts lus`);
}

/** Lignes passant par chaque arrêt. Une ligne a souvent une relation par sens : même mode + même nom = même ligne. */
const linesAt = new Map();
for (const route of routes) {
  const name = (route.tags.ref || route.tags.name || "").trim();
  if (!name || name.length > 12) continue; // un nom long est un intitulé (« Tram : A → B »), pas un nom de ligne
  const colour = /^#[0-9a-f]{6}$/i.test(route.tags.colour ?? "") ? route.tags.colour.toLowerCase() : "";
  const line = `${route.tags.route === "subway" ? "m" : "t"}|${name.replace(/\|/g, "")}|${colour}`;
  for (const member of route.members) {
    if (member.type !== "node" || !/^(stop|platform)/.test(member.role)) continue;
    linesAt.set(member.ref, new Set([...linesAt.get(member.ref) ?? [], line]));
  }
}

const stations = [];
const named = [...nodes.values()].filter(node => node.tags?.name).sort((a, b) => a.id - b.id);
for (const node of named) {
  const key = normalize(node.tags.name);
  const station = stations.find(item => item.key === key && meters(item.points[0], node) < 300);
  if (station) station.points.push(node); else stations.push({ key, name: node.tags.name.trim(), points: [node] });
}
// Arrêt sans nom (souvent la position d'arrêt sur la voie) : rattaché à la station la plus proche si elle est à < 80 m.
for (const node of nodes.values()) {
  if (node.tags?.name) continue;
  let best = null, distance = 80;
  for (const station of stations) {
    const d = meters(station.points[0], node);
    if (d < distance) [best, distance] = [station, d];
  }
  best?.points.push(node);
}

const rows = stations.map(station => {
  const lat = station.points.reduce((sum, point) => sum + point.lat, 0) / station.points.length;
  const lon = station.points.reduce((sum, point) => sum + point.lon, 0) / station.points.length;
  const lines = [...new Set(station.points.flatMap(point => [...linesAt.get(point.id) ?? []]))].sort();
  return [station.name, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, lines.join(";")];
}).filter(row => row[3]).sort((a, b) => a[1] - b[1] || a[2] - b[2]);

writeFileSync(new URL("../src/data/stations.json", import.meta.url), JSON.stringify(rows));
console.log(`${routes.length} relations de lignes, ${nodes.size} arrêts, ${rows.length} stations écrites.`);
