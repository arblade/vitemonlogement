import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HousingListing, HousingPlace, ListingRoute } from '@workspace/api-client-react';
import { ListingMap } from '@/components/listing-map';
import { crowDistance, formatDistance, formatDuration, listingPoint, locatedPlaces } from '@/lib/geo';
import { listing, mockFetch } from '@/test/fixtures';

// jsdom n'a pas de WebGL : la carte MapLibre est remplacée par un témoin des données reçues (le vrai rendu est vérifié en e2e).
vi.mock('@/components/listing-map-canvas', () => ({
  default: ({ price, places, routes }: { price: string; places: HousingPlace[]; routes: ListingRoute[] }) =>
    <div data-testid="canvas" data-price={price} data-places={places.map(place => place.id).join(',')} data-routes={routes.map(route => route.placeId).join(',')}/>,
}));

const home = { lat: 50.6408, lng: 3.0611 };
const precise = (overrides: Partial<HousingListing> = {}) => listing(1, { price: 650, ...home, geoPrecision: 'streetNumber', ...overrides });
const work: HousingPlace = { id: 'place-1', label: 'Travail', kind: 'work', address: 'gare Lille Flandres', mode: 'bike', lat: 50.6366, lng: 3.0706, resolved: 'Gare Lille Flandres, Lille' };
const lost: HousingPlace = { id: 'place-2', label: 'École', kind: 'school', address: '12 rue Inconnue', mode: 'walk', lat: null, lng: null, resolved: null };
const route: ListingRoute = { placeId: 'place-1', mode: 'bike', durationSeconds: 1080, distanceMeters: 1400, path: [[50.64, 3.06], [50.63, 3.07]] };

function renderMap(props: Partial<Parameters<typeof ListingMap>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ListingMap listing={precise()} searchId={7} places={[work]} {...props}/></QueryClientProvider>);
}

describe('geo : utilitaires', () => {
  it('listingPoint : seules l’adresse exacte et la rue donnent un point', () => {
    expect(listingPoint(precise())).toEqual(home);
    expect(listingPoint(precise({ geoPrecision: 'street' }))).toEqual(home);
    expect(listingPoint(precise({ geoPrecision: 'district' }))).toBeNull();
    expect(listingPoint(precise({ geoPrecision: 'city' }))).toBeNull();
    expect(listingPoint(precise({ geoPrecision: null }))).toBeNull();
    expect(listingPoint(listing(2))).toBeNull();
  });

  it('durées, distances et vol d’oiseau en français', () => {
    expect(formatDuration(1080)).toBe('18 min');
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(3900)).toBe('1 h 05');
    expect(formatDistance(843)).toBe('840 m');
    expect(formatDistance(1400)).toBe('1,4 km');
    expect(formatDistance(23_400)).toBe('23 km');
    expect(Math.round(crowDistance(home, { lat: 50.6366, lng: 3.0706 }))).toBeGreaterThan(750);
    expect(Math.round(crowDistance(home, { lat: 50.6366, lng: 3.0706 }))).toBeLessThan(850);
    expect(locatedPlaces([work, lost])).toEqual([work]);
  });
});

describe('Encart « Où se trouve le logement »', () => {
  it('annonce localisée au quartier ou à la commune : aucun encart', () => {
    mockFetch([]);
    renderMap({ listing: precise({ geoPrecision: 'district' }) });
    expect(screen.queryByText('Où se trouve le logement')).not.toBeInTheDocument();
  });

  it('adresse exacte : carte avec le prix, sans lieu cité ni appel de trajet', async () => {
    const calls = mockFetch([]);
    renderMap({ places: [], routingAvailable: true });
    expect(screen.getByText('Adresse exacte indiquée par l’annonce.')).toBeInTheDocument();
    expect(await screen.findByTestId('canvas')).toHaveAttribute('data-price', '650 €');
    expect(screen.queryByRole('list', { name: 'Vos lieux' })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('rue seulement : l’encart le dit (le point est dans la rue, pas au numéro)', () => {
    mockFetch([]);
    renderMap({ listing: precise({ geoPrecision: 'street' }) });
    expect(screen.getByTestId('map-precision-1')).toHaveTextContent(/Rue indiquée/);
  });

  it('sans clé de trajet : aucun appel, aucune durée, seulement la distance à vol d’oiseau', async () => {
    const calls = mockFetch([]);
    renderMap({ routingAvailable: false, places: [work, lost] });
    expect(await screen.findByTestId('canvas')).toHaveAttribute('data-places', 'place-1');
    expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('820 mà vol d’oiseau');
    expect(screen.getByTestId('map-travel-place-1')).not.toHaveTextContent(/min/);
    expect(screen.getByTestId('map-place-place-2')).toHaveTextContent('12 rue Inconnue · adresse introuvable');
    expect(calls).toHaveLength(0);
  });

  it('avec clé : le trajet est demandé une fois, puis durée, mode et distance s’affichent et vont sur la carte', async () => {
    const calls = mockFetch([{ match: /\/api\/housing\/searches\/7\/listings\/1\/routes$/, respond: () => ({ body: { routes: [route] } }) }]);
    renderMap({ routingAvailable: true });
    expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('Calcul du trajet…');
    await waitFor(() => expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('18 minà vélo · 1,4 km'));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-routes', 'place-1');
    expect(screen.getByTestId('map-place-place-1')).toHaveTextContent('Gare Lille Flandres, Lille');
    expect(calls.filter(call => call.url.includes('/routes'))).toHaveLength(1);
  });

  it('avec clé mais échec du calcul : pas de message d’erreur, repli sur le vol d’oiseau', async () => {
    mockFetch([{ match: /\/routes$/, respond: () => ({ status: 503, body: { error: 'x' } }) }]);
    renderMap({ routingAvailable: true });
    await waitFor(() => expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('à vol d’oiseau'));
    expect(screen.getByTestId('map-travel-place-1')).not.toHaveTextContent(/min|erreur/i);
  });

  it('sans identifiant de recherche (ex. page Favoris) : carte seule, jamais d’appel de trajet', async () => {
    const calls = mockFetch([]);
    renderMap({ searchId: undefined, routingAvailable: true });
    expect(await screen.findByTestId('canvas')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
