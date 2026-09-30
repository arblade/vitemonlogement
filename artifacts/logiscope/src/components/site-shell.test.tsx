import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AuthGate } from '@/components/auth-gate';
import { SiteShell } from '@/components/site-shell';
import { mockFetch, type Route } from '@/test/fixtures';

const me: Route = { match: /\/api\/auth\/me$/, respond: () => ({ body: { authenticated: true, email: 'moi@example.com' } }) };
const favorites = (n: number): Route => ({
  match: /\/api\/favorites$/,
  respond: () => ({ body: Array.from({ length: n }, (_, i) => ({ url: `https://www.leboncoin.fr/ad/locations/${i}`, title: 'T', image: null, price: 1, area: 1, rooms: 1, location: 'L', score: 1, searchId: 1, savedAt: '2026-09-30T10:00:00Z' })) }),
});

function renderShell(path = '/') {
  const { hook } = memoryLocation({ path, static: true });
  return render(<QueryClientProvider client={new QueryClient()}><AuthGate><Router hook={hook}><SiteShell><p>Contenu</p></SiteShell></Router></AuthGate></QueryClientProvider>);
}

describe('SiteShell', () => {
  it('propose Nouvelle recherche, Mes recherches et Favoris (vocabulaire utilisateur), sur bureau et mobile', async () => {
    mockFetch([me, favorites(0)]);
    renderShell();
    await screen.findByText('Contenu');
    for (const label of ['Nouvelle recherche', 'Mes recherches', 'Favoris']) expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/J’aime/)).not.toBeInTheDocument();
  });

  it('marque la page courante (aria-current)', async () => {
    mockFetch([me, favorites(0)]);
    renderShell('/searches/4');
    await screen.findByText('Contenu');
    expect(screen.getByTestId('link-history')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('link-new-search')).not.toHaveAttribute('aria-current');
  });

  it('affiche le nombre de favoris du compte', async () => {
    mockFetch([me, favorites(2)]);
    renderShell();
    await screen.findByText('Contenu');
    expect(await within(screen.getByTestId('link-likes')).findByText('2')).toBeInTheDocument();
  });

  it('montre l’e-mail connecté dans le menu mobile et permet de se déconnecter', async () => {
    const user = userEvent.setup();
    const calls = mockFetch([me, favorites(0), { method: 'POST', match: /\/api\/auth\/logout$/, respond: () => ({ status: 204 }) }]);
    renderShell();
    await screen.findByText('Contenu');
    await user.click(screen.getByTestId('button-mobile-menu'));
    expect(within(screen.getByTestId('nav-mobile')).getByText('moi@example.com')).toBeInTheDocument();
    await user.click(screen.getByTestId('button-mobile-logout'));
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(calls.some(call => call.method === 'POST' && call.url.endsWith('/auth/logout'))).toBe(true);
  });

  it('le bouton de déconnexion du bureau fonctionne aussi', async () => {
    const user = userEvent.setup();
    mockFetch([me, favorites(0), { method: 'POST', match: /\/api\/auth\/logout$/, respond: () => ({ status: 204 }) }]);
    renderShell();
    await screen.findByText('Contenu');
    await user.click(screen.getByTestId('button-logout'));
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });
});
