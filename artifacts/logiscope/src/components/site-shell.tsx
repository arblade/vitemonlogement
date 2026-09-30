import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, Compass, Heart, Menu, X } from 'lucide-react';
import { useListingInteractions } from '@/lib/listing-interactions';

export function SiteShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const { favorites } = useListingInteractions();
  const [mobileOpen, setMobileOpen] = useState(false);
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
  return <div className="grain min-h-[100dvh] bg-background">
    <header className="relative z-40 border-b border-line bg-paper">
      <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 md:px-10 lg:px-16">
        <Link href="/" data-testid="link-home-logo" className="flex items-center gap-3 group">
          <span className="grid size-10 place-items-center rounded-full bg-ink text-lime transition-transform group-hover:rotate-[-12deg]"><Compass size={20} strokeWidth={1.8}/></span>
          <span className="text-[21px] font-bold tracking-[-.065em]">vite mon logement<span className="text-[#9ca858]">.</span></span>
        </Link>
        <nav aria-label="Navigation principale" className="hidden items-center gap-7 text-[12px] font-semibold tracking-wide md:flex">
          <Link href="/" data-testid="link-new-search" aria-current={path === '/' ? 'page' : undefined} className={`transition-colors hover:text-[#8a9551] ${path === '/' ? 'text-ink' : 'text-stone-soft'}`}>Nouvelle recherche</Link>
          <Link href="/searches" data-testid="link-history" aria-current={onHistory ? 'page' : undefined} className={`transition-colors hover:text-[#8a9551] ${onHistory ? 'text-ink' : 'text-stone-soft'}`}>Mes recherches</Link>
          <Link href="/likes" data-testid="link-likes" aria-current={path === '/likes' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 transition-colors hover:text-[#8a9551] ${path === '/likes' ? 'text-ink' : 'text-stone-soft'}`}><Heart size={15}/> <span>Favoris</span>{favoriteCount > 0 && <span className="font-data text-xs">{favoriteCount}</span>}</Link>
        </nav>
        <button type="button" data-testid="button-mobile-menu" aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMobileOpen(value => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss md:hidden">
          {mobileOpen ? <X size={18} aria-hidden="true"/> : <Menu size={18} aria-hidden="true"/>} Menu
        </button>
      </div>
      <nav id="mobile-navigation" aria-label="Navigation mobile" data-testid="nav-mobile" className={`${mobileOpen ? 'block' : 'hidden'} border-t border-line px-5 py-3 text-sm font-semibold md:hidden`}>
        <div className="mx-auto flex max-w-[1440px] flex-col">
          <Link href="/" data-testid="link-mobile-new-search" aria-current={path === '/' ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={`rounded-lg px-3 py-3.5 ${path === '/' ? 'bg-sage text-ink' : 'text-stone-soft hover:bg-mist'}`}>Nouvelle recherche</Link>
          <Link href="/searches" data-testid="link-mobile-history" aria-current={onHistory ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={`rounded-lg px-3 py-3.5 ${onHistory ? 'bg-sage text-ink' : 'text-stone-soft hover:bg-mist'}`}>Mes recherches</Link>
          <Link href="/likes" data-testid="link-mobile-likes" aria-current={path === '/likes' ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={`flex items-center gap-2 rounded-lg px-3 py-3.5 ${path === '/likes' ? 'bg-sage text-ink' : 'text-stone-soft hover:bg-mist'}`}><Heart size={16} aria-hidden="true"/> Favoris{favoriteCount > 0 && <span className="font-data text-xs">{favoriteCount}</span>}</Link>
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

export function Eyebrow({ number, children, light = false }: { number: string; children: ReactNode; light?: boolean }) {
  return <div className={`flex items-center gap-3 font-data text-xs uppercase tracking-[.17em] ${light ? 'text-lime' : 'text-[#757956]'}`}><span className={`grid size-6 place-items-center rounded-full border ${light ? 'border-lime/40' : 'border-[#a8af77]'}`}>{number}</span>{children}</div>;
}

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" data-testid="status-error" className="flex flex-col gap-3 border-l-[3px] border-brick bg-[#f4e9e4] px-5 py-4 text-sm text-[#723c37] sm:flex-row sm:items-center sm:justify-between">
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