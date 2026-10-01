import { Link } from 'wouter';
import type { HousingSearchSummary } from '@workspace/api-client-react';
import { BellRing, ChevronRight, PauseCircle } from 'lucide-react';
import { hoursLabel, nextPass } from '@/lib/dates';

/**
 * La recherche suivie, mise en avant (accueil, « Mes recherches ») : lieu, nombre d'annonces pas encore vues,
 * prochain passage. Un clic l'ouvre (et remet le compteur à zéro).
 */
export function WatchedSearchCard({ search }: { search: HousingSearchSummary }) {
  const paused = search.watch === 'paused';
  const unseen = search.unseenCount;
  return <Link href={`/searches/${search.id}`} data-testid="card-watched-search" aria-label={`Ouvrir la recherche suivie : ${search.criteria?.location || search.prompt}`}
    className="group flex items-center gap-4 rounded-2xl border border-[#ffc2cd] bg-lime-wash p-4 text-left transition-colors hover:border-brand md:p-5">
    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand">{paused ? <PauseCircle size={21}/> : <BellRing size={21}/>}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-xs font-semibold text-brand">Recherche suivie</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="min-w-0 truncate text-[17px] font-semibold tracking-tight">{search.criteria?.location || search.prompt}</strong>
        {unseen > 0
          ? <span data-testid="text-watched-unseen" className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-white">{unseen} nouvelle{unseen > 1 ? 's' : ''}</span>
          : <span data-testid="text-watched-unseen" className="shrink-0 text-xs text-stone">À jour</span>}
      </span>
      <span data-testid="text-watched-next" className="mt-1 block text-xs text-stone">{paused
        ? 'En pause : 7 jours sans visite. Ouvrez-la pour la reprendre.'
        : `Chaque jour à ${hoursLabel(search.watchTimes)}${search.nextWatchAt ? ` · prochain passage ${nextPass(search.nextWatchAt)}` : ''}`}</span>
    </span>
    <ChevronRight size={18} aria-hidden="true" className="hidden shrink-0 text-[#b0b0b0] transition-transform group-hover:translate-x-1 sm:block"/>
  </Link>;
}

/**
 * Accueil, quand la recherche suivie a trouvé des logements pas encore vus : un bloc qui saute aux yeux, avec un seul
 * geste (« Voir les nouveautés »).
 */
export function NewListingsHero({ search }: { search: HousingSearchSummary }) {
  const count = search.unseenCount;
  return <section data-testid="hero-new-listings" aria-labelledby="hero-new-title" className="overflow-hidden rounded-[24px] bg-[linear-gradient(150deg,#ff385c,#e31c5f)] p-5 text-left text-white shadow-[0_14px_34px_rgba(227,28,95,.25)] md:p-7">
    <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold"><BellRing size={14} aria-hidden="true"/>Votre recherche suivie</span>
    <h2 id="hero-new-title" className="mt-3 text-[clamp(1.4rem,3.6vw,2rem)] font-semibold leading-tight tracking-[-.02em]">
      {count} nouveau{count > 1 ? 'x' : ''} logement{count > 1 ? 's' : ''} à {search.criteria?.location || 'découvrir'}
    </h2>
    <p className="mt-1.5 text-sm text-white/90">Trouvé{count > 1 ? 's' : ''} pour vous depuis votre dernière visite. Soyez parmi les premiers à les voir.</p>
    <Link href={`/searches/${search.id}`} data-testid="link-hero-new-listings" className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-brand-dark transition-transform hover:translate-x-0.5">
      Voir les nouveautés <ChevronRight size={17} aria-hidden="true"/></Link>
  </section>;
}
