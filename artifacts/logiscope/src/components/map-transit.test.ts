import { describe, expect, it, vi } from 'vitest';
import type maplibregl from 'maplibre-gl';
import { addTransitLayers, LINE_LAYERS, LINES_MIN_ZOOM, setTransitLines, TILE_SOURCE, TRANSIT_ICONS, transitLayers } from '@/components/map-transit';
import { lineLabel, stopKind } from '@/components/nearest-stop';

/** Carte factice : juste ce que le module appelle (sources, couches, images, visibilité). */
function fakeMap(withSource = true, glyphs = true) {
  const layers = new Map<string, { layout?: Record<string, unknown> }>();
  const map = {
    layers,
    getSource: vi.fn((id: string) => withSource && id === TILE_SOURCE ? {} : undefined),
    getLayer: (id: string) => layers.get(id),
    addLayer: vi.fn((layer: { id: string; layout?: Record<string, unknown> }) => { layers.set(layer.id, { layout: { ...layer.layout } }); }),
    setLayoutProperty: (id: string, key: string, value: unknown) => { layers.get(id)!.layout![key] = value; },
    getLayoutProperty: (id: string, key: string) => layers.get(id)!.layout![key],
    getStyle: () => ({ glyphs: glyphs ? 'https://fonts/{fontstack}/{range}.pbf' : undefined }),
    hasImage: () => false, addImage: vi.fn(), on: vi.fn(),
  };
  return map;
}

describe('fond de carte : transports', () => {
  it('stations (métro, tram, gare) et arrêts de bus lus dans la couche « poi » des tuiles, en icônes grises', () => {
    const layers = transitLayers(false);
    const stations = layers.find(layer => layer.id === 'transit-stations')!;
    const bus = layers.find(layer => layer.id === 'transit-bus')!;
    expect(JSON.stringify(stations.filter)).toContain('"railway"');
    for (const subclass of ['subway', 'tram_stop', 'station', 'halt']) expect(JSON.stringify(stations.filter)).toContain(`"${subclass}"`);
    expect(JSON.stringify(bus.filter)).toContain('"bus_stop"');
    expect(bus.minzoom).toBe(15); // arrêts de bus nombreux : seulement de près
    expect(stations.minzoom).toBe(13);
    for (const layer of [stations, bus]) expect(layer).toMatchObject({ source: TILE_SOURCE, 'source-layer': 'poi' });
    for (const svg of Object.values(TRANSIT_ICONS)) expect(svg).toMatch(/fill="#(6f6f6f|9a9a9a)"/);
  });

  it('voies de métro et de tram (classe transit) : masquées par défaut, visibles sur demande, à partir du zoom 14', () => {
    const hidden = transitLayers(false).filter(layer => (LINE_LAYERS as readonly string[]).includes(layer.id));
    expect(hidden).toHaveLength(2);
    for (const layer of hidden) {
      expect(layer).toMatchObject({ 'source-layer': 'transportation', minzoom: LINES_MIN_ZOOM, layout: { visibility: 'none' } });
      expect(JSON.stringify(layer.filter)).toContain('"transit"');
    }
    for (const layer of transitLayers(true).filter(layer => (LINE_LAYERS as readonly string[]).includes(layer.id))) expect(layer.layout).toMatchObject({ visibility: 'visible' });
  });

  it('pose les couches et icônes, puis bascule les lignes sans recréer la carte ; sans la source des tuiles, ne fait rien', () => {
    const map = fakeMap();
    expect(addTransitLayers(map as unknown as maplibregl.Map, false)).toBe(true);
    expect([...map.layers.keys()]).toEqual(['transit-lines-tunnel', 'transit-lines', 'transit-bus', 'transit-stations']);
    expect(map.on).toHaveBeenCalledWith('styleimagemissing', expect.any(Function));
    expect(setTransitLines(map as unknown as maplibregl.Map, true)).toBe(true);
    expect(LINE_LAYERS.map(id => map.layers.get(id)!.layout!.visibility)).toEqual(['visible', 'visible']);
    expect(setTransitLines(map as unknown as maplibregl.Map, false)).toBe(false);
    expect(LINE_LAYERS.map(id => map.layers.get(id)!.layout!.visibility)).toEqual(['none', 'none']);

    const bare = fakeMap(false);
    expect(addTransitLayers(bare as unknown as maplibregl.Map, true)).toBe(false);
    expect(bare.addLayer).not.toHaveBeenCalled();
    expect(setTransitLines(bare as unknown as maplibregl.Map, true)).toBe(false);
  });

  it('style sans police : stations en icônes seules (un nom serait refusé par MapLibre)', () => {
    const map = fakeMap(true, false);
    addTransitLayers(map as unknown as maplibregl.Map, false);
    const added = map.addLayer.mock.calls.map(([layer]) => layer as { id: string; layout: Record<string, unknown> });
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
