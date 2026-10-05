import Pbf from "pbf";
import { tilePosition } from "../lib/bus-stops";

// Encodeur minimal de tuile vectorielle (spécification Mapbox Vector Tile 2.1) pour les tests : une couche « poi » de
// points avec leurs propriétés texte. Évite d'embarquer une vraie tuile de plusieurs centaines de ko.
export type TilePoint = { lat: number; lng: number; properties: Record<string, string> };

const zigzag = (value: number) => (value << 1) ^ (value >> 31);

export function encodePoiTile(points: TilePoint[], x: number, y: number, z = 14, extent = 4096) {
  const keys: string[] = [], values: string[] = [];
  const index = (list: string[], item: string) => { const at = list.indexOf(item); return at >= 0 ? at : list.push(item) - 1; };
  const features = points.map(point => {
    const position = tilePosition(point, z);
    const tags = Object.entries(point.properties).flatMap(([key, value]) => [index(keys, key), index(values, value)]);
    return { tags, geometry: [9, zigzag(Math.round((position.x - x) * extent)), zigzag(Math.round((position.y - y) * extent))] };
  });
  const pbf = new Pbf();
  pbf.writeMessage(3, (_: unknown, out: Pbf) => {
    out.writeVarintField(15, 2);
    out.writeStringField(1, "poi");
    for (const feature of features) {
      out.writeMessage(2, (_f: unknown, inner: Pbf) => {
        inner.writePackedVarint(2, feature.tags);
        inner.writeVarintField(3, 1);
        inner.writePackedVarint(4, feature.geometry);
      }, null);
    }
    keys.forEach(key => out.writeStringField(3, key));
    values.forEach(value => out.writeMessage(4, (_v: unknown, inner: Pbf) => inner.writeStringField(1, value), null));
    out.writeVarintField(5, extent);
  }, null);
  return pbf.finish();
}
