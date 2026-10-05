import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/components/auth-gate';
import { matchLabel } from '@/components/match-gauge';
import type { HousingListing } from '@workspace/api-client-react';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import SearchDetail, { RotatingMessage } from '@/pages/search-detail';
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

/** Compte connecté simulé : adresse et e-mails de la veille. */
const account = { email: 'marie@example.com' as string | null, mailAlerts: true, setMailAlerts: vi.fn(async () => undefined), logout: async () => undefined };
function renderPage(path = '/searches/1') {
  const { hook } = memoryLocation({ path });
  return render(<AuthContext.Provider value={account}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Router hook={hook}><Route path="/searches/:id" component={SearchDetail}/></Router></QueryClientProvider></AuthContext.Provider>);
}
const cardOrder = () => screen.getAllByTestId(/^card-listing-\d+$/).map(card => card.getAttribute('data-testid')!.replace('card-listing-', ''));

beforeEach(() => {
  resetListingInteractionsCache();
  api.state.data = search(); api.state.isLoading = false; api.state.isError = false;
  api.refresh.mockReset(); api.create.mockReset();
  account.email = 'marie@example.com'; account.mailAlerts = true; account.setMailAlerts.mockClear();
  mockFetch(favoriteRoutes());
});

describe('Page résultats : contenu', () => {
  it('affiche la ville, la demande, le nombre d’annonces et l’état de la recherche', () => {
    renderPage();
    expect(screen.getByTestId('text-search-location')).toHaveTextContent('Lille');
    expect(screen.getByTestId('text-search-prompt')).toHaveTextContent('Un studio à Lille, 700 € max, chat accepté');
    expect(screen.getByTestId('text-search-location')).toHaveTextContent('Lille · 3 annonces');
    expect(screen.queryByTestId('status-search-detail')).not.toBeInTheDocument(); // terminée : rien à dire
    expect(screen.getByTestId('text-live-window')).toHaveTextContent('Lancée le');
  });

  it('en-tête compact : Modifier, Carte, Étendre dans cet ordre, puis le tri en dessous', () => {
    api.state.data = search({ listings: [listing(1, { lat: 50.63, lng: 3.06, geoPrecision: 'streetNumber' }), listing(2)] });
    renderPage();
    const actions = screen.getByTestId('results-actions');
    expect([...actions.querySelectorAll('[data-testid]')].map(item => item.getAttribute('data-testid')).filter(id => id?.startsWith('button-')))
      .toEqual(['button-edit-prompt', 'button-open-results-map', 'button-refresh']);
    const sort = screen.getByTestId('select-sort');
    expect(actions).not.toContainElement(sort);
    expect(actions.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const gone of ['Le résultat', 'annonces à explorer', 'Vos annonces', 'Recherche terminée']) expect(document.body).not.toHaveTextContent(gone);
  });

  it('recherche en cours : l’état le dit, sans actions', () => {
    api.state.data = search({ status: 'running', stage: 'searching', listings: [], count: 0 });
    renderPage();
    expect(screen.getByTestId('status-search-detail')).toHaveTextContent('Recherche en cours');
    expect(screen.queryByTestId('results-actions')).not.toBeInTheDocument();
  });

  it('chaque carte montre prix, surface, pièces et localisation avec une icône, et le critère « non précisé »', () => {
    renderPage();
    const card = screen.getByTestId('card-listing-1');
    expect(within(card).getByTestId('card-general-1-Prix')).toHaveTextContent('600');
    for (const label of ['Prix', 'Surface', 'Pièces', 'Localisation']) {
      const tile = within(card).getByTestId(`card-general-1-${label}`);
      expect(tile.querySelector('svg')).not.toBeNull();
    }
    expect(within(card).getByTestId('card-criterion-1-wish-1')).toHaveTextContent(/à vérifier/i);
  });

  it('carte allégée : critères puis atouts confirmés en une rangée de pastilles, sans titres, ni rang · site, ni lien « Détails, sources et preuves »', () => {
    api.state.data = search({ listings: [listing(1, { features: [
      { label: 'Meublé', value: '', source: 'annonce', evidence: '' },
      { label: 'Cachet', value: '', source: 'ia', evidence: 'charmant' },
      { label: 'Parking', value: '', source: 'annonce', evidence: '' },
      { label: 'Ascenseur', value: 'Oui', source: 'annonce', evidence: '' },
      { label: 'Dernier étage', value: '', source: 'annonce', evidence: '' },
      { label: 'Vue dégagée', value: '', source: 'ia', evidence: 'vue sur Fourvière' },
      { label: 'Terrasse', value: '', source: 'ia', evidence: 'terrasse de 10 m2' },
    ] })] });
    renderPage();
    const card = screen.getByTestId('card-listing-1');
    for (const gone of ['Vos critères', 'Autres caractéristiques', 'Détails, sources et preuves', '01 ·', 'dans le détail']) expect(card).not.toHaveTextContent(gone);
    const chips = within(screen.getByTestId('card-facts-1')).getAllByRole('listitem').map(item => item.textContent);
    // Le critère passe en premier (statut lu par les lecteurs d’écran), puis les atouts du plus parlant au moins parlant
    // (extérieur, vue, dernier étage, ascenseur, parking, meublé, cachet) ; 6 pastilles au plus.
    expect(chips).toEqual(['chat accepté : à vérifier', 'Terrasse', 'Vue dégagée', 'Dernier étage', 'Ascenseur', 'Parking', '+2']);
    expect(within(card).getByTestId('card-feature-1-0').querySelector('svg')).not.toBeNull();
  });

  it('carte : jamais de « non », ni de caractéristique anodine ; « à vérifier » seulement pour un critère demandé', () => {
    api.state.data = search({ listings: [listing(1, { features: [
      { label: 'Ascenseur', value: 'Non', source: 'annonce', evidence: '' },
      { label: 'Animaux acceptés', value: 'Non', source: 'ia', evidence: 'animaux non acceptés' },
      { label: 'Étage', value: '3', source: 'annonce', evidence: '' },
      { label: 'Chambres', value: '1 ch.', source: 'annonce', evidence: '' },
      { label: 'Classe énergie', value: 'd', source: 'annonce', evidence: '' },
      { label: 'Lave-vaisselle', value: '', source: 'ia', evidence: 'lave-vaisselle' },
      { label: 'Cave', value: '', source: 'ia', evidence: 'cave' },
    ] })] });
    renderPage();
    const chips = within(screen.getByTestId('card-facts-1')).getAllByRole('listitem').map(item => item.textContent);
    // Seul le critère demandé ; le reste est dans la fiche.
    expect(chips).toEqual(['chat accepté : à vérifier']);
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
    expect(edit).toHaveTextContent('Modifier');
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

  it('vocabulaire simplifié : ni numéro de recherche, ni classement interne des critères (« Où on cherche… »)', () => {
    renderPage();
    for (const gone of ['Recherche n°', 'Où on cherche les critères', 'Parfois indiqué', 'À lire dans la description', 'Indiqué dans l’annonce', 'pertinence'])
      expect(document.body).not.toHaveTextContent(gone);
    expect(screen.getByText(/La jauge de correspondance aide à parcourir les annonces/)).toBeInTheDocument();
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
  it('tri par défaut « Plus récentes » (sans date : la pertinence), puis par prix croissant sur demande', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { score: 60, price: 900 }), listing(2, { score: 90, price: 700 }), listing(3, { score: 75, price: 500 })] });
    renderPage();
    expect(cardOrder()).toEqual(['2', '3', '1']); // sans date (anciennes recherches) : « Plus récentes » suit la pertinence
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
    await user.click(screen.getByTestId('gauge-card-1'));
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
  });

  it('la fiche détaillée ouverte non plus : statut des critères en mots simples, sans dire où l’information a été trouvée', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [rich()] });
    renderPage();
    await user.click(screen.getByTestId('text-listing-title-1'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).not.toMatch(jargon);
    expect(within(dialog).getAllByText(/^(Confirmé|Ne correspond pas|À vérifier)$/).length).toBeGreaterThan(0);
    expect(dialog).not.toHaveTextContent(/Indiqué dans l’annonce|Lu dans la description|points|pertinence|0[1-3] \//);
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

  it('critères : libellé et statut seulement, sans justificatif ni avertissement', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { criterionResults: [
      { id: 'wish-1', label: 'chat accepté', status: 'confirmed', source: 'description', value: 'oui', evidence: 'les chats sont les bienvenus' },
    ] })], criteria: { ...search().criteria, checks: [...checks, { id: 'wish-2', label: 'balcon', availability: 'description', apiField: null }] } });
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    const dialog = await screen.findByTestId('dialog-listing-1');
    const cat = within(dialog).getByTestId('criterion-result-1-wish-1');
    expect(cat).toHaveTextContent('chat accepté');
    expect(within(cat).getByTestId('status-criterion-1-wish-1')).toHaveTextContent('Confirmé');
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
    // Par thème (extérieur, puis immeuble) ; dans un thème, ce qui manque est barré, en dernier.
    expect(items.map(item => item.textContent)).toEqual(['Balcon', '3e étage', 'Ascenseur : absent']);
    expect(within(features).getAllByRole('heading').map(heading => heading.textContent)).toEqual(['Extérieur et annexes', 'Immeuble']);
    expect(items.every(item => item.querySelector('svg'))).toBe(true);
    expect(items[2].querySelector('.line-through')).toHaveTextContent('Ascenseur');
    expect(features).not.toHaveTextContent(/plein sud|floor_number|Lu dans la description|Indiqué dans l’annonce|Extrait/);
  });

  it('caractéristiques par thème : un thème sans élément n\'apparaît pas, le ressenti et les conditions ont leur place', async () => {
    const user = userEvent.setup();
    api.state.data = search({ listings: [listing(1, { features: [
      { label: 'Meublé', value: '', source: 'annonce', evidence: '' },
      { label: 'Lumineux', value: '', source: 'ia', evidence: 'très lumineux' },
      { label: 'Proche transports', value: '', source: 'ia', evidence: 'métro à 3 min' },
      { label: 'Duplex', value: '', source: 'ia', evidence: 'duplex' },
      { label: 'Vue dégagée', value: '', source: 'ia', evidence: 'vue sur Fourvière' },
    ] })] });
    renderPage();
    await user.click(screen.getByTestId('button-open-listing-1'));
    const features = within(await screen.findByTestId('dialog-listing-1')).getByTestId('features-1');
    expect(within(features).getAllByRole('heading').map(heading => heading.textContent)).toEqual(['Extérieur et annexes', 'Intérieur', 'Quartier', 'Conditions']);
    expect(within(within(features).getByTestId('features-group-1-inside')).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Lumineux', 'Duplex']);
    expect(within(within(features).getByTestId('features-group-1-outside')).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Vue dégagée']);
    expect(within(features).queryByTestId('features-group-1-building')).toBeNull();
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

  it('critères de la fiche en badges, comme sur la carte : couleur et mot selon le statut', async () => {
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
    expect(badge).toHaveTextContent('chat accepté · Ne correspond pas');
  });
});

describe('Page résultats : chargement progressif', () => {
  const many = (n: number, overrides: (i: number) => Partial<HousingListing> = () => ({})) =>
    search({ count: n, listings: Array.from({ length: n }, (_, i) => listing(i + 1, { score: 99 - i, ...overrides(i) })) });
  const cards = () => screen.getAllByTestId(/^card-listing-\d+$/).length;

  it('20 annonces d’abord ; en bas, l’indicateur rose puis les 20 suivantes, jusqu’à la dernière', async () => {
    const user = userEvent.setup();
    api.state.data = many(45);
    renderPage();
    expect(cards()).toBe(20);
    expect(screen.getByTestId('text-listing-count')).toHaveTextContent('45 annonces');
    await user.click(screen.getByTestId('button-load-more'));
    expect(screen.getByTestId('results-loader-message')).toHaveTextContent('Nous chargeons les annonces suivantes pour vous');
    expect(screen.getByTestId('results-loader').querySelector('.spin-arc')?.className).toContain('border-t-brand');
    await waitFor(() => expect(cards()).toBe(40));
    expect(screen.getByTestId('button-load-more')).toHaveTextContent('Afficher 5 annonces de plus');
    await user.click(screen.getByTestId('button-load-more'));
    await waitFor(() => expect(cards()).toBe(45));
    expect(screen.queryByTestId('results-load-more')).not.toBeInTheDocument();
  });

  it('les 20 suivantes pas encore lues par l’IA : analyse demandée, indicateur jusqu’à ce qu’elles soient prêtes', async () => {
    const user = userEvent.setup();
    const calls = mockFetch([...favoriteRoutes(), { method: 'POST', match: /\/analyze$/, respond: () => ({ status: 202, body: search() }) }]);
    api.state.data = many(30, i => ({ analyzed: i < 20, aiSummary: i < 20 ? 'Lu.' : null }));
    const view = renderPage();
    await user.click(screen.getByTestId('button-load-more'));
    await waitFor(() => expect(calls.find(call => call.url.endsWith('/analyze'))?.body).toEqual({ listingIds: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30] }));
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(cards()).toBe(20);
    expect(screen.getByTestId('results-loader')).toBeInTheDocument();
    // L'IA a fini : la page relue les montre.
    api.state.data = many(30);
    view.rerender(view.container.firstChild ? <AuthContext.Provider value={account}><QueryClientProvider client={new QueryClient()}><Router hook={memoryLocation({ path: '/searches/1' }).hook}><Route path="/searches/:id" component={SearchDetail}/></Router></QueryClientProvider></AuthContext.Provider> : <></>);
    await waitFor(() => expect(cards()).toBe(30));
  });

  it('le message de l’indicateur change toutes les 3 à 4 secondes', () => {
    vi.useFakeTimers();
    try {
      render(<RotatingMessage messages={['un', 'deux', 'trois']} testId="m"/>);
      expect(screen.getByTestId('m')).toHaveTextContent('un');
      act(() => { vi.advanceTimersByTime(3_500); });
      expect(screen.getByTestId('m')).toHaveTextContent('deux');
      act(() => { vi.advanceTimersByTime(7_000); });
      expect(screen.getByTestId('m')).toHaveTextContent('un');
    } finally { vi.useRealTimers(); }
  });

  it('le bas de liste qui devient visible déclenche le chargement, sans clic', async () => {
    let trigger: (visible: boolean) => void = () => {};
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { trigger = visible => callback([{ isIntersecting: visible }]); }
      observe() {} disconnect() {}
    });
    try {
      api.state.data = many(28);
      renderPage();
      expect(cards()).toBe(20);
      act(() => trigger(true));
      await waitFor(() => expect(cards()).toBe(28));
    } finally { vi.unstubAllGlobals(); }
  });

  it('peu d’annonces : ni indicateur ni bouton', () => {
    api.state.data = many(15);
    renderPage();
    expect(cards()).toBe(15);
    expect(screen.queryByTestId('results-load-more')).not.toBeInTheDocument();
  });

  it('une annonce pas encore affichée choisie sur la carte apparaît dans la liste et sa fiche s’ouvre', async () => {
    const user = userEvent.setup();
    api.state.data = many(30, i => ({ lat: 50.63 + i / 1000, lng: 3.06, geoPrecision: 'streetNumber' }));
    renderPage();
    expect(screen.queryByTestId('card-listing-27')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('button-open-results-map'));
    await user.click(await screen.findByTestId('results-marker-27'));
    expect(await screen.findByTestId('dialog-listing-27')).toBeInTheDocument();
    expect(screen.getByTestId('card-listing-27')).toBeInTheDocument();
  });
});

describe('Page résultats : veille quotidienne et lecture progressive', () => {
  const watchRoutes = (other: object | null = null): FetchRoute[] => [
    ...favoriteRoutes(),
    { match: /\/api\/housing\/watch$/, respond: () => ({ body: { search: other } }) },
    { method: 'PUT', match: /\/api\/housing\/searches\/1\/watch$/, respond: () => ({ body: { ...search(), watch: 'active', watchTimes: ['08:00', '18:00'] } }) },
    { method: 'DELETE', match: /\/api\/housing\/searches\/1\/watch$/, respond: () => ({ body: { ...search(), watch: null } }) },
    { method: 'POST', match: /\/api\/housing\/searches\/1\/visit$/, respond: () => ({ status: 204 }) },
    { method: 'POST', match: /\/api\/housing\/searches\/1\/analyze$/, respond: () => ({ status: 202, body: search() }) },
  ];

  it('recherche ponctuelle : « Créer une veille quotidienne » ouvre une fenêtre qui explique, puis l’active à 8 h et 18 h', async () => {
    const user = userEvent.setup();
    const calls = mockFetch(watchRoutes());
    renderPage();
    expect(screen.getByTestId('text-watch-status')).toHaveTextContent('Veille quotidienne');
    expect(screen.getByTestId('text-watch-status')).toHaveTextContent('Pour être prévenu des nouvelles annonces de cette recherche chaque jour, activez la veille quotidienne.');
    await user.click(screen.getByTestId('button-watch'));
    const dialog = await screen.findByTestId('dialog-watch');
    const explanation = within(dialog).getByTestId('watch-explanation');
    for (const point of ['Dès le début, toutes les annonces des 4 derniers jours sont récupérées.', 'seulement les nouvelles annonces', 'pastille rose',
      'Un e-mail vous est envoyé à marie@example.com à chaque relève qui trouve de nouveaux logements.']) expect(explanation).toHaveTextContent(point);
    for (const gone of ['remontée', 'republiée', '7 jours', 'ne coûte rien', '105']) expect(explanation).not.toHaveTextContent(gone);
    expect(within(explanation).getAllByRole('listitem')).toHaveLength(4);
    expect(within(dialog).getByTestId('input-watch-time-0')).toHaveValue('08:00');
    expect(within(dialog).getByTestId('input-watch-time-1')).toHaveValue('18:00');
    expect(calls.some(call => call.method === 'PUT')).toBe(false);
    await user.click(within(dialog).getByTestId('button-confirm-watch'));
    await waitFor(() => expect(calls.find(call => call.method === 'PUT')?.body).toEqual({ times: ['08:00', '18:00'] }));
    await waitFor(() => expect(screen.queryByTestId('dialog-watch')).not.toBeInTheDocument());
  });

  it('un seul horaire possible ; « Annuler » ne change rien', async () => {
    const user = userEvent.setup();
    const calls = mockFetch(watchRoutes());
    renderPage();
    await user.click(screen.getByTestId('button-watch'));
    await user.click(within(await screen.findByTestId('dialog-watch')).getByRole('button', { name: 'Annuler' }));
    expect(calls.some(call => call.method === 'PUT')).toBe(false);
    await user.click(screen.getByTestId('button-watch'));
    const dialog = await screen.findByTestId('dialog-watch');
    await user.selectOptions(within(dialog).getByTestId('input-watch-time-1'), '');
    await user.selectOptions(within(dialog).getByTestId('input-watch-time-0'), '07:30');
    await user.click(within(dialog).getByTestId('button-confirm-watch'));
    await waitFor(() => expect(calls.find(call => call.method === 'PUT')?.body).toEqual({ times: ['07:30'] }));
  });

  it('une autre recherche est déjà suivie : la fenêtre dit qu’elle sera remplacée', async () => {
    const user = userEvent.setup();
    mockFetch(watchRoutes({ ...search({ id: 9 }), criteria: { ...search().criteria, location: 'Lyon' }, watch: 'active', watchTimes: ['08:00'] }));
    renderPage();
    await waitFor(async () => {
      await user.click(screen.getByTestId('button-watch'));
      expect(await screen.findByTestId('text-watch-replace')).toHaveTextContent('« Lyon » s’arrêtera et redeviendra une recherche ponctuelle');
    });
    expect(screen.getByTestId('button-confirm-watch')).toHaveTextContent('Remplacer et activer celle-ci');
  });

  it('veille quotidienne : ligne discrète (heures, prochain passage, Arrêter) ; la visite est notée ; les nouvelles sont marquées', async () => {
    const user = userEvent.setup();
    const calls = mockFetch(watchRoutes());
    api.state.data = search({ watch: 'active', watchTimes: ['08:00', '18:00'], nextWatchAt: new Date(Date.now() + 3_600_000).toISOString(), lastVisitedAt: '2026-10-01T06:00:00Z',
      listings: [listing(1, { firstSeenAt: '2026-10-01T06:05:00Z' }), listing(2, { firstSeenAt: '2026-10-01T05:00:00Z' }), listing(3, { firstSeenAt: '2026-10-01T06:10:00Z' })] });
    renderPage();
    expect(screen.getByTestId('text-watch-status')).toHaveTextContent('Veille quotidienne · chaque jour à 8 h et 18 h · prochain passage');
    expect(screen.getByTestId('text-new-count')).toHaveTextContent('2 nouvelles annonces depuis votre dernière visite');
    expect(screen.getByTestId('badge-new-1')).toHaveTextContent('Nouvelle');
    expect(screen.queryByTestId('badge-new-2')).not.toBeInTheDocument();
    await waitFor(() => expect(calls.some(call => call.method === 'POST' && call.url.endsWith('/visit'))).toBe(true));
    await user.click(screen.getByTestId('button-unwatch'));
    await waitFor(() => expect(calls.some(call => call.method === 'DELETE')).toBe(true));
  });

  it('veille quotidienne : « Modifier » oui, « Étendre » non ; « nouvelles annonces » en rose sur fond rose clair', () => {
    mockFetch(watchRoutes());
    api.state.data = search({ watch: 'active', watchTimes: ['08:00', '18:00'], lastVisitedAt: '2026-10-01T06:00:00Z',
      listings: [listing(1, { firstSeenAt: '2026-10-01T06:05:00Z' })] });
    renderPage();
    expect(screen.getByTestId('button-edit-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('button-refresh')).not.toBeInTheDocument();
    expect(screen.getByTestId('select-sort')).toBeInTheDocument();
    expect(screen.getByTestId('text-new-count').className).toContain('text-brand-dark');
    expect(screen.getByTestId('text-new-count').className).toContain('bg-lime-wash');
    expect(screen.getByTestId('text-new-count').className).not.toContain('text-moss');
  });

  it('un trait marque la fin des annonces de la dernière relève (avec son heure), seulement en tri « Plus récentes »', async () => {
    const user = userEvent.setup();
    mockFetch(watchRoutes());
    const relève = new Date(Date.now() - 3_600_000);
    const seen = (minutes: number) => new Date(relève.getTime() + minutes * 60_000).toISOString();
    api.state.data = search({ watch: 'active', watchTimes: ['08:00', '18:00'], lastVisitedAt: seen(-1), lastWatchAt: relève.toISOString(), listings: [
      listing(1, { firstSeenAt: seen(-600) }), listing(2, { firstSeenAt: seen(0) }), listing(3, { firstSeenAt: seen(-600) }), listing(4, { firstSeenAt: seen(0) }),
    ] });
    renderPage();
    expect(cardOrder()).toEqual(['2', '4', '1', '3']);
    const line = screen.getByTestId('separator-release');
    expect(line).toHaveTextContent(/^Fin de la dernière relève · (aujourd’hui|hier) à \d\d:\d\d$/);
    // Juste après la dernière annonce de la relève, juste avant la première plus ancienne.
    expect(screen.getByTestId('card-listing-4').compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(screen.getByTestId('card-listing-1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.selectOptions(screen.getByTestId('select-sort'), 'price');
    expect(screen.queryByTestId('separator-release')).not.toBeInTheDocument();
  });

  it('dernière relève sans rien de nouveau : le trait le dit, en tête de liste', () => {
    mockFetch(watchRoutes());
    api.state.data = search({ watch: 'active', watchTimes: ['08:00'], lastWatchAt: new Date().toISOString(),
      listings: [listing(1, { firstSeenAt: '2026-09-30T06:00:00Z' })] });
    renderPage();
    expect(screen.getByTestId('separator-release')).toHaveTextContent(/^Relève (aujourd’hui|hier) à \d\d:\d\d : aucune nouvelle annonce$/);
  });

  it('recherche ponctuelle : ni trait de relève, et « Modifier ma demande » et « Étendre » restent', () => {
    mockFetch(watchRoutes());
    renderPage();
    expect(screen.queryByTestId('separator-release')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-edit-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('button-refresh')).toBeInTheDocument();
  });

  it('recherche ponctuelle : pas de « Nouvelle », pas de visite notée', async () => {
    const calls = mockFetch(watchRoutes());
    api.state.data = search({ listings: [listing(1, { firstSeenAt: '2026-10-01T06:05:00Z' })] });
    renderPage();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByTestId('badge-new-1')).not.toBeInTheDocument();
    expect(calls.some(call => call.url.endsWith('/visit'))).toBe(false);
  });

  it('annonces affichées mais pas encore lues par l’IA (arrivées par un passage) : analyse demandée, une seule fois', async () => {
    const calls = mockFetch(watchRoutes());
    api.state.data = search({ count: 14, listings: Array.from({ length: 14 }, (_, i) => listing(i + 1, { score: 99 - i, analyzed: i < 3, aiSummary: i < 3 ? 'Lu.' : null })) });
    renderPage();
    expect(screen.getByTestId('card-analyzing-4')).toHaveTextContent('Lecture de l’annonce par l’IA');
    expect(screen.queryByTestId('card-analyzing-1')).not.toBeInTheDocument();
    await waitFor(() => expect(calls.filter(call => call.url.endsWith('/analyze'))).toHaveLength(1));
    expect(calls.find(call => call.url.endsWith('/analyze'))?.body).toEqual({ listingIds: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] });
  });

  it('dates : « Publiée il y a… », et une annonce remontée le dit ; tri par défaut : les plus récentes', () => {
    mockFetch(watchRoutes());
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    api.state.data = search({ listings: [
      listing(1, { score: 99, postedAt: hoursAgo(5), refreshedAt: hoursAgo(5) }),
      listing(2, { score: 10, postedAt: hoursAgo(24 * 9), refreshedAt: hoursAgo(1) }),
      listing(3, { score: 50, postedAt: hoursAgo(3), refreshedAt: hoursAgo(3) }),
    ] });
    renderPage();
    expect(screen.getByTestId('select-sort')).toHaveValue('recent');
    expect(cardOrder()).toEqual(['3', '1', '2']); // publiée récemment d’abord ; l’ancienne remontée ne repasse pas devant
    expect(screen.getByTestId('text-listing-date-1')).toHaveTextContent('Publiée il y a 5 h');
    expect(screen.getByTestId('text-listing-date-2')).toHaveTextContent(/^Remontée il y a 1 h · publiée le /);
    expect(screen.getByTestId('text-live-window')).toHaveTextContent('Recherche ponctuelle : les annonces les plus récentes');
  });

  it('« Étendre » en cours : indicateur en bas de liste, bouton désactivé', () => {
    mockFetch(watchRoutes());
    api.state.data = search({ task: 'extend' });
    renderPage();
    expect(screen.getByTestId('results-extending')).toHaveTextContent('Recherche d’annonces plus anciennes');
    expect(screen.getByTestId('button-refresh')).toBeDisabled();
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
    expect(button).toHaveTextContent(/^Carte\s*\d*$/);
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

describe('Veille quotidienne : e-mails et issue de la dernière relève', () => {
  const routes = (): FetchRoute[] => [
    ...favoriteRoutes(),
    { match: /\/api\/housing\/watch$/, respond: () => ({ body: { search: null } }) },
    { method: 'POST', match: /\/api\/housing\/searches\/1\/visit$/, respond: () => ({ status: 204 }) },
  ];
  const active = (overrides = {}) => search({ watch: 'active', watchTimes: ['08:00'], nextWatchAt: new Date(Date.now() + 3_600_000).toISOString(), ...overrides });

  it('la fenêtre dit « votre adresse d’inscription » si l’adresse n’est pas connue, et ne promet pas d’e-mail à un compte désinscrit', async () => {
    const user = userEvent.setup();
    mockFetch(routes());
    account.email = null;
    const { unmount } = renderPage();
    await user.click(screen.getByTestId('button-watch'));
    expect(within(await screen.findByTestId('watch-explanation')).getByText(/votre adresse d’inscription/)).toBeInTheDocument();
    unmount();
    account.email = 'marie@example.com'; account.mailAlerts = false;
    renderPage();
    await user.click(screen.getByTestId('button-watch'));
    const explanation = await screen.findByTestId('watch-explanation');
    expect(explanation).toHaveTextContent('Les e-mails sont désactivés pour votre compte');
    expect(explanation).not.toHaveTextContent('vous est envoyé');
  });

  it('veille active : l’adresse qui reçoit les e-mails est rappelée', () => {
    mockFetch(routes());
    api.state.data = active();
    renderPage();
    expect(screen.getByTestId('text-watch-mail')).toHaveTextContent('E-mail à marie@example.com à chaque relève qui trouve du nouveau');
    expect(screen.queryByTestId('button-enable-mails')).not.toBeInTheDocument();
  });

  it('e-mails désactivés (lien de désinscription) : « Réactiver les e-mails » les relance', async () => {
    const user = userEvent.setup();
    mockFetch(routes());
    account.mailAlerts = false;
    api.state.data = active();
    renderPage();
    expect(screen.getByTestId('text-watch-mail')).toHaveTextContent('E-mails désactivés');
    await user.click(screen.getByTestId('button-enable-mails'));
    expect(account.setMailAlerts).toHaveBeenCalledWith(true);
  });

  it('réactivation impossible : un message, pas d’erreur muette', async () => {
    const user = userEvent.setup();
    mockFetch(routes());
    account.mailAlerts = false;
    account.setMailAlerts.mockRejectedValueOnce(new Error('panne'));
    api.state.data = active();
    renderPage();
    await user.click(screen.getByTestId('button-enable-mails'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de réactiver les e-mails');
  });

  it('dernière relève en échec ou incomplète : dit sur la ligne de la veille ; rien quand tout va bien', () => {
    mockFetch(routes());
    api.state.data = active({ lastWatchStatus: 'failed' });
    const { unmount } = renderPage();
    expect(screen.getByTestId('text-watch-outcome')).toHaveTextContent('La dernière relève n’a pas abouti. Nouvel essai au prochain passage.');
    unmount();
    api.state.data = active({ lastWatchStatus: 'partial' });
    const second = renderPage();
    expect(screen.getByTestId('text-watch-outcome')).toHaveTextContent('Recherche très large');
    second.unmount();
    api.state.data = active({ lastWatchStatus: 'ok' });
    renderPage();
    expect(screen.queryByTestId('text-watch-outcome')).not.toBeInTheDocument();
  });
});

describe('Jauge de correspondance', () => {
  it('carte et fiche : un anneau proportionnel au score, le score au centre ; la fiche dit en mots ce qu’il vaut', async () => {
    const user = userEvent.setup();
    mockFetch(favoriteRoutes());
    api.state.data = search({ listings: [listing(1, { score: 84 }), listing(2, { score: 25 })] });
    renderPage();
    const gauge = screen.getByTestId('gauge-card-1');
    expect(within(gauge).getByRole('img')).toHaveAccessibleName('Excellente correspondance : 84 sur 100');
    expect(gauge).toHaveTextContent('84');
    const arc = (id: string) => Number(screen.getByTestId(`${id}-arc`).getAttribute('stroke-dasharray')!.split(' ')[0]);
    expect(arc('gauge-card-1') / arc('gauge-card-2')).toBeCloseTo(84 / 25, 1);
    expect(within(screen.getByTestId('gauge-card-2')).getByRole('img')).toHaveAccessibleName('Faible correspondance : 25 sur 100');
    await user.click(screen.getByTestId('button-open-listing-1'));
    const detail = within(await screen.findByTestId('dialog-listing-1')).getByTestId('gauge-detail-1');
    expect(detail).toHaveTextContent('84Excellente correspondance');
  });

  it('les mots suivent le score : 80 et plus, 60 et plus, 40 et plus, en dessous', () => {
    expect([95, 80, 79, 60, 59, 40, 39, 0].map(matchLabel)).toEqual([
      'Excellente correspondance', 'Excellente correspondance', 'Bonne correspondance', 'Bonne correspondance',
      'Correspondance partielle', 'Correspondance partielle', 'Faible correspondance', 'Faible correspondance',
    ]);
  });
});

describe('Lien d’un e-mail vers une annonce', () => {
  it('/searches/1?annonce=24 : la fiche de l’annonce s’ouvre, même plus bas que les 20 premières ; l’adresse redevient /searches/1', async () => {
    mockFetch(favoriteRoutes());
    const many = Array.from({ length: 25 }, (_, i) => listing(i + 1, { score: 90 - i }));
    api.state.data = search({ listings: many });
    window.history.replaceState(null, '', '/searches/1?annonce=24');
    renderPage('/searches/1');
    expect(await screen.findByTestId('dialog-listing-24')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    window.history.replaceState(null, '', '/');
  });

  it('annonce retirée depuis l’e-mail : la liste s’affiche, sans fiche ni erreur', async () => {
    mockFetch(favoriteRoutes());
    window.history.replaceState(null, '', '/searches/1?annonce=999');
    renderPage('/searches/1');
    expect(screen.getByTestId('card-listing-1')).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
    window.history.replaceState(null, '', '/');
  });
});

describe('Mise en place de la veille : progression réelle', () => {
  it('barre en segments (pages lues, page en cours), annonces déjà trouvées, message qui change', () => {
    mockFetch(favoriteRoutes());
    api.state.data = search({ watch: 'active', watchTimes: ['08:00'], task: 'backfill', count: 41, readProgress: { page: 2, maxPages: 3 } });
    renderPage();
    const block = screen.getByTestId('results-backfill');
    expect(block).toHaveTextContent('Mise en place de votre veille');
    expect(screen.getByTestId('backfill-found')).toHaveTextContent('41 annonces trouvées');
    expect(screen.getByTestId('backfill-page')).toHaveTextContent('Page 2 sur 3 au plus');
    expect([1, 2, 3].map(n => screen.getByTestId(`backfill-segment-${n}`).dataset.state)).toEqual(['done', 'current', 'todo']);
    expect(block).toHaveTextContent('Nous rassemblons les annonces des 4 derniers jours…');
  });

  it('pas de lecture en cours : plus de bloc', () => {
    mockFetch(favoriteRoutes());
    api.state.data = search({ watch: 'active', watchTimes: ['08:00'], task: null, readProgress: null });
    renderPage();
    expect(screen.queryByTestId('results-backfill')).not.toBeInTheDocument();
  });
});

describe('Modifier la demande d’une veille quotidienne', () => {
  it('le champ prévient que la veille suivra la nouvelle demande ; la relance la déplace (watchFrom), aux mêmes heures', async () => {
    const user = userEvent.setup();
    mockFetch(favoriteRoutes());
    api.create.mockResolvedValue(search({ id: 2, watch: 'active', watchTimes: ['08:00', '18:00'] }));
    api.state.data = search({ watch: 'active', watchTimes: ['08:00', '18:00'] });
    renderPage();
    await user.click(screen.getByTestId('button-edit-prompt'));
    expect(screen.getByTestId('text-edit-prompt-note')).toHaveTextContent('votre veille quotidienne la suivra, aux mêmes heures');
    const field = screen.getByTestId('input-edit-prompt');
    await user.clear(field);
    await user.type(field, 'Un T2 à Lille, 900 € max, balcon');
    await user.click(screen.getByTestId('button-relaunch-search'));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ data: { prompt: 'Un T2 à Lille, 900 € max, balcon', watchFrom: 1 } }));
  });

  it('recherche ponctuelle : pas de watchFrom, message habituel', async () => {
    const user = userEvent.setup();
    mockFetch(favoriteRoutes());
    api.create.mockResolvedValue(search({ id: 2 }));
    renderPage();
    await user.click(screen.getByTestId('button-edit-prompt'));
    expect(screen.getByTestId('text-edit-prompt-note')).toHaveTextContent('Modifiez votre demande et lancez une nouvelle recherche');
    await user.click(screen.getByTestId('button-relaunch-search'));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ data: { prompt: 'Un studio à Lille, 700 € max, chat accepté' } }));
  });
});
