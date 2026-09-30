import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import SearchDetail from '@/pages/search-detail';
import { checks, listing, mockFetch, search, type Route as FetchRoute } from '@/test/fixtures';

const api = vi.hoisted(() => ({
  state: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  refresh: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...(await importOriginal<typeof import('@workspace/api-client-react')>()),
  useGetHousingSearch: () => api.state,
  useRefreshHousingSearch: () => ({ mutateAsync: api.refresh, isPending: false }),
  useCreateHousingSearch: () => ({ mutateAsync: api.create, isPending: false }),
}));

const favoriteRoutes = (initial: object[] = []): FetchRoute[] => [
  { match: /\/api\/config$/, respond: () => ({ body: { resultsPerCall: 5 } }) },
  { match: /\/api\/favorites$/, respond: () => ({ body: initial }) },
  { method: 'PUT', match: /\/api\/favorites$/, respond: () => ({ body: {} }) },
  { method: 'DELETE', match: /\/api\/favorites\?url=/, respond: () => ({ status: 204 }) },
];

function renderPage(path = '/searches/1') {
  const { hook } = memoryLocation({ path });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Router hook={hook}><Route path="/searches/:id" component={SearchDetail}/></Router></QueryClientProvider>);
}
const cardOrder = () => screen.getAllByTestId(/^card-listing-\d+$/).map(card => card.getAttribute('data-testid')!.replace('card-listing-', ''));

beforeEach(() => {
  api.state.data = search(); api.state.isLoading = false; api.state.isError = false;
  api.refresh.mockReset(); api.create.mockReset();
  mockFetch(favoriteRoutes());
});

describe('Page résultats : contenu', () => {
  it('affiche la ville, la demande, le nombre d’annonces et l’état de la recherche', () => {
    renderPage();
    expect(screen.getByTestId('text-search-location')).toHaveTextContent('Lille');
    expect(screen.getByTestId('text-search-prompt')).toHaveTextContent('Un studio à Lille, 700 € max, chat accepté');
    expect(screen.getByTestId('text-listing-count')).toHaveTextContent('3 annonces à explorer');
    expect(screen.getByTestId('status-search-detail')).toHaveTextContent('Recherche terminée');
  });

  it('chaque carte montre prix, surface, pièces et localisation avec une icône, et le critère « non précisé »', () => {
    renderPage();
    const card = screen.getByTestId('card-listing-1');
    expect(within(card).getByTestId('card-general-1-Prix')).toHaveTextContent('600');
    for (const label of ['Prix', 'Surface', 'Pièces', 'Localisation']) {
      const tile = within(card).getByTestId(`card-general-1-${label}`);
      expect(tile.querySelector('svg')).not.toBeNull();
    }
    expect(within(card).getByTestId('card-criterion-1-wish-1')).toHaveTextContent('Non précisé');
  });

  it('vocabulaire : « Chercher d’autres annonces » (plus de « Refresh ») et « favoris » (plus de « aimées »)', async () => {
    renderPage();
    expect(screen.getByTestId('button-refresh')).toHaveTextContent('Chercher d’autres annonces');
    expect(document.body).not.toHaveTextContent(/\bRefresh\b/);
    expect(screen.getByTestId('button-like-1')).toHaveAccessibleName(/Ajouter aux favoris/);
  });

  it('le bouton « Chercher d’autres annonces » relance la recherche sur le serveur', async () => {
    const user = userEvent.setup();
    api.refresh.mockResolvedValue(search());
    renderPage();
    await user.click(screen.getByTestId('button-refresh'));
    expect(api.refresh).toHaveBeenCalledWith({ id: 1 });
  });

  it('plus de bloc promotionnel « Le tri est fait » avant les annonces', () => {
    renderPage();
    expect(document.body).not.toHaveTextContent('Le tri est fait');
  });

  it('l’explication « Comment les critères sont vérifiés » est repliée par défaut', () => {
    renderPage();
    const details = screen.getByText('Comment les critères sont vérifiés').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });
});

describe('Page résultats : mode debug', () => {
  it('masque les requêtes Apify (JSON) pour l’utilisateur', () => {
    renderPage();
    expect(screen.queryByTestId('search-request-debug')).not.toBeInTheDocument();
  });

  it('les affiche avec ?debug=1', () => {
    window.history.replaceState(null, '', '/searches/1?debug=1');
    renderPage();
    expect(screen.getByTestId('search-request-debug')).toBeInTheDocument();
  });
});

describe('Page résultats : tri et consultation', () => {
  it('trie par pertinence par défaut, puis par prix croissant sur demande', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { score: 60, price: 900 }), listing(2, { score: 90, price: 700 }), listing(3, { score: 75, price: 500 })] });
    renderPage();
    expect(cardOrder()).toEqual(['2', '3', '1']);
    await user.selectOptions(screen.getByTestId('select-sort'), 'price');
    expect(cardOrder()).toEqual(['3', '2', '1']);
  });

  it('une annonce consultée reste à sa place (elle n’est plus repoussée en bas) et est signalée', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(cardOrder()).toEqual(['1', '2', '3']);
    await user.click(screen.getByTestId('button-open-listing-1'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('card-listing-1')).toHaveTextContent('déjà consultée'));
    expect(cardOrder()).toEqual(['1', '2', '3']);
    expect(screen.getByText(/2 annonces non consultées/)).toBeInTheDocument();
    expect(screen.getByText(/Celles déjà ouvertes sont grisées/)).toBeInTheDocument();
  });
});

describe('Page résultats : favoris et comparaison', () => {
  it('le cœur ajoute puis retire le favori en base (PUT puis DELETE)', async () => {
    const user = userEvent.setup();
    const calls = mockFetch(favoriteRoutes());
    renderPage();
    const heart = screen.getByTestId('button-like-2');
    await user.click(heart);
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'true'));
    expect(calls.find(call => call.method === 'PUT')?.body).toMatchObject({ url: listing(2).url, title: 'Studio lumineux 2', searchId: 1 });
    await user.click(heart);
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'false'));
    expect(calls.find(call => call.method === 'DELETE')?.url).toContain(encodeURIComponent(listing(2).url));
  });

  it('un favori déjà en base apparaît coché au chargement', async () => {
    mockFetch(favoriteRoutes([{ url: listing(3).url, title: 'x', image: null, price: 1, area: 1, rooms: 1, location: 'L', score: 1, searchId: 1, savedAt: '2026-09-30T10:00:00Z' }]));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('button-like-3')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('button-like-1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('affiche une erreur claire et annule le cœur si l’enregistrement échoue', async () => {
    const user = userEvent.setup();
    mockFetch([...favoriteRoutes().slice(0, 2), { method: 'PUT', match: /\/api\/favorites$/, respond: () => ({ status: 500 }) }]);
    renderPage();
    await user.click(screen.getByTestId('button-like-1'));
    expect(await screen.findByText(/Impossible d’enregistrer vos favoris/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('button-like-1')).toHaveAttribute('aria-pressed', 'false'));
  });

  it('compare jusqu’à 3 annonces : la 4e est refusée', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [1, 2, 3, 4].map(n => listing(n)) });
    renderPage();
    for (const n of [1, 2, 3]) await user.click(screen.getByTestId(`button-compare-${n}`));
    expect(screen.getByText(/3 annonces à comparer/)).toBeInTheDocument();
    expect(screen.getByTestId('button-compare-4')).toBeDisabled();
    await user.click(screen.getByTestId('button-clear-compare'));
    expect(screen.queryByText(/annonces à comparer/)).not.toBeInTheDocument();
  });
});

describe('Page résultats : fiche détaillée', () => {
  it('ouvre la fiche avec repères à icônes et une ligne « Contacter le vendeur » (message replié)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    const dialog = await screen.findByTestId('dialog-listing-1');
    expect(within(dialog).getByTestId('text-detail-title-1')).toHaveTextContent('Studio lumineux 1');
    expect(within(dialog).getByTestId('general-1-Surface').querySelector('svg')).not.toBeNull();
    const contact = within(dialog).getByTestId('contact-1');
    expect(contact).toHaveTextContent('Contacter le vendeur');
    expect(within(contact).getByRole('link', { name: /écrire/i })).toHaveAttribute('href', listing(1).url);
    expect(within(contact).queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(within(contact).getByRole('button', { name: /proposer un message/i }));
    expect((within(contact).getByRole('textbox') as HTMLTextAreaElement).value).toContain('- chat accepté ?');
  });
});

describe('Page résultats : autres états', () => {
  it('recherche en cours : progression, pas de liste finale', () => {
    api.state.data = search({ status: 'running', stage: 'searching', listings: [], count: 0 });
    renderPage();
    expect(screen.getByTestId('status-search-detail')).toHaveTextContent('Recherche en cours');
    expect(screen.queryByTestId('text-listing-count')).not.toBeInTheDocument();
  });

  it('recherche échouée : message du serveur et lien pour recommencer', () => {
    api.state.data = search({ status: 'failed', error: 'Apify ne répond pas.', listings: [], count: 0 });
    renderPage();
    expect(screen.getByTestId('status-error')).toHaveTextContent('Apify ne répond pas.');
    expect(screen.getByTestId('link-new-after-failure')).toBeInTheDocument();
  });

  it('aucune annonce : message utile et lien pour repartir', () => {
    api.state.data = search({ listings: [], count: 0 });
    renderPage();
    expect(screen.getByText('Aucune annonce dans cette sélection.')).toBeInTheDocument();
    expect(screen.getByTestId('link-empty-new-search')).toBeInTheDocument();
  });

  it('recherche introuvable (404 : celle d’un autre compte) : message et retour à l’accueil', () => {
    api.state.data = undefined; api.state.isError = true;
    renderPage();
    expect(screen.getByTestId('status-error')).toHaveTextContent('Impossible de retrouver cette recherche');
    expect(screen.getByTestId('link-error-home')).toBeInTheDocument();
  });

  it('identifiant invalide dans l’adresse : page « Cette recherche n’existe pas »', () => {
    renderPage('/searches/abc');
    expect(screen.getByText('Cette recherche n’existe pas.')).toBeInTheDocument();
  });
});

void checks;
