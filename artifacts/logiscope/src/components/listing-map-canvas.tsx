import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ListingRoute, NearestStop } from '@workspace/api-client-react';
import { circle, formatDuration, routeDrawing, type LatLng, type LocatedPlace } from '@/lib/geo';
import { mapIcon, type MapIconName } from '@/components/map-icons';
import { addTransitLayers, setTransitLines, TRANSIT_ICONS } from '@/components/map-transit';

// OpenFreeMap : tuiles vectorielles OpenStreetMap, gratuites, sans clé ni plafond (usage commercial autorisé).
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

const LOCALE = {
  'NavigationControl.ZoomIn': 'Zoomer',
  'NavigationControl.ZoomOut': 'Dézoomer',
  'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + molette pour zoomer',
  'CooperativeGesturesHandler.MacHelpText': '⌘ + molette pour zoomer',
  'CooperativeGesturesHandler.MobileHelpText': 'Deux doigts pour déplacer la carte',
};

export const placeIcon = (kind: LocatedPlace['kind']): MapIconName => kind === 'work' ? 'briefcase' : kind === 'school' ? 'school' : 'pin';
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const lngLat = ({ lat, lng }: LatLng): [number, number] => [lng, lat];
const line = (coordinates: [number, number][]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } });

function element(html: string, title: string) {
  const node = document.createElement('div');
  node.innerHTML = html;
  node.title = title;
  return node;
}

/** Carte MapLibre impérative : recréée quand les points ou les trajets changent (quelques marqueurs, c'est instantané). */
export default function ListingMapCanvas({ home, radius = 0, places, routes, stop = null, busStop = null, showLines = false }: {
  home: LatLng;
  /** 0 : position exacte (point) ; sinon rayon en mètres de la zone où se trouve le logement. */
  radius?: number;
  places: LocatedPlace[];
  routes: ListingRoute[];
  /** Station de métro ou de tram la plus proche : repérée sur la carte. */
  stop?: NearestStop | null;
  /** Arrêt de bus le plus proche : repéré aussi. */
  busStop?: NearestStop | null;
  /** Lignes de tram et de métro affichées (couleurs officielles). */
  showLines?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const linesRef = useRef(showLines);
  linesRef.current = showLines;
  const [failed, setFailed] = useState(false);
  const [linesShown, setLinesShown] = useState(false);
  const [drawn, setDrawn] = useState<{ routes: number; crow: number; area: boolean; parts: number; dotted: number; transit: boolean } | null>(null);

  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current, style: MAP_STYLE, center: lngLat(home), zoom: 15,
        attributionControl: { compact: true }, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false,
        locale: LOCALE, fadeDuration: 0,
      });
    } catch {
      setFailed(true); // pas de WebGL (vieux téléphone) : la liste des lieux reste affichée
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const withRoute = places.map(place => ({ place, route: routes.find(item => item.placeId === place.id && item.path.length > 1) }));
    const drawings = withRoute.flatMap(({ place, route }) => route ? [routeDrawing(home, place, route)] : []);
    for (const { place } of withRoute) {
      const html = `<div class="vml-pin vml-pin-place" data-testid="map-marker-${escape(place.id)}"><span class="vml-pin-dot">${mapIcon(placeIcon(place.kind), 14)}</span><span>${escape(place.label)}</span></div>`;
      new maplibregl.Marker({ element: element(html, place.resolved || place.address) }).setLngLat(lngLat(place)).addTo(map);
    }
    for (const { route } of withRoute) {
      if (!route) continue;
      const [lat, lng] = route.path[Math.floor(route.path.length / 2)];
      const html = `<div class="vml-badge" data-testid="map-duration-${escape(route.placeId)}">${mapIcon(route.mode, 13)}<span>${formatDuration(route.durationSeconds)}</span></div>`;
      new maplibregl.Marker({ element: element(html, 'Durée du trajet') }).setLngLat([lng, lat]).addTo(map);
    }
    for (const badge of drawings.flatMap(drawing => drawing.lines)) {
      const html = `<div class="vml-line" style="background:${badge.color};color:${badge.text}">${escape(badge.name)}</div>`;
      new maplibregl.Marker({ element: element(html, `Ligne ${badge.name}`) }).setLngLat(badge.at).addTo(map);
    }
    for (const [item, icon, testId, title] of [
      [stop, stop?.lines.some(line => line.mode === 'metro') ? 'vml-metro' : 'vml-tram', 'map-marker-stop', 'Station la plus proche'],
      [busStop, 'vml-bus', 'map-marker-bus', 'Arrêt de bus le plus proche'],
    ] as const) {
      if (!item) continue;
      const html = `<div class="vml-stop" data-testid="${testId}"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(TRANSIT_ICONS[icon])}" alt="" width="22" height="22"/><span>${escape(item.name)}</span></div>`;
      new maplibregl.Marker({ element: element(html, `${title} : ${item.name}`) }).setLngLat(lngLat(item)).addTo(map);
    }
    const homeHtml = `<div class="vml-pin vml-pin-home${radius ? ' vml-pin-area' : ''}" data-testid="map-marker-home">${mapIcon('house', 16)}</div>`;
    new maplibregl.Marker({ element: element(homeHtml, 'Le logement') }).setLngLat(lngLat(home)).addTo(map);

    const zone = radius ? circle(home, radius) : [];
    const bounds = new maplibregl.LngLatBounds(lngLat(home), lngLat(home));
    zone.forEach(point => bounds.extend(point));
    if (stop) bounds.extend(lngLat(stop));
    if (busStop) bounds.extend(lngLat(busStop));
    for (const { place, route } of withRoute) {
      bounds.extend(lngLat(place));
      route?.path.forEach(([lat, lng]) => bounds.extend([lng, lat]));
    }
    const frame = () => {
      map.resize();
      if (places.length || radius || stop) map.fitBounds(bounds, { padding: { top: 84, left: 56, right: 72, bottom: 64 }, maxZoom: 16, duration: 0 });
      else map.jumpTo({ center: lngLat(home), zoom: 15 });
    };
    frame();

    map.on('load', () => {
      // Crédit OpenStreetMap replié en « i » (déplié, il masquerait les marqueurs sur mobile).
      container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      // Stations et arrêts en gris sur le fond, voies de tram et de métro à la demande : sous les trajets.
      const transit = addTransitLayers(map, linesRef.current);
      setLinesShown(transit && linesRef.current);
      const routeLines = drawings.flatMap(drawing => drawing.solid.map(part => ({ ...line(part.coordinates), properties: { color: part.color } })));
      const dotted = drawings.flatMap(drawing => drawing.dotted.map(line));
      // Ligne droite seulement depuis une position exacte : depuis une zone, elle ferait croire à un trajet connu.
      const crowLines = radius ? [] : withRoute.flatMap(({ place, route }) => route ? [] : [line([lngLat(home), lngLat(place)])]);
      if (zone.length) {
        map.addSource('area', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [zone] } } });
        map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#ff385c', 'fill-opacity': .12 } });
        map.addLayer({ id: 'area-edge', type: 'line', source: 'area', paint: { 'line-color': '#ff385c', 'line-width': 2, 'line-opacity': .7 } });
      }
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: routeLines } });
      map.addSource('crow', { type: 'geojson', data: { type: 'FeatureCollection', features: crowLines } });
      map.addSource('walks', { type: 'geojson', data: { type: 'FeatureCollection', features: dotted } });
      // Marche et raccords : points ronds serrés, sous les lignes de transport.
      map.addLayer({ id: 'walk-line', type: 'line', source: 'walks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#222222', 'line-opacity': .7, 'line-width': 3.5, 'line-dasharray': [0, 2] } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5 } });
      map.addLayer({ id: 'crow-line', type: 'line', source: 'crow', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#222222', 'line-opacity': .5, 'line-width': 2, 'line-dasharray': [1, 3] } });
      setDrawn({ routes: drawings.length, crow: crowLines.length, area: zone.length > 0, parts: routeLines.length, dotted: dotted.length, transit });
    });
    mapRef.current = map;
    map.on('error', () => undefined); // tuiles injoignables : la carte reste utilisable avec ses marqueurs

    // La fiche s'ouvre avec une animation : on recadre une fois sa taille définitive connue.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => frame());
    observer?.observe(container.current);
    return () => { observer?.disconnect(); mapRef.current = null; map.remove(); };
  }, [home.lat, home.lng, radius, places, routes, stop?.name, stop?.lat, stop?.lng, busStop?.name, busStop?.lat, busStop?.lng]);

  // Afficher ou masquer les lignes sans recréer la carte.
  useEffect(() => { if (mapRef.current) setLinesShown(setTransitLines(mapRef.current, showLines)); }, [showLines]);

  if (failed) return <div className="grid h-full place-items-center px-6 text-center text-xs text-stone">La carte ne peut pas s’afficher sur cet appareil.</div>;
  // data-* : trajets, tronçons pleins, pointillés et lignes droites réellement tracés (utilisé par les tests navigateur).
  return <div ref={container} data-testid="listing-map-canvas" data-routes={drawn?.routes} data-crow={drawn?.crow} data-area={drawn?.area} data-parts={drawn?.parts} data-dotted={drawn?.dotted} data-transit={drawn?.transit} data-lines={linesShown}
    className="h-full w-full" role="region" aria-label={radius ? 'Carte : zone du logement et vos lieux' : 'Carte : position du logement et de vos lieux'}/>;
}
