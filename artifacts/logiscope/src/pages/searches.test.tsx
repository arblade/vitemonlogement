import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Searches from '@/pages/searches';
import { search } from '@/test/fixtures';

const api = vi.hoisted(() => ({ history: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() } }));
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...(await importOriginal<typeof import('@workspace/api-client-react')>()),
  useListHousingSearches: () => api.history,
}));

const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><Router hook={memoryLocation({ path: '/searches' }).hook}><Searches/></Router></QueryClientProvider>);
beforeEach(() => { api.history.data = []; api.history.isLoading = false; api.history.isError = false; api.history.refetch.mockReset(); });

describe('Mes recherches', () => {
  it('liste chaque recherche : ville, demande, état, lien, et le nombre total', () => {
    api.history.data = [search({ id: 7, count: 1 }), search({ id: 8, status: 'running', count: 0 }), search({ id: 9, status: 'failed', count: 0 })];
    renderPage();
    expect(screen.getByTestId('text-search-count')).toHaveTextContent('3 recherches');
    expect(screen.getByTestId('link-search-7')).toHaveAttribute('href', '/searches/7');
    expect(screen.getByTestId('text-search-title-7')).toHaveTextContent('Lille');
    expect(screen.getByTestId('status-search-7')).toHaveTextContent('1 annonce');
    expect(screen.getByTestId('status-search-8')).toHaveTextContent('En cours');
    expect(screen.getByTestId('status-search-9')).toHaveTextContent('Échouée');
  });

  it('propose de lancer une nouvelle recherche', () => {
    renderPage();
    expect(screen.getByTestId('link-new-search-page')).toHaveAttribute('href', '/');
  });

  it('historique vide : invitation à lancer la première recherche', () => {
    renderPage();
    expect(screen.getByTestId('status-searches-empty')).toBeInTheDocument();
    expect(screen.getByTestId('link-first-search')).toHaveAttribute('href', '/');
    expect(screen.queryByTestId('text-search-count')).not.toBeInTheDocument();
  });

  it('chargement : indicateur accessible, pas de liste', () => {
    api.history.isLoading = true;
    renderPage();
    expect(screen.getByRole('status', { name: /chargement de vos recherches/i })).toBeInTheDocument();
    expect(screen.queryByTestId('status-searches-empty')).not.toBeInTheDocument();
  });

  it('erreur : message et « Réessayer » relance le chargement', async () => {
    const user = userEvent.setup();
    api.history.isError = true;
    renderPage();
    expect(screen.getByTestId('status-error')).toHaveTextContent('Impossible de charger vos recherches');
    await user.click(screen.getByTestId('button-retry'));
    expect(api.history.refetch).toHaveBeenCalled();
  });
});
