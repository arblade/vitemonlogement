import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HousingListing, HousingPlace, ListingRoute } from '@workspace/api-client-react';
import { ListingMap } from '@/components/listing-map';
import { AREA_RADIUS, circle, crowDistance, formatDistance, formatDuration, listingArea, locatedPlaces, mappedListings, ROUTE_COLOR, routeDrawing, textOn, type LatLng } from '@/lib/geo';
import { listing, mockFetch } from '@/test/fixtures';

// jsdom n'a pas de WebGL : la carte MapLibre est remplacée par un témoin des données reçues (le vrai rendu est vérifié en e2e).
vi.mock('@/components/listing-map-canvas', () => ({
  default: ({ radius, places, routes }: { radius: number; places: HousingPlace[]; routes: ListingRoute[] }) =>
    <div data-testid="canvas" data-radius={radius} data-places={places.map(place => place.id).join(',')} data-routes={routes.map(route => route.placeId).join(',')}/>,
}));

const home = { lat: 50.6408, lng: 3.0611 };
const precise = (overrides: Partial<HousingListing> = {}) => listing(1, { price: 650, ...home, geoPrecision: 'streetNumber', ...overrides });
const work: HousingPlace = { id: 'place-1', label: 'Travail', kind: 'work', address: 'gare Lille Flandres', lat: 50.6366, lng: 3.0706, resolved: 'Gare Lille Flandres, Lille' };
const lost: HousingPlace = { id: 'place-2', label: 'École', kind: 'school', address: '12 rue Inconnue', lat: null, lng: null, resolved: null };
const route: ListingRoute = { placeId: 'place-1', mode: 'bike', recommended: true, durationSeconds: 1080, distanceMeters: 1400, path: [[50.64, 3.06], [50.63, 3.07]], segments: [] };

function renderMap(props: Partial<Parameters<typeof ListingMap>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ListingMap listing={precise()} searchId={7} places={[work]} {...props}/></QueryClientProvider>);
}

describe('geo : utilitaires', () => {
  it('listingArea : adresse exacte et rue = point précis ; quartier et commune = zone (cercle) ; sinon rien', () => {
    expect(listingArea(precise())).toEqual({ ...home, radius: 0, precise: true });
    expect(listingArea(precise({ geoPrecision: 'street' }))).toEqual({ ...home, radius: 0, precise: true });
    expect(listingArea(precise({ geoPrecision: 'district' }))).toEqual({ ...home, radius: AREA_RADIUS.district, precise: false });
    expect(listingArea(precise({ geoPrecision: 'city' }))).toEqual({ ...home, radius: AREA_RADIUS.city, precise: false });
    expect(AREA_RADIUS.city).toBeGreaterThan(AREA_RADIUS.district);
    expect(listingArea(precise({ geoPrecision: null }))).toBeNull();
    expect(listingArea(listing(2))).toBeNull();
  });

  it('mappedListings : seuls l’adresse exacte et la rue sont placés, avec leur position, dans l’ordre de la liste', () => {
    const all = [
      precise({ id: 1 }), precise({ id: 2, geoPrecision: 'district' }), precise({ id: 3, geoPrecision: 'street', lat: 50.1, lng: 3.2 }),
      precise({ id: 4, geoPrecision: 'city' }), listing(5), precise({ id: 6, geoPrecision: null }), precise({ id: 7, lat: null, lng: null }),
    ];
    expect(mappedListings(all).map(item => [item.listing.id, item.lat, item.lng])).toEqual([[1, home.lat, home.lng], [3, 50.1, 3.2]]);
    expect(mappedListings([])).toEqual([]);
  });

  it('circle : polygone fermé dont chaque sommet est à la bonne distance du centre', () => {
    const ring = circle(home, 600);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
    for (const [lng, lat] of ring) expect(Math.abs(crowDistance(home, { lat, lng }) - 600)).toBeLessThan(6);
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

const metro = { mode: 'transit' as const, path: [[50.639, 3.063], [50.637, 3.068]], line: { name: 'M1', color: '#FFCC00', vehicle: 'SUBWAY' } };
const transitRoute: ListingRoute = {
  ...route, mode: 'transit', path: [[50.6405, 3.0615], [50.639, 3.063], [50.637, 3.068], [50.6366, 3.0706]],
  segments: [
    { mode: 'walk', path: [[50.6405, 3.0615], [50.639, 3.063]], line: null },
    metro,
    { mode: 'transit', path: [[50.637, 3.068], [50.6368, 3.07]], line: { name: 'Liane 5', color: 'red', vehicle: 'BUS' } },
    { mode: 'walk', path: [[50.6368, 3.07], [50.6366, 3.0706]], line: null },
  ],
};

describe('geo : dessin des trajets', () => {
  it('vélo, voiture, marche : un seul tracé rose ; raccords en pointillés seulement si la route part loin du point', () => {
    const drawing = routeDrawing(home, work as LatLng, route);
    expect(drawing.solid).toEqual([{ coordinates: [[3.06, 50.64], [3.07, 50.63]], color: ROUTE_COLOR }]);
    expect(drawing.lines).toEqual([]);
    expect(drawing.dotted).toEqual([[[home.lng, home.lat], [3.06, 50.64]], [[3.07, 50.63], [work.lng, work.lat]]]);
    const exact = routeDrawing({ lat: 50.64, lng: 3.06 }, { lat: 50.63, lng: 3.07 }, route);
    expect(exact.dotted).toEqual([]);
  });

  it('transports : marche en pointillés, chaque ligne dans sa couleur (couleur invalide → rose), nom là où l’on monte', () => {
    const drawing = routeDrawing({ lat: 50.6405, lng: 3.0615 }, work as LatLng, transitRoute);
    expect(drawing.solid.map(part => part.color)).toEqual(['#ffcc00', ROUTE_COLOR]);
    expect(drawing.dotted).toHaveLength(2);
    expect(drawing.lines).toEqual([
      { name: 'M1', color: '#ffcc00', text: '#222222', at: [3.063, 50.639] },
      { name: 'Liane 5', color: ROUTE_COLOR, text: '#ffffff', at: [3.068, 50.637] },
    ]);
  });

  it('textOn : encre sur fond clair, blanc sur fond foncé', () => {
    expect(textOn('#ffcc00')).toBe('#222222');
    expect(textOn('#003f87')).toBe('#ffffff');
  });
});

describe('Encart « Où se trouve le logement »', () => {
  it('annonce sans coordonnées : aucun encart', () => {
    mockFetch([]);
    renderMap({ listing: listing(2) });
    expect(screen.queryByText('Où se trouve le logement')).not.toBeInTheDocument();
  });

  it('quartier ou commune : cercle et lieux sur la carte, mais ni trajet, ni appel, ni distance', async () => {
    for (const geoPrecision of ['district', 'city'] as const) {
      const calls = mockFetch([{ match: /\/routes$/, respond: () => ({ body: { routes: [route] } }) }]);
      const { unmount } = renderMap({ listing: precise({ geoPrecision }), routingAvailable: true });
      expect(screen.getByTestId('map-precision-1')).toHaveTextContent(geoPrecision === 'district' ? /Quartier seulement/ : /Commune seulement/);
      const canvas = await screen.findByTestId('canvas');
      expect(canvas).toHaveAttribute('data-radius', String(AREA_RADIUS[geoPrecision]));
      expect(canvas).toHaveAttribute('data-places', 'place-1');
      expect(canvas).toHaveAttribute('data-routes', '');
      expect(screen.getByTestId('map-place-place-1')).toHaveTextContent('Gare Lille Flandres, Lille');
      expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('');
      expect(calls).toHaveLength(0);
      unmount();
    }
  });

  it('adresse exacte : un point (sans prix), sans lieu cité ni appel de trajet', async () => {
    const calls = mockFetch([]);
    renderMap({ places: [], routingAvailable: true });
    expect(screen.getByText('Adresse exacte indiquée par l’annonce.')).toBeInTheDocument();
    expect(await screen.findByTestId('canvas')).toHaveAttribute('data-radius', '0');
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

  it('un seul trajet par lieu (ex. à pied ≤ 20 min) : il s’affiche, sans aucun sélecteur', async () => {
    for (const [mode, label] of [['walk', 'à pied'], ['bike', 'à vélo'], ['transit', 'en transports'], ['drive', 'en voiture']] as const) {
      mockFetch([{ match: /\/routes$/, respond: () => ({ body: { routes: [{ ...route, mode }] } }) }]);
      const { unmount } = renderMap({ routingAvailable: true });
      await waitFor(() => expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent(`18 min${label} · 1,4 km`));
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      unmount();
    }
  });

  const school: HousingPlace = { id: 'place-3', label: 'École', kind: 'school', address: 'école', lat: 50.63, lng: 3.05, resolved: 'École Pasteur' };
  const option = (placeId: string, mode: ListingRoute['mode'], minutes: number, recommended = false): ListingRoute =>
    ({ placeId, mode, recommended, durationSeconds: minutes * 60, distanceMeters: 3000, path: [[50.64, 3.06], [50.63, 3.07]], segments: [] });
  const threeWays = [
    option('place-1', 'bike', 25, true), option('place-1', 'transit', 30), option('place-1', 'drive', 12),
    option('place-3', 'walk', 8, true),
  ];

  it('marche trop longue : sélecteur Vélo / Transports / Voiture, le mode recommandé coché par défaut ; un appui change tous les trajets affichés', async () => {
    mockFetch([{ match: /\/routes$/, respond: () => ({ body: { routes: threeWays } }) }]);
    renderMap({ routingAvailable: true, places: [work, school] });
    const group = await screen.findByRole('radiogroup', { name: 'Trajet affiché' });
    expect(Array.from(group.querySelectorAll('[role=radio]')).map(button => button.textContent)).toEqual(['Vélo', 'Transports', 'Voiture']);
    expect(screen.getByRole('radio', { name: 'Vélo' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('25 minà vélo');
    expect(screen.getByTestId('map-travel-place-3')).toHaveTextContent('8 minà pied');
    fireEvent.click(screen.getByRole('radio', { name: 'Voiture' }));
    expect(screen.getByRole('radio', { name: 'Voiture' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Vélo' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('12 minen voiture');
    expect(screen.getByTestId('map-travel-place-3')).toHaveTextContent('8 minà pied', { normalizeWhitespace: true });
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-routes', 'place-1,place-3');
    fireEvent.click(screen.getByRole('radio', { name: 'Transports' }));
    expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('30 minen transports');
  });

  it('plusieurs lieux : par défaut le mode le plus souvent recommandé ; un lieu sans ce mode garde le sien', async () => {
    const spouse: HousingPlace = { ...work, id: 'place-4', label: 'Travail de Léa' };
    mockFetch([{ match: /\/routes$/, respond: () => ({ body: { routes: [
      option('place-1', 'bike', 45), option('place-1', 'transit', 30, true), option('place-1', 'drive', 20),
      option('place-4', 'bike', 50), option('place-4', 'transit', 35, true), option('place-4', 'drive', 25),
      option('place-3', 'bike', 10, true), option('place-3', 'drive', 5),
    ] } }) }]);
    renderMap({ routingAvailable: true, places: [work, spouse, school] });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Transports' })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByTestId('map-travel-place-1')).toHaveTextContent('30 minen transports');
    expect(screen.getByTestId('map-travel-place-4')).toHaveTextContent('35 minen transports');
    expect(screen.getByTestId('map-travel-place-3')).toHaveTextContent('10 minà vélo', { normalizeWhitespace: true });
  });

  it('quartier ou commune : jamais de sélecteur (aucun trajet)', async () => {
    mockFetch([{ match: /\/routes$/, respond: () => ({ body: { routes: threeWays } }) }]);
    renderMap({ listing: precise({ geoPrecision: 'district' }), routingAvailable: true });
    await screen.findByTestId('canvas');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('transports : les lignes empruntées s’affichent dans l’ordre, dans leurs couleurs, sous l’adresse du lieu', async () => {
    mockFetch([{ match: /\/routes$/, respond: () => ({ body: { routes: [{ ...transitRoute, recommended: true }, option('place-1', 'bike', 45)] } }) }]);
    renderMap({ routingAvailable: true });
    const lines = await screen.findByTestId('map-lines-place-1');
    expect(lines).toHaveTextContent('M1→Liane 5');
    expect(lines).toHaveAccessibleName('Lignes : M1, Liane 5');
    expect(screen.getByText('M1')).toHaveStyle({ background: '#FFCC00', color: '#222222' });
    fireEvent.click(screen.getByRole('radio', { name: 'Vélo' }));
    expect(screen.queryByTestId('map-lines-place-1')).not.toBeInTheDocument();
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
