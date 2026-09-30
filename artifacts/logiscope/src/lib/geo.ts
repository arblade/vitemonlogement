import type { HousingListing, HousingPlace, ListingRoute, TravelMode } from '@workspace/api-client-react';

export type LatLng = { lat: number; lng: number };
export type LocatedPlace = HousingPlace & LatLng;

/**
 * Position à montrer sur la carte. Adresse exacte ou rue : un point (radius 0), le seul cas où l'on calcule des trajets.
 * Quartier ou commune : une zone, dessinée en cercle (rayon choisi d'après l'étude : les points « quartier » s'écartent
 * jusqu'à ~900 m du vrai logement, les points « commune » sont posés près du centre-ville).
 */
export type ListingArea = LatLng & { radius: number; precise: boolean };
export const AREA_RADIUS = { district: 600, city: 1500 } as const;

export function listingArea(listing: HousingListing): ListingArea | null {
  if (listing.lat == null || listing.lng == null) return null;
  const at = { lat: listing.lat, lng: listing.lng };
  if (listing.geoPrecision === 'streetNumber' || listing.geoPrecision === 'street') return { ...at, radius: 0, precise: true };
  if (listing.geoPrecision === 'district' || listing.geoPrecision === 'city') return { ...at, radius: AREA_RADIUS[listing.geoPrecision], precise: false };
  return null;
}

export const locatedPlaces = (places: HousingPlace[] = []): LocatedPlace[] =>
  places.filter((place): place is LocatedPlace => place.lat != null && place.lng != null);

/** Distance à vol d'oiseau (haversine), en mètres. */
export function crowDistance(a: LatLng, b: LatLng) {
  const rad = (value: number) => value * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}

export function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: meters < 10_000 ? 1 : 0 })} km`;
}

export const MODE_LABEL: Record<TravelMode, string> = { transit: 'en transports', drive: 'en voiture', bike: 'à vélo', walk: 'à pied' };

/** Cercle géodésique (64 côtés) de `radius` mètres autour de `center`, en GeoJSON [lng, lat]. */
export function circle(center: LatLng, radius: number, sides = 64): [number, number][] {
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.cos(center.lat * Math.PI / 180));
  return Array.from({ length: sides + 1 }, (_, i) => {
    const angle = (i % sides) / sides * 2 * Math.PI;
    return [center.lng + dLng * Math.cos(angle), center.lat + dLat * Math.sin(angle)];
  });
}

export const ROUTE_COLOR = '#ff385c';
const safeColor = (color?: string | null) => color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;

/** Texte lisible (blanc ou encre) sur une pastille de la couleur d'une ligne. */
export function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#222222' : '#ffffff';
}

export type LineBadge = { name: string; color: string; text: string; at: [number, number] };
export type RouteDrawing = {
  /** Tronçons pleins : le trajet (rose) ou chaque ligne de transport (sa couleur). [lng, lat]. */
  solid: { coordinates: [number, number][]; color: string }[];
  /** Pointillés : marche d'un trajet en transports, et raccords logement / lieu ↔ route. [lng, lat]. */
  dotted: [number, number][][];
  lines: LineBadge[];
};

const toLngLat = (path: number[][]) => path.map(([lat, lng]) => [lng, lat] as [number, number]);

/**
 * Comment dessiner un trajet : en transports, la marche en pointillés et chaque ligne dans sa couleur, avec son nom.
 * Le nom de la ligne est posé où l'on monte (au milieu, il cacherait la durée).
 * Sinon un seul tracé. Google part de la route la plus proche : un raccord en pointillés relie le logement et le lieu.
 */
export function routeDrawing(home: LatLng, place: LatLng, route: ListingRoute): RouteDrawing {
  const drawing: RouteDrawing = { solid: [], dotted: [], lines: [] };
  if (route.segments.length) {
    for (const segment of route.segments) {
      if (segment.path.length < 2) continue;
      if (segment.mode !== 'transit') { drawing.dotted.push(toLngLat(segment.path)); continue; }
      const color = safeColor(segment.line?.color) ?? ROUTE_COLOR;
      drawing.solid.push({ coordinates: toLngLat(segment.path), color });
      if (segment.line?.name) drawing.lines.push({ name: segment.line.name, color, text: textOn(color), at: [segment.path[0][1], segment.path[0][0]] });
    }
  } else if (route.path.length > 1) drawing.solid.push({ coordinates: toLngLat(route.path), color: ROUTE_COLOR });
  if (route.path.length > 1) {
    const [startLat, startLng] = route.path[0], [endLat, endLng] = route.path[route.path.length - 1];
    for (const [from, to] of [[home, { lat: startLat, lng: startLng }], [{ lat: endLat, lng: endLng }, place]]) {
      if (crowDistance(from, to) > 15) drawing.dotted.push([[from.lng, from.lat], [to.lng, to.lat]]);
    }
  }
  return drawing;
}
