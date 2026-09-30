import { lazy, Suspense, useMemo } from 'react';
import { Briefcase, GraduationCap, MapPin, Navigation } from 'lucide-react';
import { getGetListingRoutesQueryKey, useGetListingRoutes, type HousingListing, type HousingPlace, type ListingRoute } from '@workspace/api-client-react';
import { crowDistance, formatDistance, formatDuration, listingArea, locatedPlaces, MODE_LABEL } from '@/lib/geo';

// Leaflet (≈ 40 ko) n'est chargé qu'à l'ouverture d'une fiche qui a une adresse précise.
const ListingMapCanvas = lazy(() => import('@/components/listing-map-canvas'));

const NO_ROUTES: ListingRoute[] = [];
const PlaceIcon = ({ kind }: { kind: HousingPlace['kind'] }) => {
  const Icon = kind === 'work' ? Briefcase : kind === 'school' ? GraduationCap : MapPin;
  return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ffe3e8] text-brand"><Icon size={16} aria-hidden="true"/></span>;
};

const PRECISION_TEXT = {
  streetNumber: 'Adresse exacte indiquée par l’annonce.',
  street: 'Rue indiquée par l’annonce : le point est placé dans la rue, pas au numéro.',
  district: 'Quartier seulement : le logement se trouve quelque part dans le cercle.',
  city: 'Commune seulement : le logement se trouve quelque part dans le cercle, parfois plus loin.',
} as const;

/**
 * Encart « Localisation » de la fiche. Adresse exacte ou rue : un point, et les trajets vers vos lieux (si le serveur a
 * une clé d'itinéraire). Quartier ou commune : un cercle et vos lieux, sans trajet ni distance (ils seraient faux).
 */
export function ListingMap({ listing, searchId, places = [], routingAvailable = false }: {
  listing: HousingListing;
  searchId?: number;
  places?: HousingPlace[];
  routingAvailable?: boolean;
}) {
  const area = listingArea(listing);
  const home = area ? { lat: area.lat, lng: area.lng } : null;
  const located = useMemo(() => locatedPlaces(places), [places]);
  const wantRoutes = Boolean(area?.precise && searchId && routingAvailable && located.length);
  const routesQuery = useGetListingRoutes(searchId ?? 0, listing.id, {
    query: { queryKey: getGetListingRoutesQueryKey(searchId ?? 0, listing.id), enabled: wantRoutes, staleTime: Infinity, retry: false },
  });
  const routes = routesQuery.data?.routes ?? NO_ROUTES;
  if (!area || !home) return null;
  return <section aria-labelledby={`map-${listing.id}`} data-testid={`listing-map-${listing.id}`} className="border-b border-line-soft py-7">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 id={`map-${listing.id}`} className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.02em]"><MapPin size={18} className="text-brand" aria-hidden="true"/>Où se trouve le logement</h2>
        <p data-testid={`map-precision-${listing.id}`} className="mt-1 text-xs text-stone">{PRECISION_TEXT[listing.geoPrecision as keyof typeof PRECISION_TEXT]}</p>
      </div>
    </div>
    <div className="isolate h-[260px] overflow-hidden rounded-2xl border border-line bg-sage md:h-[340px]">
      <Suspense fallback={<div className="grid h-full place-items-center text-xs text-stone">Chargement de la carte…</div>}>
        <ListingMapCanvas home={home} radius={area.radius} places={located} routes={routes}/>
      </Suspense>
    </div>
    {places.length > 0 && <ul className="mt-3 divide-y divide-line-soft rounded-2xl border border-line bg-[#ffffff]" aria-label="Vos lieux">
      {places.map(place => {
        const route = routes.find(item => item.placeId === place.id);
        const hasPoint = place.lat != null && place.lng != null;
        return <li key={place.id} data-testid={`map-place-${place.id}`} className="flex items-center gap-3 px-4 py-3">
          <PlaceIcon kind={place.kind}/>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold leading-tight">{place.label}</p>
            <p className="truncate text-xs text-stone">{hasPoint ? place.resolved || place.address : `${place.address} · adresse introuvable`}</p>
          </div>
          <div className="shrink-0 text-right text-xs" data-testid={`map-travel-${place.id}`}>
            {route ? <><strong className="block text-[15px] text-ink">{formatDuration(route.durationSeconds)}</strong><span className="text-stone">{MODE_LABEL[route.mode]} · {formatDistance(route.distanceMeters)}</span></>
              : hasPoint && wantRoutes && routesQuery.isLoading ? <span className="inline-flex items-center gap-1 text-stone"><Navigation size={12} className="animate-pulse" aria-hidden="true"/>Calcul du trajet…</span>
              : hasPoint && area.precise ? <span className="text-stone">{formatDistance(crowDistance(home, { lat: place.lat!, lng: place.lng! }))}<span className="block">à vol d’oiseau</span></span>
              : null}
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
