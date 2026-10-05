import type maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';

// Transports en commun sur la carte, sans Google :
// - stations et arrêts en gris, lus dans les tuiles OpenFreeMap déjà chargées (schéma OpenMapTiles, couche « poi » :
//   classe railway, sous-classes subway, tram_stop, station, halt ; classe bus) ;
// - lignes de métro et de tram en option, dans leurs couleurs officielles, servies par notre API (/api/transit/lines,
//   tracés OpenStreetMap) pour la zone affichée : traits continus, à tous les zooms.
export const TILE_SOURCE = 'openmaptiles';
export const LINES_SOURCE = 'transit-lines';
export const LINE_LAYERS = ['transit-lines-casing', 'transit-lines', 'transit-lines-label'] as const;

const disc = (fill: string, glyph: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>`
  + `<g transform="translate(5.4 5.4) scale(.55)" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;

// Tracés Lucide (ISC) : tram-front, train-front, bus-front ; « M » dessiné pour le métro.
const GLYPHS = {
  metro: '<path d="M5 19V5l7 8 7-8v14"/>',
  tram: '<rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/>',
  train: '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  bus: '<path d="M10 6h4"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M6 19v2"/><path d="M18 21v-2"/>',
} as const;

/** Icônes grises des stations (gris foncé pour métro, tram et gare, plus clair et plus petit pour le bus). */
export const TRANSIT_ICONS: Record<string, string> = {
  'vml-metro': disc('#6f6f6f', GLYPHS.metro),
  'vml-tram': disc('#6f6f6f', GLYPHS.tram),
  'vml-train': disc('#6f6f6f', GLYPHS.train),
  'vml-bus': disc('#9a9a9a', GLYPHS.bus),
};

/** Stations (métro, tram, gare ; nom au zoom 15) et arrêts de bus (à partir du zoom 15, sans nom), lus dans les tuiles. */
export function stopLayers(): SymbolLayerSpecification[] {
  return [
    { id: 'transit-bus', type: 'symbol', source: TILE_SOURCE, 'source-layer': 'poi', minzoom: 15,
      filter: ['all', ['==', ['get', 'class'], 'bus'], ['match', ['get', 'subclass'], ['bus_stop', 'bus_station'], true, false]] as never,
      layout: { 'icon-image': 'vml-bus', 'icon-size': .75, 'icon-padding': 1 }, paint: { 'icon-opacity': .9 } },
    { id: 'transit-stations', type: 'symbol', source: TILE_SOURCE, 'source-layer': 'poi', minzoom: 13,
      filter: ['all', ['==', ['get', 'class'], 'railway'], ['match', ['get', 'subclass'], ['subway', 'tram_stop', 'station', 'halt'], true, false]] as never,
      layout: {
        'icon-image': ['match', ['get', 'subclass'], 'subway', 'vml-metro', 'tram_stop', 'vml-tram', 'vml-train'] as never,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 13, .7, 16, 1] as never, 'icon-padding': 1,
        'text-field': ['step', ['zoom'], '', 15, ['coalesce', ['get', 'name:fr'], ['get', 'name']]] as never,
        'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.25], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 8,
      },
      paint: { 'text-color': '#6f6f6f', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    },
  ];
}

const lineWidth = ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4, 17, 6];
const casingWidth = ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 6.5, 17, 9];

/**
 * Lignes de métro et de tram : liseré blanc puis trait plein de la couleur officielle (métro au-dessus du tram, ordre
 * des entités), nom de la ligne le long du trait au zoom 13. Masquées tant qu'on ne les demande pas.
 */
export function lineLayers(showLines: boolean): (LineLayerSpecification | SymbolLayerSpecification)[] {
  const visibility = showLines ? 'visible' : 'none';
  return [
    { id: 'transit-lines-casing', type: 'line', source: LINES_SOURCE, layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': casingWidth as never, 'line-opacity': .9 } },
    { id: 'transit-lines', type: 'line', source: LINES_SOURCE, layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'] as never, 'line-width': lineWidth as never } },
    { id: 'transit-lines-label', type: 'symbol', source: LINES_SOURCE, minzoom: 13,
      layout: { visibility, 'symbol-placement': 'line', 'symbol-spacing': 320, 'text-field': ['get', 'name'] as never, 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
      paint: { 'text-color': ['get', 'color'] as never, 'text-halo-color': '#ffffff', 'text-halo-width': 2 } },
  ];
}

/** Zone demandée au serveur : la vue, élargie d'un tiers de chaque côté (on peut déplacer la carte sans recharger). */
export function linesArea(bounds: { west: number; south: number; east: number; north: number }) {
  const padX = (bounds.east - bounds.west) / 3, padY = (bounds.north - bounds.south) / 3;
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  return { west: round(bounds.west - padX), south: round(bounds.south - padY), east: round(bounds.east + padX), north: round(bounds.north + padY) };
}
export const linesUrl = (area: ReturnType<typeof linesArea>) =>
  `/api/transit/lines?west=${area.west}&south=${area.south}&east=${area.east}&north=${area.north}`;
const inside = (inner: ReturnType<typeof linesArea>, outer: ReturnType<typeof linesArea>) =>
  inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;

function loadIcon(map: maplibregl.Map, id: string, svg: string) {
  if (map.hasImage(id)) return;
  const image = new Image(40, 40);
  image.onload = () => { if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 }); };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const viewOf = (map: maplibregl.Map) => {
  const bounds = map.getBounds();
  return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
};

/**
 * Ajoute stations, arrêts et lignes à la carte (après le chargement du style). Les lignes sont redemandées quand la vue
 * sort de la zone déjà chargée. Sans la source des tuiles (style de secours, autre fournisseur) : pas de stations, mais
 * les lignes restent. Sans police déclarée : icônes seules, sans noms. Renvoie vrai si les stations sont posées.
 */
export function addTransitLayers(map: maplibregl.Map, showLines: boolean) {
  const named = Boolean(map.getStyle().glyphs);
  const add = (layer: LineLayerSpecification | SymbolLayerSpecification) => {
    if (map.getLayer(layer.id)) return;
    if (layer.type === 'symbol' && !named) {
      if (layer.id === 'transit-lines-label') return;
      delete (layer.layout as Record<string, unknown>)['text-field'];
    }
    map.addLayer(layer);
  };
  let loaded = linesArea(viewOf(map));
  if (!map.getSource(LINES_SOURCE)) map.addSource(LINES_SOURCE, { type: 'geojson', data: linesUrl(loaded) });
  lineLayers(showLines).forEach(add);
  map.on('moveend', () => {
    if (inside(viewOf(map), loaded)) return;
    loaded = linesArea(viewOf(map));
    (map.getSource(LINES_SOURCE) as GeoJSONSource | undefined)?.setData(linesUrl(loaded));
  });

  if (!map.getSource(TILE_SOURCE)) return false;
  // Icône pas encore prête au premier affichage : MapLibre la demande, on la fournit dès qu'elle est décodée.
  map.on('styleimagemissing', event => { const svg = TRANSIT_ICONS[event.id]; if (svg) loadIcon(map, event.id, svg); });
  for (const [id, svg] of Object.entries(TRANSIT_ICONS)) loadIcon(map, id, svg);
  stopLayers().forEach(add);
  return true;
}

/** Montre ou masque les lignes ; renvoie leur état réel (faux si les couches n'existent pas). */
export function setTransitLines(map: maplibregl.Map, showLines: boolean) {
  for (const id of LINE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showLines ? 'visible' : 'none');
  return Boolean(map.getLayer(LINE_LAYERS[1])) && map.getLayoutProperty(LINE_LAYERS[1], 'visibility') === 'visible';
}
