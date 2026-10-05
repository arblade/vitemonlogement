import data from "../data/transit-lines.json";

// Tracés des lignes de métro et de tram de France (OpenStreetMap, voir scripts/build-transit.mjs), en mémoire : la
// carte ne demande que les lignes de la zone affichée. Données © les contributeurs d'OpenStreetMap (ODbL).
type Row = ["m" | "t", string, string, number[][]];
export type TransitLine = { mode: "metro" | "tram"; name: string; color: string | null; paths: [number, number][][]; box: [number, number, number, number] };
export type Box = { west: number; south: number; east: number; north: number };

/** Couleur faute de couleur officielle (bleu métro, violet tram), comme la légende de la carte. */
export const FALLBACK_COLOR = { metro: "#3056d3", tram: "#8e44ad" } as const;

export function toLines(rows: Row[]): TransitLine[] {
  return rows.map(([mode, name, color, flat]) => {
    const paths = flat.map(values => Array.from({ length: values.length / 2 }, (_, i) => [values[2 * i], values[2 * i + 1]] as [number, number]));
    const box: TransitLine["box"] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lng, lat] of paths.flat()) {
      box[0] = Math.min(box[0], lng); box[1] = Math.min(box[1], lat); box[2] = Math.max(box[2], lng); box[3] = Math.max(box[3], lat);
    }
    return { mode: mode === "m" ? "metro" : "tram", name, color: color || null, paths, box };
  });
}

const lines = toLines(data as Row[]);

/** La zone demandée est bornée (≈ 1° de côté, une grande agglomération) : jamais la France entière d'un coup. */
export const MAX_SPAN = 1.2;

/**
 * Lignes qui traversent la zone, en GeoJSON : une entité par ligne, sa couleur officielle (ou celle du mode), son nom.
 * Métro au-dessus du tram (dessiné après). Zone invalide ou trop grande : aucune ligne.
 */
export function linesIn(box: Box, list: TransitLine[] = lines) {
  const valid = [box.west, box.south, box.east, box.north].every(Number.isFinite)
    && box.east > box.west && box.north > box.south && box.east - box.west <= MAX_SPAN && box.north - box.south <= MAX_SPAN;
  const features = !valid ? [] : list
    .filter(line => line.box[0] <= box.east && line.box[2] >= box.west && line.box[1] <= box.north && line.box[3] >= box.south)
    .sort((a, b) => (a.mode === b.mode ? 0 : a.mode === "tram" ? -1 : 1))
    .map(line => ({
      type: "Feature" as const,
      properties: { mode: line.mode, name: line.name, color: line.color ?? FALLBACK_COLOR[line.mode] },
      geometry: { type: "MultiLineString" as const, coordinates: line.paths },
    }));
  return { type: "FeatureCollection" as const, features };
}
