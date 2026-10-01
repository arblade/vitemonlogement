import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetHousingSearchQueryKey, getGetWatchedSearchQueryKey, getListHousingSearchesQueryKey, useUnwatchHousingSearch, useWatchHousingSearch,
  type HousingSearchDetail, type HousingSearchSummary,
} from '@workspace/api-client-react';
import { Bell, BellRing, PauseCircle } from 'lucide-react';
import { hoursLabel, nextPass } from '@/lib/dates';

const DEFAULT_TIMES = ['08:00', '18:00'];
/** Heures proposées, de 5 h à 23 h par demi-heure : un menu se lit pareil partout (pas de « 08:00 AM »), et se touche facilement. */
const SLOTS = Array.from({ length: 37 }, (_, i) => `${String(5 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const slotLabel = (value: string) => { const [h, m] = value.split(':'); return `${Number(h)} h${m === '00' ? '' : ` ${m}`}`; };

/**
 * « Créer une alerte » : la recherche devient une recherche suivie (une seule par compte), relancée chaque jour aux
 * heures choisies ; ses nouvelles annonces s'affichent avec une pastille dans le site. Une fois active : une ligne
 * discrète (prochain passage, Modifier, Arrêter) ; en pause (7 jours sans visite) : Reprendre.
 */
export function WatchPanel({ search, other }: { search: HousingSearchDetail; other: HousingSearchSummary | null }) {
  const queryClient = useQueryClient();
  const watch = useWatchHousingSearch();
  const unwatch = useUnwatchHousingSearch();
  const [editing, setEditing] = useState(false);
  const [times, setTimes] = useState<string[]>(search.watchTimes.length ? [...search.watchTimes, '', ''].slice(0, 2) : DEFAULT_TIMES);
  const [error, setError] = useState('');
  const pending = watch.isPending || unwatch.isPending;
  const chosen = [...new Set(times.filter(Boolean))];
  const replaced = other && other.id !== search.id ? other : null;

  const apply = (summary: HousingSearchSummary) => {
    queryClient.setQueryData(getGetHousingSearchQueryKey(search.id), (old: HousingSearchDetail | undefined) => old && { ...old, ...summary });
    void queryClient.invalidateQueries({ queryKey: getGetWatchedSearchQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListHousingSearchesQueryKey() });
  };
  const start = async (wanted: string[]) => {
    setError('');
    if (!wanted.length) { setError('Choisissez au moins une heure.'); return; }
    try { apply(await watch.mutateAsync({ id: search.id, data: { times: wanted } })); setEditing(false); }
    catch { setError('Impossible de créer l’alerte pour le moment. Réessayez.'); }
  };
  const stop = async () => {
    setError('');
    try { apply(await unwatch.mutateAsync({ id: search.id })); }
    catch { setError('Impossible d’arrêter le suivi pour le moment. Réessayez.'); }
  };

  if (search.watch === 'active' && !editing) {
    return <div data-testid="card-watch" className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[#ffc2cd] bg-lime-wash px-4 py-3 md:px-5">
      <span className="flex min-w-0 items-center gap-2 text-sm"><BellRing size={17} aria-hidden="true" className="shrink-0 text-brand"/>
        <span data-testid="text-watch-status"><strong className="font-semibold">Recherche suivie</strong> · chaque jour à {hoursLabel(search.watchTimes)}{search.nextWatchAt ? ` · prochain passage ${nextPass(search.nextWatchAt)}` : ''}</span></span>
      <span className="ml-auto flex gap-2">
        <button type="button" data-testid="button-edit-watch" onClick={() => setEditing(true)} className="inline-flex h-9 items-center rounded-lg border border-[#dddddd] bg-white px-3 text-xs font-semibold hover:border-ink">Modifier</button>
        <button type="button" data-testid="button-unwatch" disabled={pending} onClick={() => void stop()} className="inline-flex h-9 items-center rounded-lg border border-[#dddddd] bg-white px-3 text-xs font-semibold hover:border-ink disabled:opacity-50">Arrêter</button>
      </span>
      {error && <p role="alert" className="w-full text-xs text-[#b42318]">{error}</p>}
    </div>;
  }
  if (search.watch === 'paused' && !editing) {
    return <div data-testid="card-watch" className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-sage px-4 py-3 md:px-5">
      <span className="flex items-center gap-2 text-sm"><PauseCircle size={17} aria-hidden="true" className="shrink-0 text-stone"/>
        <span data-testid="text-watch-status"><strong className="font-semibold">Recherche suivie en pause</strong> · 7 jours sans visite</span></span>
      <span className="ml-auto flex gap-2">
        <button type="button" data-testid="button-resume-watch" disabled={pending} onClick={() => void start(search.watchTimes.length ? search.watchTimes : DEFAULT_TIMES)} className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Reprendre</button>
        <button type="button" data-testid="button-unwatch" disabled={pending} onClick={() => void stop()} className="inline-flex h-9 items-center rounded-lg border border-[#dddddd] bg-white px-3 text-xs font-semibold hover:border-ink disabled:opacity-50">Arrêter</button>
      </span>
      {error && <p role="alert" className="w-full text-xs text-[#b42318]">{error}</p>}
    </div>;
  }
  return <section data-testid="card-watch" aria-labelledby="watch-title" className="mb-8 rounded-2xl border border-line bg-cream p-4 shadow-[0_6px_20px_rgba(0,0,0,.05)] md:p-5">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-lime-wash text-brand"><Bell size={19}/></span>
      <div className="min-w-0">
        <h3 id="watch-title" className="text-[15px] font-semibold">{search.watch ? 'Heures de passage' : 'Créer une alerte'}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-stone">Recevez ici les nouvelles annonces de cette recherche, chaque jour aux heures choisies. Une pastille vous les signale dès que vous ouvrez le site.</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      {[0, 1].map(index => <label key={index} className="flex flex-col gap-1 text-xs text-stone">{index === 0 ? 'Premier passage' : 'Second (facultatif)'}
        <select data-testid={`input-watch-time-${index}`} value={times[index] ?? ''} onChange={event => setTimes(current => { const next = [...current]; next[index] = event.target.value; return next; })}
          className="h-10 rounded-lg border border-[#dddddd] bg-white px-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-[#ff385c]">
          {index === 1 && <option value="">Aucun</option>}
          {SLOTS.map(slot => <option key={slot} value={slot}>{slotLabel(slot)}</option>)}
        </select></label>)}
      <button type="button" data-testid="button-watch" disabled={pending} onClick={() => void start(chosen)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-xs font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50">
        <BellRing size={15} aria-hidden="true"/>{search.watch ? 'Enregistrer' : replaced ? 'Remplacer mon alerte' : 'Créer l’alerte'}</button>
      {editing && <button type="button" onClick={() => setEditing(false)} className="inline-flex h-10 items-center rounded-lg px-3 text-xs font-semibold text-stone hover:text-ink">Annuler</button>}
    </div>
    {replaced && !search.watch && <p data-testid="text-watch-replace" className="mt-3 text-xs text-stone">Une seule recherche suivie à la fois : « {replaced.criteria?.location || replaced.prompt} » sera remplacée.</p>}
    {error && <p role="alert" className="mt-3 text-xs text-[#b42318]">{error}</p>}
  </section>;
}
