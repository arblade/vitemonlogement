import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const UNAUTHORIZED_EVENT = 'vml:unauthorized';

type State = 'loading' | 'login' | 'register' | 'open' | 'error';
/** `mailAlerts` : e-mails de la veille quotidienne (actifs sauf désinscription). */
type AuthContextValue = { email: string | null; mailAlerts: boolean; setMailAlerts: (on: boolean) => Promise<void>; logout: () => Promise<void> };
/** Exporté pour les tests (compte connecté simulé). */
export const AuthContext = createContext<AuthContextValue>({ email: null, mailAlerts: true, setMailAlerts: async () => undefined, logout: async () => undefined });
export const useAuth = () => useContext(AuthContext);

const PASSWORD_MIN_LENGTH = 8;
const inputClass = 'w-full rounded-xl border border-line bg-paper px-4 py-3 text-base outline-none transition-colors focus:border-brand';

/** Code d'invitation présent dans l'URL (/?invite=CODE) : il ouvre le formulaire d'inscription. */
const inviteFromUrl = () => new URLSearchParams(window.location.search).get('invite');
function stripInviteFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invite')) return;
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  return data?.error ?? fallback;
}

// Connexion par e-mail + mot de passe ; inscription réservée aux personnes qui ont le lien d'invitation.
// La session est un cookie httpOnly posé par le serveur.
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [mailAlerts, setMailAlertsState] = useState(true);
  const [inviteCode, setInviteCode] = useState<string | null>(inviteFromUrl);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (response.ok) {
        const data = await response.json().catch(() => null) as { email?: string; mailAlerts?: boolean } | null;
        setSessionEmail(data?.email ?? null);
        setMailAlertsState(data?.mailAlerts !== false);
        stripInviteFromUrl();
        return setState('open');
      }
      if (response.status === 401) {
        if (inviteCode) {
          const invite = await fetch(`/api/auth/invite?code=${encodeURIComponent(inviteCode)}`, { credentials: 'same-origin' });
          const valid = invite.ok && (await invite.json().catch(() => null) as { valid?: boolean } | null)?.valid === true;
          if (valid) return setState('register');
          setInviteCode(null);
          setMessage(invite.status === 429 ? 'Trop de tentatives. Réessayez plus tard.' : 'Ce lien d’invitation n’est pas valide.');
        }
        return setState('login');
      }
      setMessage(await readError(response, 'Le service est momentanément indisponible.'));
      setState('error');
    } catch {
      setMessage('Impossible de joindre le serveur.');
      setState('error');
    }
  }, [inviteCode]);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const lock = () => { queryClient.clear(); setSessionEmail(null); setState('login'); };
    window.addEventListener(UNAUTHORIZED_EVENT, lock);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, lock);
  }, [queryClient]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    queryClient.clear();
    setSessionEmail(null);
    setState('login');
  }, [queryClient]);
  const setMailAlerts = useCallback(async (on: boolean) => {
    const response = await fetch('/api/mail/preferences', {
      method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alerts: on }),
    });
    if (!response.ok) throw new Error(await readError(response, 'Réglage impossible.'));
    setMailAlertsState(on);
  }, []);
  const auth = useMemo(() => ({ email: sessionEmail, mailAlerts, setMailAlerts, logout }), [sessionEmail, mailAlerts, setMailAlerts, logout]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const registering = state === 'register';
    if (registering && password !== confirm) { setMessage('Les deux mots de passe ne correspondent pas.'); return; }
    if (registering && password.length < PASSWORD_MIN_LENGTH) { setMessage(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`); return; }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(registering ? { code: inviteCode, email, password } : { email, password }),
      });
      if (response.ok) {
        const data = await response.json().catch(() => null) as { email?: string; mailAlerts?: boolean } | null;
        queryClient.clear();
        setSessionEmail(data?.email ?? email.trim().toLowerCase());
        setMailAlertsState(data?.mailAlerts !== false);
        setPassword(''); setConfirm('');
        stripInviteFromUrl();
        setState('open');
        return;
      }
      setMessage(await readError(response, registering ? 'Inscription impossible.' : 'Connexion impossible.'));
    } catch {
      setMessage('Impossible de joindre le serveur.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'open') return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
  if (state === 'loading') return <div className="grid min-h-[100dvh] place-items-center bg-background text-sm text-stone" role="status">Chargement…</div>;
  const registering = state === 'register';
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10">
    <div className="w-full max-w-[400px]">
      <div className="mb-8 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-brand text-paper"><Compass size={20} strokeWidth={1.8}/></span>
        <span className="text-xl font-semibold tracking-[-.03em]">vite mon logement</span>
      </div>
      {state === 'error'
        ? <div role="alert" className="space-y-3 rounded-2xl border border-line bg-[#fef3f2] px-5 py-4 text-sm text-[#b42318]">
            <p>{message}</p>
            <button type="button" onClick={() => { setState('loading'); void check(); }} className="min-h-11 font-semibold underline underline-offset-4">Réessayer</button>
          </div>
        : <form onSubmit={submit} className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-.03em]">{registering ? 'Créer votre compte' : 'Connexion'}</h1>
              <p className="mt-1 text-sm text-stone">{registering ? 'Vous avez été invité : choisissez votre mot de passe.' : 'Retrouvez vos recherches et vos favoris.'}</p>
            </div>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">Adresse e-mail</label>
              <input id="email" data-testid="input-email" type="email" autoComplete="email" autoFocus required value={email} onChange={event => setEmail(event.target.value)} className={inputClass}/>
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-semibold">Mot de passe</label>
              <input id="password" data-testid="input-password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? PASSWORD_MIN_LENGTH : undefined} value={password} onChange={event => setPassword(event.target.value)} className={inputClass}/>
              {registering && <p className="mt-1.5 text-xs text-stone">{PASSWORD_MIN_LENGTH} caractères minimum.</p>}
            </div>
            {registering && <div>
              <label htmlFor="confirm" className="mb-1.5 block text-sm font-semibold">Confirmer le mot de passe</label>
              <input id="confirm" data-testid="input-password-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} className={inputClass}/>
            </div>}
            {message && <p role="alert" data-testid="status-login-error" className="text-sm text-[#b42318]">{message}</p>}
            <Button type="submit" data-testid="button-login" disabled={busy || !email || !password || (registering && !confirm)} className="h-12 w-full rounded-full bg-brand text-base font-semibold text-paper hover:bg-brand-dark disabled:opacity-40">
              {busy ? (registering ? 'Création…' : 'Connexion…') : (registering ? 'Créer mon compte' : 'Se connecter')}
            </Button>
            {registering
              ? <button type="button" onClick={() => { setMessage(''); setState('login'); }} className="min-h-11 w-full text-sm text-stone underline underline-offset-4">J’ai déjà un compte</button>
              : <p className="text-center text-sm text-stone">Pas encore de compte ? L’inscription se fait sur invitation.</p>}
          </form>}
    </div>
  </main>;
}
