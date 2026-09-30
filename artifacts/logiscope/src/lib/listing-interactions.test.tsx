import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listingKey, markListingViewed, resetListingInteractionsCache, useFavoriteActions, useListingInteractions, type FavoriteListing } from '@/lib/listing-interactions';
import { UNAUTHORIZED_EVENT } from '@/components/auth-gate';
import { listing, mockFetch, type Route } from '@/test/fixtures';

const stored = (n: number): FavoriteListing => ({
  url: `https://www.leboncoin.fr/ad/locations/${n}`, title: `Studio ${n}`, image: null, price: 600, area: 25, rooms: 1,
  location: 'Lille', score: 80, searchId: 1, savedAt: `2026-09-30T10:0${n}:00Z`,
});

function setup(routes: Route[]) {
  const calls = mockFetch(routes);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ interactions: useListingInteractions(), actions: useFavoriteActions() }), { wrapper });
  return { calls, hook };
}
beforeEach(() => resetListingInteractionsCache());
const list = (items: FavoriteListing[]): Route => ({ match: /\/api\/favorites$/, respond: () => ({ body: items }) });

describe('listingKey', () => {
  it('ignore la casse du domaine, le « / » final et la query string', () => {
    expect(listingKey('https://WWW.leboncoin.fr/ad/locations/1/')).toBe('https://www.leboncoin.fr/ad/locations/1');
    expect(listingKey('https://www.leboncoin.fr/ad/locations/1?utm=x')).toBe('https://www.leboncoin.fr/ad/locations/1');
    expect(listingKey('pas une url')).toBe('pas une url');
  });
});

describe('favoris en base', () => {
  it('charge les favoris du compte, indexés par annonce', async () => {
    const { hook } = setup([list([stored(1), stored(2)])]);
    await waitFor(() => expect(Object.keys(hook.result.current.interactions.favorites)).toHaveLength(2));
    expect(hook.result.current.interactions.favorites[listingKey(stored(1).url)].title).toBe('Studio 1');
  });

  it('ajoute un favori tout de suite à l’écran puis l’envoie au serveur (PUT)', async () => {
    const { hook, calls } = setup([list([]), { method: 'PUT', match: /\/api\/favorites$/, respond: () => ({ body: {} }) }]);
    await waitFor(() => expect(hook.result.current.interactions.favoritesLoading).toBe(false));
    let ok = false;
    await act(async () => { ok = await hook.result.current.actions.toggle(listing(5), 7); });
    expect(ok).toBe(true);
    await waitFor(() => expect(hook.result.current.interactions.favorites[listingKey(listing(5).url)]).toBeDefined());
    const put = calls.find(call => call.method === 'PUT');
    expect(put?.body).toMatchObject({ url: listing(5).url, title: listing(5).title, searchId: 7 });
  });

  it('retire un favori déjà présent (DELETE avec l’URL) au lieu de le dupliquer', async () => {
    const { hook, calls } = setup([list([stored(1)]), { method: 'DELETE', match: /\/api\/favorites\?url=/, respond: () => ({ status: 204 }) }]);
    await waitFor(() => expect(Object.keys(hook.result.current.interactions.favorites)).toHaveLength(1));
    await act(async () => { await hook.result.current.actions.toggle(listing(1), 1); });
    await waitFor(() => expect(Object.keys(hook.result.current.interactions.favorites)).toHaveLength(0));
    expect(calls.find(call => call.method === 'DELETE')?.url).toContain(encodeURIComponent(stored(1).url));
  });

  it('annule l’ajout à l’écran si le serveur refuse', async () => {
    const { hook, calls } = setup([list([]), { method: 'PUT', match: /\/api\/favorites$/, respond: () => ({ status: 500 }) }]);
    await waitFor(() => expect(hook.result.current.interactions.favoritesLoading).toBe(false));
    let ok = true;
    await act(async () => { ok = await hook.result.current.actions.toggle(listing(5), 7); });
    expect(ok).toBe(false);
    expect(calls.some(call => call.method === 'PUT')).toBe(true);
    await waitFor(() => expect(Object.keys(hook.result.current.interactions.favorites)).toHaveLength(0));
  });

  it('une session expirée (401) renvoie à l’écran de connexion', async () => {
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    setup([{ match: /\/api\/favorites$/, respond: () => ({ status: 401 }) }]);
    await waitFor(() => expect(listener).toHaveBeenCalled());
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('reprend une seule fois les favoris d’avant les comptes (localStorage) puis les efface du navigateur', async () => {
    window.localStorage.setItem('logiscope:listing-interactions:v1', JSON.stringify({ favorites: { a: stored(3) }, viewed: ['v'] }));
    const { hook, calls } = setup([{ method: 'POST', match: /\/api\/favorites\/import$/, respond: () => ({ body: { imported: 1 } }) }, list([stored(3)])]);
    await waitFor(() => expect(Object.keys(hook.result.current.interactions.favorites)).toHaveLength(1));
    const imported = calls.find(call => call.url.endsWith('/favorites/import'));
    expect((imported?.body as { items: FavoriteListing[] }).items[0].url).toBe(stored(3).url);
    const local = JSON.parse(window.localStorage.getItem('logiscope:listing-interactions:v1') ?? '{}') as { favorites: object; viewed: string[] };
    expect(local.favorites).toEqual({});
    expect(local.viewed).toEqual(['v']);
  });
});

describe('annonces consultées (navigateur)', () => {
  it('sont mémorisées une seule fois par annonce', () => {
    expect(markListingViewed('https://www.leboncoin.fr/ad/locations/1/')).toBe(true);
    expect(markListingViewed('https://www.leboncoin.fr/ad/locations/1')).toBe(true);
    const stock = JSON.parse(window.localStorage.getItem('logiscope:listing-interactions:v1') ?? '{}') as { viewed: string[] };
    expect(stock.viewed).toEqual(['https://www.leboncoin.fr/ad/locations/1']);
  });
});
