import type { HousingListing, HousingPlace, TravelMode } from '@workspace/api-client-react';

export type LatLng = { lat: number; lng: number };
export type LocatedPlace = HousingPlace & LatLng;

/** Seules l'adresse exacte et la rue sont placées sur la carte : un quartier ou une commune n'est pas une position. */
export function listingPoint(listing: HousingListing): LatLng | null {
  const precise = listing.geoPrecision === 'streetNumber' || listing.geoPrecision === 'street';
  return precise && listing.lat != null && listing.lng != null ? { lat: listing.lat, lng: listing.lng } : null;
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
