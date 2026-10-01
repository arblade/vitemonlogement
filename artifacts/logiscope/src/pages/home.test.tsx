import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Home from '@/pages/home';
import { search } from '@/test/fixtures';

const api = vi.hoisted(() => ({ watched: null as unknown, mutateAsync: vi.fn(), history: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() } }));
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...(await importOriginal<typeof import('@workspace/api-client-react')>()),
  useCreateHousingSearch: () => ({ mutateAsync: api.mutateAsync, isPending: false }),
  useListHousingSearches: () => api.history,
  useGetWatchedSearch: () => ({ data: { search: api.watched } }),
}));

function renderHome() {
  const { hook, history } = memoryLocation({ path: '/', record: true });
  render(<QueryClientProvider client={new QueryClient()}><Router hook={hook}><Home/></Router></QueryClientProvider>);
  return history;
}
const field = () => screen.getByLabelText('Décrivez votre recherche');

beforeEach(() => { api.watched = null; api.mutateAsync.mockReset(); api.history.data = []; api.history.isLoading = false; api.history.isError = false; });

describe('Accueil', () => {
  it('explique le concept : promesse, trois étapes et trois exemples', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trouvez votre prochain chez');
    for (const step of ['Vous décrivez', 'On cherche et on vérifie', 'Vous choisissez']) expect(screen.getByRole('heading', { name: step })).toBeInTheDocument();
    expect(screen.getAllByTestId(/button-suggestion-/)).toHaveLength(3);
  });

  it('un exemple pré-remplit le champ', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByTestId('button-suggestion-1'));
    expect(field()).toHaveValue('Un T2 à Lyon, 1 200 € maximum, avec ascenseur');
  });

  it('refuse une description trop courte sans appeler le serveur', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(field(), 'Lille');
    await user.click(screen.getByTestId('button-start-search'));
    expect(await screen.findByText(/au moins 10 caractères/)).toBeInTheDocument();
    expect(api.mutateAsync).not.toHaveBeenCalled();
  });

  it('Entrée lance la recherche (texte nettoyé) puis ouvre la page de la recherche', async () => {
    const user = userEvent.setup();
    api.mutateAsync.mockResolvedValue(search({ id: 42 }));
    const history = renderHome();
    await user.type(field(), '  Un studio à Lille, 700 € max  {Enter}');
    await waitFor(() => expect(api.mutateAsync).toHaveBeenCalledWith({ data: { prompt: 'Un studio à Lille, 700 € max' } }));
    await waitFor(() => expect(history?.at(-1)).toBe('/searches/42'));
  });

  it('Maj + Entrée ajoute une ligne au lieu de lancer la recherche', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(field(), 'Un studio à Lille{Shift>}{Enter}{/Shift}budget 700 euros');
    expect(api.mutateAsync).not.toHaveBeenCalled();
    expect((field() as HTMLTextAreaElement).value).toContain('\n');
  });

  it('en cas d’erreur du serveur : message affiché et description conservée', async () => {
    const user = userEvent.setup();
    api.mutateAsync.mockRejectedValue({ data: { error: 'Quota atteint, réessayez plus tard.' } });
    renderHome();
    await user.type(field(), 'Un studio à Lille, 700 € max');
    await user.click(screen.getByTestId('button-start-search'));
    expect(await screen.findByTestId('status-error')).toHaveTextContent('Quota atteint, réessayez plus tard.');
    expect(field()).toHaveValue('Un studio à Lille, 700 € max');
  });

  it('sans recherche : état vide avec invitation à commencer', () => {
    renderHome();
    expect(screen.getByText('Pas encore de recherche')).toBeInTheDocument();
    expect(screen.getByTestId('button-go-to-prompt')).toBeInTheDocument();
  });

  it('avec des recherches : ville, état (terminée / en cours) et lien vers chacune', () => {
    api.history.data = [search({ id: 7, count: 3 }), search({ id: 8, status: 'running', count: 0, criteria: { ...search().criteria, location: 'Nantes' } })];
    renderHome();
    expect(screen.getByTestId('link-search-7')).toHaveAttribute('href', '/searches/7');
    expect(screen.getByTestId('status-search-7')).toHaveTextContent('3 annonces');
    expect(screen.getByTestId('status-search-8')).toHaveTextContent('En cours');
    expect(screen.getByTestId('link-search-8')).toHaveTextContent('Nantes');
  });

  it('erreur de chargement de l’historique : message et bouton « Réessayer »', async () => {
    const user = userEvent.setup();
    api.history.isError = true;
    renderHome();
    await user.click(screen.getByTestId('button-retry'));
    expect(api.history.refetch).toHaveBeenCalled();
  });

  it('recherche suivie avec des nouveautés : un bloc bien visible en haut de l’accueil, un seul bouton pour les voir', () => {
    api.watched = { ...search({ id: 12 }), watch: 'active', watchTimes: ['08:00', '18:00'], unseenCount: 4 };
    renderHome();
    expect(screen.getByTestId('hero-new-listings')).toHaveTextContent('4 nouveaux logements à Lille');
    expect(screen.getByTestId('link-hero-new-listings')).toHaveAttribute('href', '/searches/12');
    expect(screen.getByTestId('link-hero-new-listings')).toHaveTextContent('Voir les nouveautés');
    expect(screen.queryByTestId('card-watched-search')).not.toBeInTheDocument();
  });

  it('recherche suivie à jour : une carte discrète (rien de nouveau)', () => {
    api.watched = { ...search({ id: 12 }), watch: 'active', watchTimes: ['08:00'], unseenCount: 0 };
    renderHome();
    expect(screen.queryByTestId('hero-new-listings')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-watched-unseen')).toHaveTextContent('À jour');
  });

  it('sans recherche suivie : pas de carte', () => {
    renderHome();
    expect(screen.queryByTestId('card-watched-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hero-new-listings')).not.toBeInTheDocument();
  });
});
