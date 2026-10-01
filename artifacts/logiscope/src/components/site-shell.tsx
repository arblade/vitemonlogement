import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, Compass, Heart, History, LogOut, Menu, Search, X } from 'lucide-react';
import { useAuth } from '@/components/auth-gate';
import { useListingInteractions } from '@/lib/listing-interactions';
import { useWatchedSearch } from '@/lib/watch';

const TITLE = 'Vite mon logement';

/** Pastille rose : annonces de la recherche suivie arrivées depuis la dernière ouverture. */
function UnseenBadge({ count, testId }: { count: number; testId: string }) {
  if (count <= 0) return null;
  return <span data-testid={testId} aria-label={`${count} nouvelle${count > 1 ? 's' : ''} annonce${count > 1 ? 's' : ''} non vue${count > 1 ? 's' : ''}`} className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-xs font-bold leading-none text-white">{count > 99 ? '99+' : count}</span>;
}

export function SiteShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const { favorites } = useListingInteractions();
  const { email, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { unseen } = useWatchedSearch();
  // Le nombre se voit aussi dans l'onglet du navigateur, même en arrière-plan.
  useEffect(() => { document.title = unseen > 0 ? `(${unseen}) ${TITLE}` : TITLE; }, [unseen]);
  const favoriteCount = Object.keys(favorites).length;
  const onHistory = path === '/searches' || path.startsWith('/searches/');
  useEffect(() => { setMobileOpen(false); }, [path]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [mobileOpen]);
  return <div className="min-h-[100dvh] bg-background">
    <header className="sticky top-0 z-40 border-b border-line-soft bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 md:px-10 lg:px-16">
        <Link href="/" data-testid="link-home-logo" className="flex items-center gap-3 group">
          <span className="grid size-8 place-items-center rounded-lg bg-brand text-paper transition-transform group-hover:rotate-[-8deg]"><Compass size={17} strokeWidth={1.8}/></span>
          <span className="text-lg font-semibold tracking-[-.03em]">vite mon logement</span>
        </Link>
        <nav aria-label="Navigation principale" className="hidden items-center gap-1 text-sm font-medium md:flex">
          <Link href="/" data-testid="link-new-search" aria-current={path === '/' ? 'page' : undefined} className={`transition-colors hover:text-[#ff385c] ${path === '/' ? 'text-ink' : 'text-stone-soft'}`}><Search size={16} aria-hidden="true"/> Nouvelle recherche</Link>
          <Link href="/searches" data-testid="link-history" aria-current={onHistory ? 'page' : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-sage ${onHistory ? 'bg-sage text-ink' : 'text-stone'}`}><History size={16} aria-hidden="true"/> Mes recherches<UnseenBadge count={unseen} testId="badge-unseen"/></Link>
          <Link href="/likes" data-testid="link-likes" aria-current={path === '/likes' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 transition-colors hover:text-[#ff385c] ${path === '/likes' ? 'text-ink' : 'text-stone-soft'}`}><Heart size={15}/> <span>Favoris</span>{favoriteCount > 0 && <span className="font-data text-xs">{favoriteCount}</span>}</Link>
                  <button type="button" data-testid="button-logout" onClick={() => void logout()} title={email ?? undefined} aria-label="Se déconnecter" className="ml-2 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-stone transition-colors hover:bg-sage hover:text-ink"><LogOut size={16} aria-hidden="true"/> <span className="sr-only lg:not-sr-only">Déconnexion</span></button>
        </nav>
        <button type="button" data-testid="button-mobile-menu" aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMobileOpen(value => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss md:hidden">
          {mobileOpen ? <X size={18} aria-hidden="true"/> : <Menu size={18} aria-hidden="true"/>} Menu<UnseenBadge count={unseen} testId="badge-unseen-menu"/>
        </button>
      </div>
      <nav id="mobile-navigation" aria-label="Navigation mobile" data-testid="nav-mobile" className={`${mobileOpen ? 'block' : 'hidden'} border-t border-line px-5 py-3 text-sm font-semibold md:hidden`}>
        <div className="mx-auto flex max-w-[1440px] flex-col">
          <Link href="/" data-testid="link-mobile-new-search" aria-current={path === '/' ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={`flex items-center gap-2 rounded-lg px-3 py-3.5 ${path === '/' ? 'bg-sage text-ink' : 'text-stone-soft hover:bg-mist'}`}><Search size={16} aria-hidden="true"/> Nouvelle recherche</Link>
          <Link href="/searches" data-testid="link-mobile-history" aria-current={onHistory ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={`flex items-center gap-2 rounded-lg px-3 py-3.5 ${onHistory ? 'bg-sage text-ink' : 'text-stone-soft hover:bg-mist'}`}><History size={16} aria-hidden="true"/> Mes recherches<UnseenBadge count={unseen} testId="badge-unseen-mobile"/></Link>
          <Link href="/likes" data-testid="link-mobile-likes" aria-current={path === '/likes' ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={`flex items-center gap-2 rounded-lg px-3 py-3.5 ${path === '/likes' ? 'bg-sage text-ink' : 'text-stone-soft hover:bg-mist'}`}><Heart size={16} aria-hidden="true"/> Favoris{favoriteCount > 0 && <span className="font-data text-xs">{favoriteCount}</span>}</Link>
                  <div className="mt-1 border-t border-line-soft pt-2">{email && <p className="truncate px-3 pb-1 text-xs text-stone">{email}</p>}<button type="button" data-testid="button-mobile-logout" onClick={() => void logout()} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-stone hover:bg-sage"><LogOut size={16} aria-hidden="true"/> Se déconnecter</button></div>
        </div>
      </nav>
    </header>
    {children}
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-8 text-xs text-stone md:flex-row md:items-center md:justify-between md:px-10 lg:px-16">
        <div className="flex items-center gap-2 font-semibold text-ink"><Compass size={17}/> vite mon logement</div>
        <span>Les informations proviennent des annonces. Vérifiez toujours auprès de la source. <ArrowUpRight size={12} className="inline"/></span>
      </div>
    </footer>
  </div>;
}

export function Eyebrow({ children }: { number?: string; children: ReactNode; light?: boolean }) {
  return <div className="text-sm font-medium text-stone">{children}</div>;
}

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" data-testid="status-error" className="flex flex-col gap-3 border-l-[3px] border-brick bg-[#fef3f2] px-5 py-4 text-sm text-[#b42318] sm:flex-row sm:items-center sm:justify-between">
    <span>{message}</span>{retry && <button data-testid="button-retry" type="button" onClick={retry} className="shrink-0 font-semibold underline underline-offset-4">Réessayer</button>}
  </div>;
}

export function formatPrice(value?: number | null) {
  return value == null ? 'Prix non précisé' : new Intl.NumberFormat('fr-FR').format(value) + ' €';
}
export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}