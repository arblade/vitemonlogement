import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Likes from '@/pages/likes';
import { resetListingInteractionsCache, type FavoriteListing } from '@/lib/listing-interactions';
import { mockFetch, type Route } from '@/test/fixtures';

const favorite = (n: number, overrides: Partial<FavoriteListing> = {}): FavoriteListing => ({
  url: `https://www.leboncoin.fr/ad/locations/${n}`, title: `Studio ${n}`, image: null, price: 600 + n, area: 25, rooms: 1,
  location: 'Lille', score: 80, searchId: 3, savedAt: `2026-09-30T10:0${n}:00Z`, ...overrides,
});
const list = (items: FavoriteListing[]): Route => ({ match: /\/api\/favorites$/, respond: () => ({ body: items }) });
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Router hook={memoryLocation({ path: '/likes' }).hook}><Likes/></Router></QueryClientProvider>);

beforeEach(() => resetListingInteractionsCache());

describe('Mes favoris', () => {
  it('explique que les favoris sont liés au compte', async () => {
    mockFetch([list([])]);
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mes favoris');
    expect(screen.getByText(/liées à votre compte/)).toBeInTheDocument();
  });

  it('affiche le chargement puis les favoris du compte, le plus récent d’abord', async () => {
    mockFetch([list([favorite(2), favorite(1)])]);
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Chargement de vos favoris');
    const titles = await screen.findAllByRole('heading', { level: 2 });
    expect(titles.map(title => title.textContent)).toEqual(['Studio 2', 'Studio 1']);
  });

  it('chaque favori renvoie à sa recherche et à l’annonce d’origine', async () => {
    mockFetch([list([favorite(1)])]);
    renderPage();
    await screen.findByText('Studio 1');
    expect(screen.getByRole('link', { name: /voir dans la recherche/i })).toHaveAttribute('href', '/searches/3');
    const source = screen.getByRole('link', { name: /voir sur le bon coin/i });
    expect(source).toHaveAttribute('href', favorite(1).url);
    expect(source.getAttribute('rel')).toContain('noopener');
  });

  it('« Retirer » supprime le favori en base (DELETE) et le fait disparaître', async () => {
    const user = userEvent.setup();
    const calls = mockFetch([list([favorite(1), favorite(2)]), { method: 'DELETE', match: /\/api\/favorites\?url=/, respond: () => ({ status: 204 }) }]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Retirer des favoris : Studio 1' }));
    await waitFor(() => expect(screen.queryByText('Studio 1')).not.toBeInTheDocument());
    expect(screen.getByText('Studio 2')).toBeInTheDocument();
    expect(calls.find(call => call.method === 'DELETE')?.url).toContain(encodeURIComponent(favorite(1).url));
  });

  it('si la suppression échoue : le favori revient et un message l’explique', async () => {
    const user = userEvent.setup();
    mockFetch([list([favorite(1)]), { method: 'DELETE', match: /\/api\/favorites\?url=/, respond: () => ({ status: 500 }) }]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Retirer des favoris : Studio 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de retirer ce favori');
    expect(screen.getByText('Studio 1')).toBeInTheDocument();
  });

  it('aucun favori : état vide', async () => {
    mockFetch([list([])]);
    renderPage();
    expect(await screen.findByText('Aucun favori pour le moment.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/aimée/);
  });

  it('impossible de charger les favoris : message d’erreur', async () => {
    mockFetch([{ match: /\/api\/favorites$/, respond: () => ({ status: 500 }) }]);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger vos favoris');
  });
});
