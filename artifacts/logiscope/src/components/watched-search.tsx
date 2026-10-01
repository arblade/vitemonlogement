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
      <span className="block text-xs font-semibold text-moss">Recherche suivie</span>
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
