import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { formatPrice } from '@/components/site-shell';
import { MAP_STYLE, placeIcon } from '@/components/listing-map-canvas';
import { mapIcon } from '@/components/map-icons';
import type { LatLng, LocatedPlace, MappedListing } from '@/lib/geo';

const LOCALE = {
  'NavigationControl.ZoomIn': 'Zoomer',
  'NavigationControl.ZoomOut': 'Dézoomer',
};
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const lngLat = ({ lat, lng }: LatLng): [number, number] => [lng, lat];

/**
 * Carte de tous les logements à position précise : une pastille de prix par logement (un bouton : clavier et lecteur
 * d'écran compris), les lieux de vie de la demande en repères. Recréée quand les données changent.
 */
export default function ResultsMapCanvas({ items, places, viewed, onPick }: {
  items: MappedListing[];
  places: LocatedPlace[];
  viewed: ReadonlySet<number>;
  onPick: (id: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current || !items.length) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current, style: MAP_STYLE, center: lngLat(items[0]), zoom: 14,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, locale: LOCALE, fadeDuration: 0,
      });
    } catch {
      setFailed(true);
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    for (const place of places) {
      const node = document.createElement('div');
      node.title = place.resolved || place.address;
      node.innerHTML = `<div class="vml-pin vml-pin-place" data-testid="results-place-${escape(place.id)}"><span class="vml-pin-dot">${mapIcon(placeIcon(place.kind), 14)}</span><span>${escape(place.label)}</span></div>`;
      new maplibregl.Marker({ element: node }).setLngLat(lngLat(place)).addTo(map);
    }
    items.forEach(({ listing, lat, lng }, index) => {
      const price = listing.price == null ? '—' : formatPrice(listing.price);
      const node = document.createElement('div');
      node.innerHTML = `<button type="button" class="vml-price" data-viewed="${viewed.has(listing.id)}" data-testid="results-marker-${listing.id}" aria-label="${escape(`${price} : ${listing.title}. Ouvrir la fiche.`)}">${escape(price)}</button>`;
      node.querySelector('button')!.addEventListener('click', () => pick.current(listing.id));
      node.style.zIndex = String(items.length - index);
      new maplibregl.Marker({ element: node }).setLngLat([lng, lat]).addTo(map);
    });

    const bounds = new maplibregl.LngLatBounds(lngLat(items[0]), lngLat(items[0]));
    [...items, ...places].forEach(point => bounds.extend(lngLat(point)));
    const frame = () => {
      map.resize();
      if (items.length + places.length > 1) map.fitBounds(bounds, { padding: { top: 70, left: 60, right: 70, bottom: 60 }, maxZoom: 16, duration: 0 });
      else map.jumpTo({ center: lngLat(items[0]), zoom: 15 });
    };
    frame();
    map.on('load', () => container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
    map.on('error', () => undefined); // tuiles injoignables : les pastilles restent utilisables

    // La fenêtre s'ouvre avec une animation : on recadre une fois sa taille définitive connue.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => frame());
    observer?.observe(container.current);
    return () => { observer?.disconnect(); map.remove(); };
  }, [items, places, viewed]);

  if (failed) return <div className="grid h-full place-items-center px-6 text-center text-xs text-stone">La carte ne peut pas s’afficher sur cet appareil.</div>;
  return <div ref={container} data-testid="results-map-canvas" data-listings={items.length} className="h-full w-full" role="region" aria-label="Carte des logements"/>;
}
