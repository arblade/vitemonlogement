import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HousingListing } from '@workspace/api-client-react';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import SearchDetail from '@/pages/search-detail';
import { resetListingInteractionsCache } from '@/lib/listing-interactions';
import { checks, listing, mockFetch, search, type Route as FetchRoute } from '@/test/fixtures';

// jsdom n'a pas de WebGL : les cartes MapLibre sont remplacées par un témoin des données reçues (vrai rendu : e2e).
vi.mock('@/components/listing-map-canvas', () => ({ default: () => <div data-testid="canvas"/> }));
vi.mock('@/components/results-map-canvas', () => ({
  default: ({ items, places, viewed, onPick }: { items: { listing: { id: number } }[]; places: { id: string }[]; viewed: ReadonlySet<number>; onPick: (id: number) => void }) =>
    <div data-testid="results-map-canvas" data-places={places.map(place => place.id).join(',')}>
      {items.map(({ listing: { id } }) => <button key={id} type="button" data-testid={`results-marker-${id}`} data-viewed={viewed.has(id)} onClick={() => onPick(id)}>{id}</button>)}
    </div>,
}));

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
  resetListingInteractionsCache();
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
    expect(within(card).getByTestId('card-criterion-1-wish-1')).toHaveTextContent(/non précisé/i);
  });

  it('carte allégée : critères puis caractéristiques en une rangée de pastilles, sans titres, ni rang · site, ni lien « Détails, sources et preuves »', () => {
    api.state.data = search({ listings: [listing(1, { features: [
      { label: 'Ascenseur', value: 'Non', source: 'annonce', evidence: '' },
      { label: 'Étage', value: '3', source: 'annonce', evidence: '' },
      { label: 'Chambres', value: '1 ch.', source: 'annonce', evidence: '' },
      { label: 'Classe énergie', value: 'd', source: 'annonce', evidence: '' },
      { label: 'Cave', value: '', source: 'ia', evidence: 'cave' },
      { label: 'Charges', value: '60 €', source: 'annonce', evidence: '' },
    ] })] });
    renderPage();
    const card = screen.getByTestId('card-listing-1');
    for (const gone of ['Vos critères', 'Autres caractéristiques', 'Détails, sources et preuves', '01 ·', 'dans le détail']) expect(card).not.toHaveTextContent(gone);
    const chips = within(screen.getByTestId('card-facts-1')).getAllByRole('listitem').map(item => item.textContent);
    // Le critère passe en premier (statut lu par les lecteurs d’écran), puis les caractéristiques en mots simples,
    // dans l’ordre de lecture (pièces, étage, équipements, énergie, charges, absent) ; 6 pastilles au plus.
    expect(chips).toEqual(['chat accepté : non précisé', '1 chambre', '3e étage', 'Cave', 'DPE D', 'Charges 60 €', '+1']);
    expect(within(card).getByTestId('card-feature-1-0').querySelector('svg')).not.toBeNull();
  });

  it('« Fiche complète » est le bouton principal et ouvre la fiche ; « Voir sur … » et « Comparer » restent à côté', async () => {
    const user = userEvent.setup();
    renderPage();
    const button = screen.getByTestId('button-fiche-1');
    expect(button).toHaveTextContent('Fiche complète');
    expect(button.className).toContain('bg-brand');
    expect(screen.getByTestId('link-source-1').className).not.toContain('bg-brand');
    expect(screen.getByTestId('button-compare-1')).toBeInTheDocument();
    await user.click(button);
    expect(await screen.findByTestId('dialog-listing-1')).toBeInTheDocument();
  });

  it('vocabulaire : « Étendre » (plus de « Refresh ») et « favoris » (plus de « aimées »)', async () => {
    renderPage();
    expect(screen.getByTestId('button-refresh')).toHaveTextContent('Étendre');
    expect(document.body).not.toHaveTextContent(/\bRefresh\b/);
    expect(screen.getByTestId('button-like-1')).toHaveAccessibleName(/Ajouter aux favoris/);
  });

  it('plus de bloc « Affiner votre recherche » : « Modifier ma demande » est le bouton principal, à côté de « Étendre » qui devient secondaire', () => {
    renderPage();
    expect(document.body).not.toHaveTextContent('Affiner votre recherche');
    const edit = screen.getByTestId('button-edit-prompt'), refresh = screen.getByTestId('button-refresh');
    expect(edit).toHaveTextContent('Modifier ma demande');
    expect(edit.className).toContain('bg-brand');
    expect(refresh.className).not.toContain('bg-brand');
    expect(refresh.className).toContain('border');
    expect(edit.parentElement).toBe(refresh.parentElement);
    expect(edit.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('recherche échouée : « Modifier ma demande » reste disponible, sans « Étendre »', () => {
    api.state.data = search({ status: 'failed', error: 'Échec', listings: [], count: 0 });
    renderPage();
    expect(screen.getByTestId('button-edit-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('button-refresh')).not.toBeInTheDocument();
  });

  it('« Modifier ma demande » ouvre le champ prérempli et relance une nouvelle recherche', async () => {
    const user = userEvent.setup();
    api.create.mockResolvedValue(search({ id: 2 }));
    renderPage();
    await user.click(screen.getByTestId('button-edit-prompt'));
    expect(screen.queryByTestId('button-edit-prompt')).not.toBeInTheDocument();
    const field = screen.getByTestId('input-edit-prompt');
    expect(field).toHaveValue('Un studio à Lille, 700 € max, chat accepté');
    await user.clear(field);
    await user.type(field, 'Un T2 à Lille, 800 € max, balcon');
    await user.click(screen.getByTestId('button-relaunch-search'));
    expect(api.create).toHaveBeenCalledWith({ data: { prompt: 'Un T2 à Lille, 800 € max, balcon' } });
  });

  it('le bouton « Étendre » relance la recherche sur le serveur', async () => {
    const user = userEvent.setup();
    api.refresh.mockResolvedValue(search());
    renderPage();
    await user.click(screen.getByTestId('button-refresh'));
    expect(api.refresh).toHaveBeenCalledWith({ id: 1 });
  });

  it('chaque carte renvoie à son site d’origine (Le Bon Coin, SeLoger, PAP) par son bouton', () => {
    api.state.data = search({ listings: [
      listing(1),
      listing(2, { source: 'seloger', url: 'https://www.seloger.com/annonce/location/hauts-de-france/nord-59/lille-59000/26ABC' }),
      listing(3, { source: 'pap', url: 'https://www.pap.fr/annonces/-r442803002' }),
    ] });
    renderPage();
    expect(screen.getByTestId('link-source-1')).toHaveTextContent('Voir sur Le Bon Coin');
    expect(screen.getByTestId('link-source-2')).toHaveTextContent('Voir sur SeLoger');
    expect(screen.getByTestId('link-source-3')).toHaveTextContent('Voir sur PAP');
    expect(screen.getByTestId('link-source-3')).toHaveAttribute('href', 'https://www.pap.fr/annonces/-r442803002');
  });

  it('« Votre demande » montre la fourchette de pièces (« T1 ou T2 » : 1 à 2)', () => {
    api.state.data = search({ criteria: { ...search().criteria, minRooms: 1, maxRooms: 2 } });
    renderPage();
    const row = (label: string) => screen.getByText(label).parentElement;
    expect(row('Pièces min.')).toHaveTextContent('Pièces min.1');
    expect(row('Pièces max.')).toHaveTextContent('Pièces max.2');
  });

  it('plus de bloc promotionnel « Le tri est fait » avant les annonces', () => {
    renderPage();
    expect(document.body).not.toHaveTextContent('Le tri est fait');
  });

  it('l’explication « Où on cherche les critères » est repliée par défaut', () => {
    renderPage();
    const details = screen.getByText('Où on cherche les critères').closest('details');
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

  it('avec ?debug=1, les appels PAP et SeLoger s’affichent à côté de ceux de Le Bon Coin', () => {
    window.history.replaceState(null, '', '/searches/1?debug=1');
    const lbc = { batch: 'focused' as const, path: '/v2/acts/fatihtahta~leboncoin-fr-scraper/runs', input: JSON.stringify({ startUrls: ['https://www.leboncoin.fr/recherche?category=10&text=balcon'], limit: 10 }) };
    api.state.data = search({ searchRequests: [lbc,
      { batch: 'focused', source: 'pap', path: '/v2/acts/clearpath~pap-scraper/runs', input: JSON.stringify({ product: 'location' }) },
      { batch: 'focused', source: 'seloger', path: '/v2/acts/silentflow~seloger-scraper-ppr/runs', input: JSON.stringify({ startUrls: ['https://www.seloger.com/classified-search?distributionTypes=Rent'] }) },
    ] });
    renderPage();
    expect(screen.getByTestId('search-request-focused')).toHaveTextContent('fatihtahta~leboncoin-fr-scraper');
    expect(screen.queryByTestId('search-request-broad')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-request-pap')).toHaveTextContent('"product": "location"');
    expect(screen.getByTestId('search-request-seloger')).toHaveTextContent('distributionTypes=Rent');
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
    await waitFor(() => expect(screen.getByTestId('card-listing-1')).toHaveTextContent(/déjà consultée/i));
    expect(cardOrder()).toEqual(['1', '2', '3']);
    expect(screen.getByText(/2 annonces non consultées/)).toBeInTheDocument();
    expect(screen.getByText(/Celles déjà ouvertes sont grisées/)).toBeInTheDocument();
  });
});

describe('Galerie photo d’une carte', () => {
  const photos = ['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/c.jpg'];

  it('faire défiler les photos ne marque pas l’annonce comme consultée (ni grisée)', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { images: photos, image: photos[0] }), listing(2)] });
    renderPage();
    const card = screen.getByTestId('card-listing-1');
    await user.click(screen.getByTestId('card-photo-next-1'));
    await user.click(screen.getByTestId('card-photo-next-1'));
    await user.click(screen.getByTestId('card-photo-prev-1'));
    await user.click(screen.getByTestId('card-photo-dot-1-0'));
    expect(within(card).getByTestId('card-image-1')).toHaveAttribute('src', photos[0]);
    expect(card).not.toHaveTextContent(/déjà consultée/i);
    expect(card.className).not.toMatch(/opacity|grayscale/);
    expect(screen.getByText(/2 annonces non consultées/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('logiscope:listing-interactions:v1') ?? '{"viewed":[]}').viewed).toEqual([]);
  });

  it('les flèches changent bien de photo, et ouvrir le détail reste ce qui marque l’annonce consultée', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { images: photos, image: photos[0] })] });
    renderPage();
    await user.click(screen.getByTestId('card-photo-next-1'));
    expect(screen.getByTestId('card-image-1')).toHaveAttribute('src', photos[1]);
    await user.click(screen.getByTestId('button-open-listing-1'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('card-listing-1')).toHaveTextContent(/déjà consultée/i));
  });
});

describe('Ouverture de la carte au clic', () => {
  const photos = ['https://img.test/a.jpg', 'https://img.test/b.jpg'];
  const dialog = () => screen.queryByRole('dialog');
  beforeEach(() => { api.state.data = search({ listings: [listing(1, { images: photos, image: photos[0] })] }); });

  it('un clic sur la photo ouvre la fiche complète', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(dialog()).not.toBeInTheDocument();
    await user.click(screen.getByTestId('card-image-1'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('un clic sur le cadre de la photo, sur le titre ou sur le score ouvre aussi la fiche', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('card-gallery-1').parentElement!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await user.click(screen.getByTestId('text-listing-title-1'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await user.click(screen.getByText('/100').closest('div')!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('les flèches, les points, le cœur et « Comparer » n’ouvrent pas la fiche', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('card-photo-next-1'));
    await user.click(screen.getByTestId('card-photo-prev-1'));
    await user.click(screen.getByTestId('card-photo-dot-1-1'));
    await user.click(screen.getByTestId('button-like-1'));
    await user.click(screen.getByTestId('button-compare-1'));
    expect(dialog()).not.toBeInTheDocument();
    expect(screen.getByTestId('card-listing-1')).not.toHaveTextContent(/déjà consultée/i);
  });

  it('un clic sur « Voir sur Le Bon Coin » ouvre l’annonce d’origine, pas la fiche', async () => {
    const user = userEvent.setup();
    renderPage();
    const link = within(screen.getByTestId('card-listing-1')).getByRole('link', { name: /le bon coin/i });
    link.addEventListener('click', event => event.preventDefault());
    await user.click(link);
    expect(dialog()).not.toBeInTheDocument();
  });
});

describe('Vocabulaire : aucun terme technique à l’écran', () => {
  const rich = () => listing(1, {
    criterionResults: [
      { id: 'price', label: 'Budget ≤ 700 €', status: 'confirmed', source: 'api', value: '600 €', evidence: 'Indiqué dans l’annonce : « price ».' },
      { id: 'wish-1', label: 'chat accepté', status: 'confirmed', source: 'description', value: 'Chats acceptés', evidence: 'Les chats sont acceptés' },
      { id: 'wish-2', label: 'balcon', status: 'unknown', source: 'unknown', value: '', evidence: '' },
    ],
    features: [
      { label: 'Parking', value: '1 place', source: 'annonce', evidence: 'Indiqué dans l’annonce : « nb_parkings ».' },
      { label: 'Lumineux', value: '', source: 'ia', evidence: 'très lumineux' },
    ],
  } as Partial<HousingListing>);
  const jargon = /\bAPI\b|Apify|structur|provenance/i;

  it('la liste de résultats ne contient aucun terme technique', () => {
    api.state.data = search({ listings: [rich()] });
    renderPage();
    expect(document.body.textContent).not.toMatch(jargon);
    expect(screen.getByText('Indiqué dans l’annonce')).toBeInTheDocument();
    expect(screen.getByText('À lire dans la description')).toBeInTheDocument();
  });

  it('la fiche détaillée ouverte non plus, et nomme l’origine des informations en clair', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [rich()] });
    renderPage();
    await user.click(screen.getByTestId('text-listing-title-1'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).not.toMatch(jargon);
    expect(within(dialog).getAllByText(/^(Indiqué dans l’annonce|Lu dans la description|À vérifier dans l’annonce)$/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Caractéristiques')).toBeInTheDocument();
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

  it('le cœur, au rose de l’app, rebondit au moment du like seulement (pas au chargement, ni au retrait ; fin de l’animation vérifiée dans le navigateur)', async () => {
    const user = userEvent.setup();
    mockFetch(favoriteRoutes([{ url: listing(3).url, title: 'x', image: null, price: 1, area: 1, rooms: 1, location: 'L', score: 1, searchId: 1, savedAt: '2026-09-30T10:00:00Z' }]));
    renderPage();
    const heart = screen.getByTestId('button-like-2');
    expect(heart.className).not.toContain('heart-pop');
    await waitFor(() => expect(screen.getByTestId('button-like-3')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('button-like-3').className).not.toContain('heart-pop'); // déjà aimée au chargement : pas d'animation
    await user.click(heart);
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'true'));
    expect(heart.className).toContain('heart-pop');
    expect(heart.className).toContain('text-brand'); // le rose de l'app, plus l'ancien rouge-orangé #c13515
    expect(heart.className).toContain('border-brand');
    expect(heart.className).not.toContain('c13515');
    await user.click(heart);
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'false'));
    expect(heart.className).not.toContain('heart-pop');
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
  it('ouvre la fiche : repères à icônes, lien vers l’annonce en haut, plus de bloc « Contacter le vendeur »', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    const dialog = await screen.findByTestId('dialog-listing-1');
    expect(within(dialog).getByTestId('text-detail-title-1')).toHaveTextContent('Studio lumineux 1');
    expect(within(dialog).getByTestId('general-1-Surface').querySelector('svg')).not.toBeNull();
    const top = within(dialog).getByTestId('link-detail-top-1');
    expect(top).toHaveTextContent(/Voir l’annonce/);
    expect(top).toHaveAttribute('href', listing(1).url);
    expect(top).toHaveAttribute('target', '_blank');
    expect(top.compareDocumentPosition(within(dialog).getByTestId('text-detail-title-1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).queryByText(/Contacter le vendeur/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('critères : libellé, statut et source seulement, sans justificatif ni avertissement', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { criterionResults: [
      { id: 'wish-1', label: 'chat accepté', status: 'confirmed', source: 'description', value: 'oui', evidence: 'les chats sont les bienvenus' },
    ] })], criteria: { ...search().criteria, checks: [...checks, { id: 'wish-2', label: 'balcon', availability: 'description', apiField: null }] } });
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    const dialog = await screen.findByTestId('dialog-listing-1');
    const cat = within(dialog).getByTestId('criterion-result-1-wish-1');
    expect(cat).toHaveTextContent('chat accepté');
    expect(within(cat).getByTestId('status-criterion-1-wish-1')).toHaveTextContent('Critère satisfait');
    expect(within(cat).getByTestId('source-criterion-1-wish-1')).toHaveTextContent('Lu dans la description');
    expect(cat).not.toHaveTextContent(/bienvenus|Justificatif|Extrait/);
    expect(within(dialog).getByTestId('criterion-result-1-wish-2')).not.toHaveTextContent(/Aucune information/);
    expect(within(dialog).queryByText(/Une information absente/)).not.toBeInTheDocument();
  });

  it('caractéristiques à la Airbnb : icône + mots simples, sans source ni extrait ; ce qui manque, barré, en dernier', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { features: [
      { label: 'Ascenseur', value: 'Non', source: 'annonce', evidence: '' },
      { label: 'Balcon', value: '', source: 'ia', evidence: 'joli balcon plein sud donnant sur cour' },
      { label: 'Étage', value: '3', source: 'annonce', evidence: 'floor_number: 3' },
    ] })] });
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    const features = within(await screen.findByTestId('dialog-listing-1')).getByTestId('features-1');
    const items = within(features).getAllByRole('listitem');
    expect(items.map(item => item.textContent)).toEqual(['3e étage', 'Balcon', 'Ascenseur : absent']);
    expect(items.every(item => item.querySelector('svg'))).toBe(true);
    expect(items[2].querySelector('.line-through')).toHaveTextContent('Ascenseur');
    expect(features).not.toHaveTextContent(/plein sud|floor_number|Lu dans la description|Indiqué dans l’annonce|Extrait/);
  });

  it('caractéristiques : au-delà de 12, les 10 premières puis « Afficher les N caractéristiques »', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 13 }, (_, i) => ({ label: `Atout ${i + 1}`, value: '', source: 'ia' as const, evidence: 'x' }));
    api.state.data = search({ listings: [listing(1, { features: many })] });
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    const dialog = await screen.findByTestId('dialog-listing-1');
    expect(within(within(dialog).getByTestId('features-1')).getAllByRole('listitem')).toHaveLength(10);
    await user.click(within(dialog).getByTestId('button-all-features-1'));
    expect(within(within(dialog).getByTestId('features-1')).getAllByRole('listitem')).toHaveLength(13);
  });

  it('critères de la fiche en badges, comme sur la carte : couleur selon le statut, source à côté', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { criterionResults: [
      { id: 'wish-1', label: 'chat accepté', status: 'contradicted', source: 'description', value: '', evidence: 'animaux non acceptés' },
    ] })] });
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    const badge = within(await screen.findByTestId('dialog-listing-1')).getByTestId('criterion-result-1-wish-1');
    expect(badge.tagName).toBe('LI');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('text-[#b42318]');
    expect(badge).toHaveTextContent('chat accepté : Critère non satisfait · Lu dans la description');
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

describe('Page résultats : carte des logements', () => {
  const at = { lat: 50.6408, lng: 3.0611 };
  const placed = [
    listing(1, { ...at, geoPrecision: 'streetNumber' }),
    listing(2, { lat: 50.63, lng: 3.07, geoPrecision: 'street' }),
    listing(3, { lat: 50.62, lng: 3.05, geoPrecision: 'district' }),
    listing(4, { lat: 50.61, lng: 3.04, geoPrecision: 'city' }),
    listing(5),
  ];
  const markers = () => screen.queryAllByTestId(/^results-marker-\d+$/).map(node => node.getAttribute('data-testid')!.replace('results-marker-', ''));

  it('aucun logement à position précise (quartier, commune ou rien) : pas de bouton, la liste reste seule', () => {
    api.state.data = search({ listings: [placed[2], placed[3], placed[4]] });
    renderPage();
    expect(screen.getByTestId('card-listing-3')).toBeInTheDocument();
    expect(screen.queryByTestId('button-open-results-map')).not.toBeInTheDocument();
  });

  it('le bouton annonce le nombre de logements placés ; la carte ne montre que l’adresse exacte et la rue, et le dit pour les autres', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: placed });
    renderPage();
    const button = screen.getByTestId('button-open-results-map');
    expect(button).toHaveTextContent('Voir la carte');
    expect(button).toHaveTextContent('2');
    expect(screen.queryByTestId('dialog-results-map')).not.toBeInTheDocument();
    await user.click(button);
    expect(await screen.findByTestId('dialog-results-map')).toBeInTheDocument();
    expect(await screen.findByTestId('results-map-canvas')).toBeInTheDocument();
    expect(markers()).toEqual(['1', '2']);
    const note = screen.getByTestId('results-map-note');
    expect(note).toHaveTextContent('2 logements sur la carte');
    expect(note).toHaveTextContent('3 autres n’ont qu’un quartier ou une commune');
  });

  it('la remarque dit combien de logements sont placés d’après l’adresse citée dans leur description', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [placed[0], { ...placed[1], geoSource: 'description', geoEvidence: 'rue Lavoisier' }, placed[2]] });
    renderPage();
    await user.click(screen.getByTestId('button-open-results-map'));
    expect(screen.getByTestId('results-map-note')).toHaveTextContent('2 logements sur la carte (dont 1 d’après l’adresse citée dans la description) : touchez un prix');
  });

  it('un seul logement manquant : accords au singulier ; aucun manquant : pas de remarque', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [placed[0], placed[2]] });
    renderPage();
    await user.click(screen.getByTestId('button-open-results-map'));
    expect(screen.getByTestId('results-map-note')).toHaveTextContent('1 logement sur la carte');
    expect(screen.getByTestId('results-map-note')).toHaveTextContent('1 autre n’a qu’un quartier ou une commune pour toute position : il n’est pas placé ici, mais figure dans la liste.');
  });

  it('la carte s’ouvre et se ferme sans quitter la page', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: placed });
    renderPage();
    await user.click(screen.getByTestId('button-open-results-map'));
    await user.click(await screen.findByTestId('button-close-results-map'));
    await waitFor(() => expect(screen.queryByTestId('dialog-results-map')).not.toBeInTheDocument());
    expect(screen.getByTestId('card-listing-1')).toBeInTheDocument();
  });

  it('un clic sur un logement de la carte ouvre sa fiche (la carte se ferme) ; fermer la fiche ramène à la carte', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: placed });
    renderPage();
    await user.click(screen.getByTestId('button-open-results-map'));
    await user.click(await screen.findByTestId('results-marker-2'));
    expect(await screen.findByTestId('dialog-listing-2')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('dialog-results-map')).not.toBeInTheDocument());
    await user.click(screen.getByTestId('button-close-listing-2'));
    expect(await screen.findByTestId('dialog-results-map')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('dialog-listing-2')).not.toBeInTheDocument());
    expect(markers()).toEqual(['1', '2']);
  });

  it('une fiche ouverte depuis la liste ne rouvre pas la carte en se fermant', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: placed });
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    await user.click(await screen.findByTestId('button-close-listing-1'));
    await waitFor(() => expect(screen.queryByTestId('dialog-listing-1')).not.toBeInTheDocument());
    expect(screen.queryByTestId('dialog-results-map')).not.toBeInTheDocument();
  });

  it('un logement ouvert depuis la carte est marqué consulté (liste et carte)', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: placed });
    renderPage();
    await user.click(screen.getByTestId('button-open-results-map'));
    expect(screen.getByTestId('results-marker-1')).toHaveAttribute('data-viewed', 'false');
    await user.click(screen.getByTestId('results-marker-1'));
    await screen.findByTestId('dialog-listing-1');
    await user.keyboard('{Escape}'); // aucun clic dans la fiche : le marquage vient de l'ouverture depuis la carte
    expect(await screen.findByTestId('results-marker-1')).toHaveAttribute('data-viewed', 'true');
    expect(screen.getByTestId('results-marker-2')).toHaveAttribute('data-viewed', 'false');
    expect(screen.getByTestId('card-listing-1')).toHaveTextContent(/déjà consultée/i);
  });

  it('les lieux de vie localisés de la demande sont repérés sur la carte, pas ceux dont l’adresse est introuvable', async () => {
    const user = userEvent.setup();
    const base = search();
    api.state.data = search({ listings: placed, criteria: { ...base.criteria, places: [
      { id: 'place-1', label: 'Travail', kind: 'work', address: 'gare Lille Flandres', lat: 50.6366, lng: 3.0706, resolved: 'Gare Lille Flandres' },
      { id: 'place-2', label: 'École', kind: 'school', address: '12 rue Inconnue', lat: null, lng: null, resolved: null },
    ] } });
    renderPage();
    await user.click(screen.getByTestId('button-open-results-map'));
    expect(await screen.findByTestId('results-map-canvas')).toHaveAttribute('data-places', 'place-1');
  });

  it('pendant une recherche en cours, ni bouton ni carte', () => {
    api.state.data = search({ status: 'running', stage: 'searching', listings: placed });
    renderPage();
    expect(screen.queryByTestId('button-open-results-map')).not.toBeInTheDocument();
  });
});
