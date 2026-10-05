// Régénère, d'après OpenStreetMap (Overpass), les stations (src/data/stations.json) et les tracés (src/data/transit-lines.json)
// des lignes de métro et de tram de France.
// Usage : pnpm --filter @workspace/api-server run data:transit   (OVERPASS_URL pour changer de serveur ; OVERPASS_CACHE=dossier
// garde les réponses brutes pour relancer sans tout redemander)
// Seuls les arrêts desservis par une ligne de métro ou de tram (relation route=subway|tram|light_rail) sont gardés :
// pas de trains touristiques ni d'arrêts abandonnés. Les quais et arrêts d'une même station (même nom, < 300 m) sont
// fusionnés. Format compact : [nom, latitude, longitude, lignes] ; une ligne = "m|1|#ffcd00" (m métro, t tram).
// Tracés : une entrée par ligne (mode, nom, couleur officielle, réseau), ses voies allégées à 4 m près, en
// [lng, lat, lng, lat, …] à 1e-5 près : [mode, nom, couleur, [[…], […]]].
// Données © les contributeurs d'OpenStreetMap, licence ODbL.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const area = 'area["ISO3166-1"="FR"][admin_level=2]->.fr;';

const CACHE = process.env.OVERPASS_CACHE;
async function overpass(query) {
  const file = CACHE && path.join(CACHE, `${createHash("sha1").update(query).digest("hex")}.json`);
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const elements = await ask(query);
  if (file) { mkdirSync(CACHE, { recursive: true }); writeFileSync(file, JSON.stringify(elements)); }
  return elements;
}

async function ask(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: `[out:json][timeout:600];${query}` }), signal: AbortSignal.timeout(900_000) });
      if (response.ok) return (await response.json()).elements;
      if (attempt === 10) throw new Error(`Overpass a répondu ${response.status}`);
    } catch (error) {
      if (attempt === 10) throw error; // serveur muet ou coupé : on réessaie, puis on abandonne
    }
    await new Promise(resolve => setTimeout(resolve, 20_000 * attempt));
  }
}

/** Douglas-Peucker sur [[lon, lat], …] : retire les points à moins de `tolerance` mètres du trait. */
function simplify(points, tolerance = 4) {
  if (points.length < 3) return points;
  const cos = Math.cos(points[0][1] * Math.PI / 180);
  const xy = points.map(([lon, lat]) => [lon * 111_320 * cos, lat * 110_540]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = xy[first], [bx, by] = xy[last], dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
    let farthest = -1, worst = tolerance;
    for (let i = first + 1; i < last; i++) {
      const t = length2 ? Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / length2)) : 0;
      const d = Math.hypot(xy[i][0] - ax - t * dx, xy[i][1] - ay - t * dy);
      if (d > worst) [worst, farthest] = [d, i];
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return points.filter((_, i) => keep[i]);
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

/** Nom court d'une ligne (« b » → « B ») ; un nom long est un intitulé (« Tram : A → B »), pas un nom de ligne. */
function lineName(route) {
  const name = (route.tags.ref || route.tags.name || "").trim().replace(/[|;]/g, "");
  if (!name || name.length > 12) return null;
  return name.length === 1 ? name.toUpperCase() : name;
}
const lineColour = route => /^#[0-9a-f]{6}$/i.test(route.tags.colour ?? "") ? route.tags.colour.toLowerCase() : "";

/** Lignes passant par chaque arrêt. Une ligne a souvent une relation par sens : même mode + même nom = même ligne. */
const linesAt = new Map();
for (const route of routes) {
  const name = lineName(route);
  if (!name) continue;
  const line = `${route.tags.route === "subway" ? "m" : "t"}|${name}|${lineColour(route)}`;
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

// Tracés : les voies (membres « way » hors quais) de toutes les relations d'une même ligne, chacune une seule fois.
const isTrack = member => member.type === "way" && !/platform/.test(member.role);
const wayIds = [...new Set(routes.flatMap(route => route.members.filter(isTrack).map(member => member.ref)))];
const ways = new Map();
for (let i = 0; i < wayIds.length; i += 200) {
  for (const way of await overpass(`way(id:${wayIds.slice(i, i + 200).join(",")});out geom qt;`)) ways.set(way.id, way);
  console.log(`${ways.size} / ${wayIds.length} voies lues`);
}
const lines = new Map();
for (const route of routes) {
  const name = lineName(route);
  if (!name) continue;
  const mode = route.tags.route === "subway" ? "m" : "t";
  const key = [mode, name, lineColour(route), route.tags.network ?? route.tags.operator ?? ""].join("|");
  const line = lines.get(key) ?? { mode, name, colour: lineColour(route), ways: new Set() };
  route.members.filter(isTrack).forEach(member => line.ways.add(member.ref));
  lines.set(key, line);
}
const round = value => Math.round(value * 1e5) / 1e5;
const tracks = [...lines.values()].map(line => [line.mode, line.name, line.colour, [...line.ways]
  .map(id => ways.get(id)?.geometry?.map(point => [point.lon, point.lat]) ?? [])
  .filter(points => points.length > 1)
  .map(points => simplify(points).flatMap(([lon, lat]) => [round(lon), round(lat)]))])
  .filter(line => line[3].length);
writeFileSync(new URL("../src/data/transit-lines.json", import.meta.url), JSON.stringify(tracks));
console.log(`${tracks.length} lignes tracées (${ways.size} voies).`);
