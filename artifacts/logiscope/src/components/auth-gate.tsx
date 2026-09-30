import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const UNAUTHORIZED_EVENT = 'vml:unauthorized';

type State = 'loading' | 'locked' | 'open' | 'error';

// Écran de mot de passe partagé : la session est un cookie httpOnly posé par le serveur (/api/auth/login).
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (response.ok) return setState('open');
      if (response.status === 401) return setState('locked');
      const data = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(data?.error ?? 'Le service est momentanément indisponible.');
      setState('error');
    } catch {
      setMessage('Impossible de joindre le serveur.');
      setState('error');
    }
  }, []);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const lock = () => { queryClient.clear(); setState('locked'); };
    window.addEventListener(UNAUTHORIZED_EVENT, lock);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, lock);
  }, [queryClient]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
      });
      if (response.ok) { setPassword(''); setState('open'); return; }
      const data = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(data?.error ?? 'Connexion impossible.');
    } catch {
      setMessage('Impossible de joindre le serveur.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'open') return <>{children}</>;
  if (state === 'loading') return <div className="grid min-h-[100dvh] place-items-center bg-background text-sm text-[#77746a]" role="status">Chargement…</div>;
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5">
    <div className="w-full max-w-[380px]">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-[#292635] text-[#dfe89b]"><Compass size={20} strokeWidth={1.8}/></span>
        <span className="text-[21px] font-bold tracking-[-.065em]">vite mon logement</span>
      </div>
      {state === 'error'
        ? <div role="alert" className="space-y-3 border-l-[3px] border-[#a84d43] bg-[#f4e9e4] px-5 py-4 text-sm text-[#723c37]">
            <p>{message}</p>
            <button type="button" onClick={() => { setState('loading'); void check(); }} className="font-semibold underline underline-offset-4">Réessayer</button>
          </div>
        : <form onSubmit={submit} className="space-y-4">
            <label htmlFor="password" className="block text-sm font-semibold">Mot de passe</label>
            <input id="password" data-testid="input-password" type="password" autoComplete="current-password" autoFocus required value={password}
              onChange={event => setPassword(event.target.value)}
              className="w-full rounded-lg border border-[#d9d6c9] bg-[#f5f3eb] px-4 py-3 text-base outline-none focus:border-[#8a9551]"/>
            {message && <p role="alert" data-testid="status-login-error" className="text-sm text-[#723c37]">{message}</p>}
            <Button type="submit" data-testid="button-login" disabled={busy || !password} className="w-full">{busy ? 'Connexion…' : 'Entrer'}</Button>
          </form>}
    </div>
  </main>;
}
