import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, Compass, CircleHelp } from 'lucide-react';

export function SiteShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  return <div className="grain min-h-[100dvh] bg-background">
    <header className="relative z-40 border-b border-[#d9d6c9] bg-[#f5f3eb]">
      <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 md:px-10 lg:px-16">
        <Link href="/" data-testid="link-home-logo" className="flex items-center gap-3 group">
          <span className="grid size-10 place-items-center rounded-full bg-[#292635] text-[#dfe89b] transition-transform group-hover:rotate-[-12deg]"><Compass size={20} strokeWidth={1.8}/></span>
          <span className="text-[21px] font-bold tracking-[-.065em]">logiscope<span className="text-[#9ca858]">.</span></span>
        </Link>
        <nav className="flex items-center gap-3 md:gap-7 text-[12px] font-semibold tracking-wide">
          <Link href="/" data-testid="link-new-search" className={`transition-colors hover:text-[#8a9551] ${path === '/' ? 'text-[#292635]' : 'text-[#79776f]'}`}>Nouvelle recherche</Link>
          <Link href="/#recherches" data-testid="link-history" className="hidden sm:block text-[#79776f] transition-colors hover:text-[#292635]">Mes recherches</Link>
          <span className="hidden h-5 w-px bg-[#d8d5c8] sm:block" />
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[#77746a]"><CircleHelp size={14}/> Des annonces, pas des promesses</span>
        </nav>
      </div>
    </header>
    {children}
    <footer className="border-t border-[#d9d6c9] bg-[#f5f3eb]">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-8 text-xs text-[#77746a] md:flex-row md:items-center md:justify-between md:px-10 lg:px-16">
        <div className="flex items-center gap-2 font-semibold text-[#292635]"><Compass size={17}/> logiscope<span className="font-normal text-[#77746a]"> — La recherche immobilière, les yeux ouverts.</span></div>
        <span>Les informations proviennent des annonces. Vérifiez toujours auprès de la source. <ArrowUpRight size={12} className="inline"/></span>
      </div>
    </footer>
  </div>;
}

export function Eyebrow({ number, children, light = false }: { number: string; children: ReactNode; light?: boolean }) {
  return <div className={`flex items-center gap-3 font-data text-[10px] uppercase tracking-[.17em] ${light ? 'text-[#dfe89b]' : 'text-[#757956]'}`}><span className={`grid size-6 place-items-center rounded-full border ${light ? 'border-[#dfe89b]/40' : 'border-[#a8af77]'}`}>{number}</span>{children}</div>;
}

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" data-testid="status-error" className="flex flex-col gap-3 border-l-[3px] border-[#a84d43] bg-[#f4e9e4] px-5 py-4 text-sm text-[#723c37] sm:flex-row sm:items-center sm:justify-between">
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