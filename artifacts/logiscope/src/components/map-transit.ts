import type maplibregl from 'maplibre-gl';
import type { LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';

// Transports en commun sur le fond de carte, lus dans les tuiles OpenFreeMap déjà chargées (schéma OpenMapTiles) :
// aucune requête ni clé en plus. Couche « poi » : stations (classe railway, sous-classes subway, tram_stop, station,
// halt) et arrêts de bus (classe bus). Couche « transportation » : voies de métro et de tram (classe transit).
export const TILE_SOURCE = 'openmaptiles';
export const METRO_COLOR = '#3056d3';
export const TRAM_COLOR = '#8e44ad';
export const LINE_LAYERS = ['transit-lines-tunnel', 'transit-lines'] as const;
/** Les tuiles n'ont les voies de métro et de tram (et les arrêts de tram) qu'à partir du zoom 14. */
export const LINES_MIN_ZOOM = 14;

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

const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const transitTracks = ['all', isLine, ['==', ['get', 'class'], 'transit'], ['match', ['get', 'subclass'], ['subway', 'tram', 'light_rail'], true, false]];
const lineColor = ['match', ['get', 'subclass'], 'subway', METRO_COLOR, TRAM_COLOR];
const lineWidth = ['interpolate', ['linear'], ['zoom'], 14, 2.5, 17, 5];

/**
 * Couches à ajouter au style : voies de métro et de tram (masquées tant qu'on ne les demande pas ; en tunnel, en
 * tirets), puis arrêts de bus (à partir du zoom 15, sans nom) et stations (métro, tram, gare ; nom au zoom 15).
 */
export function transitLayers(showLines: boolean): (LineLayerSpecification | SymbolLayerSpecification)[] {
  const visibility = showLines ? 'visible' : 'none';
  return [
    { id: 'transit-lines-tunnel', type: 'line', source: TILE_SOURCE, 'source-layer': 'transportation', minzoom: LINES_MIN_ZOOM,
      filter: ['all', transitTracks, ['==', ['get', 'brunnel'], 'tunnel']] as never,
      layout: { visibility, 'line-cap': 'butt' }, paint: { 'line-color': lineColor as never, 'line-width': lineWidth as never, 'line-opacity': .75, 'line-dasharray': [2, 1.2] } },
    { id: 'transit-lines', type: 'line', source: TILE_SOURCE, 'source-layer': 'transportation', minzoom: LINES_MIN_ZOOM,
      filter: ['all', transitTracks, ['!=', ['get', 'brunnel'], 'tunnel']] as never,
      layout: { visibility, 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': lineColor as never, 'line-width': lineWidth as never } },
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

function loadIcon(map: maplibregl.Map, id: string, svg: string) {
  if (map.hasImage(id)) return;
  const image = new Image(40, 40);
  image.onload = () => { if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 }); };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Ajoute stations et voies au fond de carte (après son chargement). Sans la source des tuiles (style de secours des
 * tests, fournisseur changé), ne fait rien : la carte reste utilisable. Renvoie vrai si les couches sont posées.
 */
export function addTransitLayers(map: maplibregl.Map, showLines: boolean) {
  if (!map.getSource(TILE_SOURCE)) return false;
  // Icône pas encore prête au premier affichage : MapLibre la demande, on la fournit dès qu'elle est décodée.
  map.on('styleimagemissing', event => { const svg = TRANSIT_ICONS[event.id]; if (svg) loadIcon(map, event.id, svg); });
  for (const [id, svg] of Object.entries(TRANSIT_ICONS)) loadIcon(map, id, svg);
  // Sans police déclarée par le style, un nom de station serait refusé : icônes seules.
  const named = Boolean(map.getStyle().glyphs);
  for (const layer of transitLayers(showLines)) {
    if (map.getLayer(layer.id)) continue;
    if (!named && layer.type === 'symbol') delete (layer.layout as Record<string, unknown>)['text-field'];
    map.addLayer(layer);
  }
  return true;
}

/** Montre ou masque les voies ; renvoie leur état réel (faux si les couches n'existent pas). */
export function setTransitLines(map: maplibregl.Map, showLines: boolean) {
  for (const id of LINE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showLines ? 'visible' : 'none');
  return Boolean(map.getLayer(LINE_LAYERS[1])) && map.getLayoutProperty(LINE_LAYERS[1], 'visibility') === 'visible';
}
