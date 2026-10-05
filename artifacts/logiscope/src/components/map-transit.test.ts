import { describe, expect, it, vi } from 'vitest';
import type maplibregl from 'maplibre-gl';
import { addTransitLayers, LINE_LAYERS, lineLayers, linesArea, linesUrl, LINES_SOURCE, setTransitLines, stopLayers, TILE_SOURCE, TRANSIT_ICONS } from '@/components/map-transit';
import { lineLabel, stopKind, transitBadge } from '@/components/nearest-stop';

type Handler = (...args: unknown[]) => void;
/** Carte factice : juste ce que le module appelle (sources, couches, images, visibilité, déplacements). */
function fakeMap({ tiles = true, glyphs = true } = {}) {
  const layers = new Map<string, { type: string; layout?: Record<string, unknown> }>();
  const sources = new Map<string, { data?: unknown; setData: (data: unknown) => void }>();
  if (tiles) sources.set(TILE_SOURCE, { setData: () => undefined });
  const handlers = new Map<string, Handler[]>();
  const view = { west: 3.0, south: 50.6, east: 3.1, north: 50.66 };
  const map = {
    layers, sources, view,
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string, spec: { data: unknown }) => {
      const source = { data: spec.data, setData: vi.fn((data: unknown) => { source.data = data; }) };
      sources.set(id, source);
    }),
    getLayer: (id: string) => layers.get(id),
    addLayer: vi.fn((layer: { id: string; type: string; layout?: Record<string, unknown> }) => { layers.set(layer.id, { type: layer.type, layout: { ...layer.layout } }); }),
    setLayoutProperty: (id: string, key: string, value: unknown) => { layers.get(id)!.layout![key] = value; },
    getLayoutProperty: (id: string, key: string) => layers.get(id)!.layout![key],
    getStyle: () => ({ glyphs: glyphs ? 'https://fonts/{fontstack}/{range}.pbf' : undefined }),
    getBounds: () => ({ getWest: () => view.west, getSouth: () => view.south, getEast: () => view.east, getNorth: () => view.north }),
    hasImage: () => false, addImage: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => { handlers.set(event, [...handlers.get(event) ?? [], handler]); }),
    fire: (event: string) => handlers.get(event)?.forEach(handler => handler({})),
  };
  return map;
}
const asMap = (map: ReturnType<typeof fakeMap>) => map as unknown as maplibregl.Map;

describe('carte : transports', () => {
  it('stations (métro, tram, gare) et arrêts de bus lus dans la couche « poi » des tuiles, en icônes grises', () => {
    const [bus, stations] = stopLayers();
    expect(JSON.stringify(stations.filter)).toContain('"railway"');
    for (const subclass of ['subway', 'tram_stop', 'station', 'halt']) expect(JSON.stringify(stations.filter)).toContain(`"${subclass}"`);
    expect(JSON.stringify(bus.filter)).toContain('"bus_stop"');
    expect(bus.minzoom).toBe(15); // arrêts de bus nombreux : seulement de près
    expect(stations.minzoom).toBe(13);
    for (const layer of [stations, bus]) expect(layer).toMatchObject({ source: TILE_SOURCE, 'source-layer': 'poi' });
    for (const svg of Object.values(TRANSIT_ICONS)) expect(svg).toMatch(/fill="#(6f6f6f|9a9a9a)"/);
  });

  it('lignes : traits pleins (aucun tiret) dans la couleur officielle de chaque ligne, à tous les zooms ; masquées par défaut', () => {
    const layers = lineLayers(false);
    expect(layers.map(layer => layer.id)).toEqual([...LINE_LAYERS]);
    for (const layer of layers) {
      expect(layer.source).toBe(LINES_SOURCE);
      expect(layer.layout).toMatchObject({ visibility: 'none' });
      expect(JSON.stringify(layer)).not.toContain('dasharray');
    }
    const line = layers.find(layer => layer.id === 'transit-lines')!;
    expect(line.paint).toMatchObject({ 'line-color': ['get', 'color'] });
    expect(line.minzoom).toBeUndefined();
    for (const layer of lineLayers(true)) expect(layer.layout).toMatchObject({ visibility: 'visible' });
  });

  it('zone demandée au serveur : la vue élargie d’un tiers de chaque côté', () => {
    const area = linesArea({ west: 3, south: 50.6, east: 3.3, north: 50.9 });
    expect(area).toEqual({ west: 2.9, south: 50.5, east: 3.4, north: 51 });
    expect(linesUrl(area)).toBe('/api/transit/lines?west=2.9&south=50.5&east=3.4&north=51');
  });

  it('pose lignes puis stations ; redemande les lignes seulement quand la vue sort de la zone chargée ; bascule sans recréer la carte', () => {
    const map = fakeMap();
    expect(addTransitLayers(asMap(map), false)).toBe(true);
    expect([...map.layers.keys()]).toEqual([...LINE_LAYERS, 'transit-bus', 'transit-stations']);
    const source = map.sources.get(LINES_SOURCE)!;
    const first = source.data;
    expect(first).toMatch(/^\/api\/transit\/lines\?west=2\.96.*&north=50\.68$/);
    map.view.east = 3.11; map.fire('moveend'); // petit déplacement : encore dans la zone
    expect(source.setData).not.toHaveBeenCalled();
    Object.assign(map.view, { west: 3.5, east: 3.6 }); map.fire('moveend');
    expect(source.setData).toHaveBeenCalledTimes(1);
    expect(source.data).not.toBe(first);
    expect(setTransitLines(asMap(map), true)).toBe(true);
    expect(LINE_LAYERS.map(id => map.layers.get(id)!.layout!.visibility)).toEqual(['visible', 'visible', 'visible']);
    expect(setTransitLines(asMap(map), false)).toBe(false);
  });

  it('style sans source de tuiles : pas de stations, mais les lignes restent ; sans police : ni noms de stations ni noms de lignes', () => {
    const bare = fakeMap({ tiles: false });
    expect(addTransitLayers(asMap(bare), true)).toBe(false);
    expect([...bare.layers.keys()]).toEqual([...LINE_LAYERS]);
    expect(setTransitLines(asMap(bare), true)).toBe(true);

    const mute = fakeMap({ glyphs: false });
    addTransitLayers(asMap(mute), false);
    expect(mute.layers.has('transit-lines-label')).toBe(false);
    const added = mute.addLayer.mock.calls.map(([layer]) => layer as { id: string; layout: Record<string, unknown> });
    expect(added.find(layer => layer.id === 'transit-stations')!.layout['text-field']).toBeUndefined();
    expect(added.find(layer => layer.id === 'transit-stations')!.layout['icon-image']).toBeDefined();
  });
});

describe('station la plus proche : libellés', () => {
  it('« M1 » pour un métro numéroté, nom tel quel sinon ; métro, tram ou les deux', () => {
    expect(lineLabel({ mode: 'metro', name: '1', color: null })).toBe('M1');
    expect(lineLabel({ mode: 'metro', name: '3bis', color: null })).toBe('M3bis');
    expect(lineLabel({ mode: 'metro', name: 'A', color: null })).toBe('A');
    expect(lineLabel({ mode: 'tram', name: 'T2', color: null })).toBe('T2');
    expect(stopKind({ lines: [{ mode: 'metro', name: '1', color: null }] })).toBe('Métro');
    expect(stopKind({ lines: [{ mode: 'tram', name: 'R', color: null }] })).toBe('Tram');
    expect(stopKind({ lines: [{ mode: 'metro', name: 'A', color: null }, { mode: 'tram', name: 'T1', color: null }] })).toBe('Métro et tram');
  });
});

describe('badge métro / tram de la carte d’annonce', () => {
  const stop = (walkMinutes: number, ...modes: ('metro' | 'tram')[]) => ({ walkMinutes, lines: modes.map(mode => ({ mode, name: 'X', color: null })) });
  it('palier de 5 minutes au-dessus, « Métro » dès qu’une ligne de métro dessert la station, rien au-delà de 15 minutes', () => {
    expect(transitBadge(stop(1, 'metro'))?.text).toBe('Métro à 5 min');
    expect(transitBadge(stop(5, 'tram'))?.text).toBe('Tram à 5 min');
    expect(transitBadge(stop(6, 'tram'))?.text).toBe('Tram à 10 min');
    expect(transitBadge(stop(10, 'metro', 'tram'))?.text).toBe('Métro à 10 min');
    expect(transitBadge(stop(11, 'metro'))?.text).toBe('Métro à 15 min');
    expect(transitBadge(stop(15, 'metro'))?.text).toBe('Métro à 15 min');
    expect(transitBadge(stop(16, 'metro'))).toBeNull();
    expect(transitBadge(null)).toBeNull();
    expect(transitBadge(undefined)).toBeNull();
  });
});
