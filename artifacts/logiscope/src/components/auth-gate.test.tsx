import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AuthGate, UNAUTHORIZED_EVENT, useAuth } from '@/components/auth-gate';
import { mockFetch, type Route } from '@/test/fixtures';

function Inside() {
  const { email, logout } = useAuth();
  return <div><p data-testid="who">{email}</p><button onClick={() => void logout()}>Quitter</button></div>;
}
const renderGate = () => render(<QueryClientProvider client={new QueryClient()}><AuthGate><Inside/></AuthGate></QueryClientProvider>);

const loggedOut: Route = { match: /\/api\/auth\/me$/, respond: () => ({ status: 401, body: { authenticated: false } }) };
const loggedIn = (email: string): Route => ({ match: /\/api\/auth\/me$/, respond: () => ({ body: { authenticated: true, email } }) });
const invite = (valid: boolean): Route => ({ match: /\/api\/auth\/invite\?code=/, respond: () => ({ body: { valid } }) });
const fill = async (user: ReturnType<typeof userEvent.setup>, values: Record<string, string>) => {
  for (const [label, value] of Object.entries(values)) await user.type(screen.getByLabelText(label), value);
};

describe('AuthGate : connexion', () => {
  it('sans lien d’invitation : écran de connexion, pas de confirmation, inscription « sur invitation »', async () => {
    mockFetch([loggedOut]);
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Confirmer le mot de passe')).not.toBeInTheDocument();
    expect(screen.getByText(/sur invitation/i)).toBeInTheDocument();
  });

  it('déjà connecté : affiche l’application et donne l’e-mail au reste de l’interface', async () => {
    mockFetch([loggedIn('moi@example.com')]);
    renderGate();
    expect(await screen.findByTestId('who')).toHaveTextContent('moi@example.com');
  });

  it('envoie e-mail et mot de passe, puis ouvre l’application', async () => {
    const user = userEvent.setup();
    const calls = mockFetch([loggedOut, { method: 'POST', match: /\/api\/auth\/login$/, respond: () => ({ body: { authenticated: true, email: 'moi@example.com' } }) }]);
    renderGate();
    await screen.findByRole('heading', { name: 'Connexion' });
    await fill(user, { 'Adresse e-mail': 'Moi@Example.com', 'Mot de passe': 'motdepasse-1' });
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByTestId('who')).toHaveTextContent('moi@example.com');
    expect(calls.find(call => call.url.endsWith('/auth/login'))?.body).toEqual({ email: 'Moi@Example.com', password: 'motdepasse-1' });
  });

  it('affiche le message du serveur si les identifiants sont refusés, sans ouvrir l’application', async () => {
    const user = userEvent.setup();
    mockFetch([loggedOut, { method: 'POST', match: /\/api\/auth\/login$/, respond: () => ({ status: 401, body: { error: 'E-mail ou mot de passe incorrect.' } }) }]);
    renderGate();
    await screen.findByRole('heading', { name: 'Connexion' });
    await fill(user, { 'Adresse e-mail': 'moi@example.com', 'Mot de passe': 'mauvais-1' });
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou mot de passe incorrect.');
    expect(screen.queryByTestId('who')).not.toBeInTheDocument();
  });

  it('le bouton reste désactivé tant que l’e-mail ou le mot de passe manque', async () => {
    mockFetch([loggedOut]);
    renderGate();
    await screen.findByRole('heading', { name: 'Connexion' });
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeDisabled();
  });

  it('la déconnexion prévient le serveur et ramène à l’écran de connexion', async () => {
    const user = userEvent.setup();
    const calls = mockFetch([loggedIn('moi@example.com'), { method: 'POST', match: /\/api\/auth\/logout$/, respond: () => ({ status: 204 }) }]);
    renderGate();
    await user.click(await screen.findByRole('button', { name: 'Quitter' }));
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(calls.some(call => call.method === 'POST' && call.url.endsWith('/auth/logout'))).toBe(true);
  });

  it('une session expirée (401 ailleurs dans l’app) renvoie à l’écran de connexion', async () => {
    mockFetch([loggedIn('moi@example.com')]);
    renderGate();
    await screen.findByTestId('who');
    act(() => { window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)); });
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });

  it('serveur injoignable : message d’erreur et bouton « Réessayer »', async () => {
    const user = userEvent.setup();
    globalThis.fetch = (async () => { throw new Error('réseau'); }) as typeof fetch;
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur.');
    mockFetch([loggedIn('moi@example.com')]);
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByTestId('who')).toBeInTheDocument();
  });
});

describe('AuthGate : inscription par lien d’invitation', () => {
  it('lien valide : formulaire d’inscription avec confirmation du mot de passe', async () => {
    window.history.replaceState(null, '', '/?invite=Arblade');
    const calls = mockFetch([loggedOut, invite(true)]);
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Créer votre compte' })).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmer le mot de passe')).toBeInTheDocument();
    expect(calls.find(call => call.url.includes('/auth/invite'))?.url).toContain('code=Arblade');
  });

  it('lien invalide : pas d’inscription, message clair, connexion seule', async () => {
    window.history.replaceState(null, '', '/?invite=faux');
    mockFetch([loggedOut, invite(false)]);
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Ce lien d’invitation n’est pas valide.');
    expect(screen.queryByLabelText('Confirmer le mot de passe')).not.toBeInTheDocument();
  });

  it('refuse deux mots de passe différents ou trop courts sans appeler le serveur', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?invite=Arblade');
    const calls = mockFetch([loggedOut, invite(true)]);
    renderGate();
    await screen.findByRole('heading', { name: 'Créer votre compte' });
    await fill(user, { 'Adresse e-mail': 'nouveau@example.com', 'Mot de passe': 'motdepasse-1', 'Confirmer le mot de passe': 'different-1' });
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ne correspondent pas');
    await user.clear(screen.getByLabelText('Mot de passe'));
    await user.clear(screen.getByLabelText('Confirmer le mot de passe'));
    await fill(user, { 'Mot de passe': 'court', 'Confirmer le mot de passe': 'court' });
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('au moins 8 caractères');
    expect(calls.some(call => call.url.endsWith('/auth/register'))).toBe(false);
  });

  it('crée le compte avec le code, ouvre l’application et retire le code de l’URL', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?invite=Arblade');
    const calls = mockFetch([loggedOut, invite(true), { method: 'POST', match: /\/api\/auth\/register$/, respond: () => ({ status: 201, body: { authenticated: true, email: 'nouveau@example.com' } }) }]);
    renderGate();
    await screen.findByRole('heading', { name: 'Créer votre compte' });
    await fill(user, { 'Adresse e-mail': 'nouveau@example.com', 'Mot de passe': 'motdepasse-1', 'Confirmer le mot de passe': 'motdepasse-1' });
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByTestId('who')).toHaveTextContent('nouveau@example.com');
    expect(calls.find(call => call.url.endsWith('/auth/register'))?.body).toEqual({ code: 'Arblade', email: 'nouveau@example.com', password: 'motdepasse-1' });
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('affiche l’erreur du serveur (e-mail déjà pris) et reste sur le formulaire', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?invite=Arblade');
    mockFetch([loggedOut, invite(true), { method: 'POST', match: /\/api\/auth\/register$/, respond: () => ({ status: 409, body: { error: 'Un compte existe déjà avec cette adresse e-mail.' } }) }]);
    renderGate();
    await screen.findByRole('heading', { name: 'Créer votre compte' });
    await fill(user, { 'Adresse e-mail': 'pris@example.com', 'Mot de passe': 'motdepasse-1', 'Confirmer le mot de passe': 'motdepasse-1' });
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Un compte existe déjà');
    expect(screen.queryByTestId('who')).not.toBeInTheDocument();
  });

  it('« J’ai déjà un compte » bascule vers la connexion', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?invite=Arblade');
    mockFetch([loggedOut, invite(true)]);
    renderGate();
    await screen.findByRole('heading', { name: 'Créer votre compte' });
    await user.click(screen.getByRole('button', { name: 'J’ai déjà un compte' }));
    expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });
});

describe('AuthGate : e-mails de la veille quotidienne', () => {
  function Mails() {
    const { mailAlerts, setMailAlerts } = useAuth();
    return <div><p data-testid="mails">{mailAlerts ? 'actifs' : 'coupés'}</p><button onClick={() => void setMailAlerts(true).catch(() => undefined)}>Réactiver</button></div>;
  }
  const renderMails = () => render(<QueryClientProvider client={new QueryClient()}><AuthGate><Mails/></AuthGate></QueryClientProvider>);

  it('le serveur dit si le compte s’est désinscrit ; « Réactiver » l’enregistre, puis l’interface suit', async () => {
    const user = userEvent.setup();
    const calls = mockFetch([
      { match: /\/api\/auth\/me$/, respond: () => ({ body: { authenticated: true, email: 'moi@example.com', mailAlerts: false } }) },
      { method: 'PUT', match: /\/api\/mail\/preferences$/, respond: () => ({ body: { mailAlerts: true } }) },
    ]);
    renderMails();
    expect(await screen.findByTestId('mails')).toHaveTextContent('coupés');
    await user.click(screen.getByRole('button', { name: 'Réactiver' }));
    await waitFor(() => expect(screen.getByTestId('mails')).toHaveTextContent('actifs'));
    expect(calls.find(call => call.method === 'PUT')?.body).toEqual({ alerts: true });
  });

  it('réglage refusé par le serveur : l’interface ne change pas', async () => {
    const user = userEvent.setup();
    mockFetch([
      { match: /\/api\/auth\/me$/, respond: () => ({ body: { authenticated: true, email: 'moi@example.com', mailAlerts: false } }) },
      { method: 'PUT', match: /\/api\/mail\/preferences$/, respond: () => ({ status: 500, body: { error: 'panne' } }) },
    ]);
    renderMails();
    expect(await screen.findByTestId('mails')).toHaveTextContent('coupés');
    await user.click(screen.getByRole('button', { name: 'Réactiver' }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.getByTestId('mails')).toHaveTextContent('coupés');
  });
});
