import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ListingRoute } from '@workspace/api-client-react';
import { formatDuration, type LatLng, type LocatedPlace } from '@/lib/geo';
import { mapIcon, type MapIconName } from '@/components/map-icons';

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
export default function ListingMapCanvas({ home, price, places, routes }: {
  home: LatLng;
  price: string;
  places: LocatedPlace[];
  routes: ListingRoute[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [drawn, setDrawn] = useState<{ routes: number; crow: number } | null>(null);

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
    const homeHtml = `<div class="vml-pin vml-pin-home" data-testid="map-marker-home">${mapIcon('house', 15)}<span>${escape(price)}</span></div>`;
    new maplibregl.Marker({ element: element(homeHtml, 'Le logement') }).setLngLat(lngLat(home)).addTo(map);

    const bounds = new maplibregl.LngLatBounds(lngLat(home), lngLat(home));
    for (const { place, route } of withRoute) {
      bounds.extend(lngLat(place));
      route?.path.forEach(([lat, lng]) => bounds.extend([lng, lat]));
    }
    const frame = () => {
      map.resize();
      if (places.length) map.fitBounds(bounds, { padding: { top: 84, left: 56, right: 72, bottom: 64 }, maxZoom: 16, duration: 0 });
      else map.jumpTo({ center: lngLat(home), zoom: 15 });
    };
    frame();

    map.on('load', () => {
      // Crédit OpenStreetMap replié en « i » (déplié, il masquerait les marqueurs sur mobile).
      container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      const routeLines = withRoute.flatMap(({ route }) => route ? [line(route.path.map(([lat, lng]) => [lng, lat]))] : []);
      const crowLines = withRoute.flatMap(({ place, route }) => route ? [] : [line([lngLat(home), lngLat(place)])]);
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: routeLines } });
      map.addSource('crow', { type: 'geojson', data: { type: 'FeatureCollection', features: crowLines } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff385c', 'line-width': 5 } });
      map.addLayer({ id: 'crow-line', type: 'line', source: 'crow', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#222222', 'line-opacity': .5, 'line-width': 2, 'line-dasharray': [1, 3] } });
      setDrawn({ routes: routeLines.length, crow: crowLines.length });
    });
    map.on('error', () => undefined); // tuiles injoignables : la carte reste utilisable avec ses marqueurs

    // La fiche s'ouvre avec une animation : on recadre une fois sa taille définitive connue.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => frame());
    observer?.observe(container.current);
    return () => { observer?.disconnect(); map.remove(); };
  }, [home.lat, home.lng, price, places, routes]);

  if (failed) return <div className="grid h-full place-items-center px-6 text-center text-xs text-stone">La carte ne peut pas s’afficher sur cet appareil.</div>;
  // data-routes / data-crow : trajets et lignes droites réellement tracés (utilisé par les tests navigateur).
  return <div ref={container} data-testid="listing-map-canvas" data-routes={drawn?.routes} data-crow={drawn?.crow}
    className="h-full w-full" role="region" aria-label="Carte : position du logement et de vos lieux"/>;
}
