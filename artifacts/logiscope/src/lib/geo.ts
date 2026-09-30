import type { HousingListing, HousingPlace, TravelMode } from '@workspace/api-client-react';

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
