import data from "../data/communes.json";

// Base des communes françaises (geo.api.gouv.fr, sans contours) : voir scripts/build-communes.mjs.
// ~35 000 lignes cherchées en mémoire : pas de table ni de migration, même comportement sur Postgres et PGlite.
export type Commune = {
  code: string; name: string; postalCodes: string[]; department: string; population: number; lon: number; lat: number;
};

type Row = [string, string, string[], string, number, number, number];
type Entry = Commune & { key: string; words: string[] };

/** Minuscules, sans accents, tirets/apostrophes en espaces, « st » → « saint » : « St-Étienne » ≡ « saint etienne ». */
export function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr")
    .replace(/œ/g, "oe").replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ")
    .map(word => (word === "st" ? "saint" : word === "ste" ? "sainte" : word)).join(" ");
}

const entries: Entry[] = (data as Row[]).map(([code, name, postalCodes, department, population, lon, lat]) => {
  const key = normalize(name);
  return { code, name, postalCodes, department, population, lon, lat, key, words: key.split(" ") };
});
const byKey = new Map<string, Entry[]>();
for (const entry of entries) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);

const strip = ({ key: _key, words: _words, ...commune }: Entry): Commune => commune;
const byPopulation = (a: Entry, b: Entry) => b.population - a.population;

/** Suggestions pour l'autocomplétion : nom exact, puis préfixe, puis début d'un mot ; population décroissante à rang égal. */
export function suggestPlaces(query: string, limit = 8): Commune[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  if (/^\d{2,5}$/.test(q)) {
    return entries.filter(entry => entry.postalCodes.some(postal => postal.startsWith(q))).sort(byPopulation).slice(0, limit).map(strip);
  }
  const ranked: { entry: Entry; rank: number }[] = [];
  for (const entry of entries) {
    const rank = entry.key === q ? 0 : entry.key.startsWith(q) ? 1 : entry.words.some(word => word.startsWith(q)) || entry.key.includes(` ${q}`) ? 2 : -1;
    if (rank >= 0) ranked.push({ entry, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank || byPopulation(a.entry, b.entry)).slice(0, limit).map(({ entry }) => strip(entry));
}

export type Resolution =
  | { status: "resolved"; commune: Commune }
  | { status: "ambiguous"; candidates: Commune[] }
  | { status: "unknown" };

/**
 * Rattache la ville saisie (ou renvoyée par le LLM) à une commune. Un département « (91) », « 91 » ou un code
 * postal en fin de chaîne lève les homonymes ; sans eux, un nom partagé par plusieurs communes reste ambigu.
 * Seule une correspondance EXACTE du nom est acceptée : « Paris 12e » ou une région restent inconnues.
 */
export function resolvePlace(text: string): Resolution {
  const raw = text.trim();
  if (!raw) return { status: "unknown" };
  const hint = raw.match(/^(.*?)[\s,(-]+(\d{5}|\d{2,3}|2[AB])\)?$/i);
  const name = normalize(hint ? hint[1] : raw);
  let candidates = byKey.get(name) ?? [];
  if (hint && candidates.length > 1) {
    const value = hint[2].toUpperCase();
    const narrowed = candidates.filter(entry => value.length === 5 ? entry.postalCodes.includes(value) : entry.department === value);
    if (narrowed.length) candidates = narrowed;
  }
  if (candidates.length === 0) return { status: "unknown" };
  if (candidates.length === 1) return { status: "resolved", commune: strip(candidates[0]) };
  return { status: "ambiguous", candidates: [...candidates].sort(byPopulation).map(strip) };
}

/** Nom officiel si la ville est reconnue sans ambiguïté (corrige casse, accents, « st »), sinon le texte d'origine. */
export function canonicalLocation(text: string): string {
  const resolution = resolvePlace(text);
  return resolution.status === "resolved" ? resolution.commune.name : text;
}

/**
 * Commune dont le centre est le plus proche d'un point. Le Bon Coin cherche d'après le nom et le code postal de la
 * commune, pas d'après les coordonnées seules (constaté en réel le 06/10/2026) : une zone centrée hors de la commune
 * recherchée doit donc porter le nom de la commune où elle est centrée.
 */
export function nearestCommune(lat: number, lon: number): Commune {
  const cos = Math.cos(lat * Math.PI / 180);
  let best = entries[0], bestDistance = Infinity;
  for (const entry of entries) {
    const distance = (entry.lat - lat) ** 2 + ((entry.lon - lon) * cos) ** 2;
    if (distance < bestDistance) { best = entry; bestDistance = distance; }
  }
  return strip(best);
}
