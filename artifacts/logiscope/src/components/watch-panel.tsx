import { useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetHousingSearchQueryKey, getGetWatchedSearchQueryKey, getListHousingSearchesQueryKey, useUnwatchHousingSearch, useWatchHousingSearch,
  type HousingSearchDetail, type HousingSearchSummary,
} from '@workspace/api-client-react';
import { BellRing, CalendarClock, History, Info, PauseCircle, Repeat, Search, X } from 'lucide-react';
import { hoursLabel, nextPass } from '@/lib/dates';

const DEFAULT_TIMES = ['08:00', '18:00'];
/** Heures proposées, de 5 h à 23 h par demi-heure : un menu se lit pareil partout (pas de « 08:00 AM »), et se touche facilement. */
const SLOTS = Array.from({ length: 37 }, (_, i) => `${String(5 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const slotLabel = (value: string) => { const [h, m] = value.split(':'); return `${Number(h)} h${m === '00' ? '' : ` ${m}`}`; };
const placeOf = (search: HousingSearchSummary) => search.criteria?.location || search.prompt;

/**
 * Recherche ponctuelle ou recherche suivie. Ponctuelle : une ligne qui le dit, et le bouton « Créer une recherche
 * suivie ». Ce bouton ouvre une fenêtre qui explique ce qui va se passer (4 jours d'annonces tout de suite, puis les
 * nouvelles aux heures choisies, pastille, pause après 7 jours) et prévient si une autre recherche suivie sera remplacée.
 * Suivie : une ligne discrète (heures, prochain passage, Modifier, Arrêter) ; en pause : Reprendre.
 */
export function WatchPanel({ search, other }: { search: HousingSearchDetail; other: HousingSearchSummary | null }) {
  const queryClient = useQueryClient();
  const unwatch = useUnwatchHousingSearch();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const apply = (summary: HousingSearchSummary) => {
    queryClient.setQueryData(getGetHousingSearchQueryKey(search.id), (old: HousingSearchDetail | undefined) => old && { ...old, ...summary });
    void queryClient.invalidateQueries({ queryKey: getGetHousingSearchQueryKey(search.id) });
    void queryClient.invalidateQueries({ queryKey: getGetWatchedSearchQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListHousingSearchesQueryKey() });
  };
  const stop = async () => {
    setError('');
    try { apply(await unwatch.mutateAsync({ id: search.id })); }
    catch { setError('Impossible d’arrêter le suivi pour le moment. Réessayez.'); }
  };
  const dialog = <WatchDialog open={open} onOpenChange={setOpen} search={search} replaced={other && other.id !== search.id ? other : null} onDone={apply}/>;
  const smallButton = 'inline-flex h-9 items-center rounded-lg border border-[#dddddd] bg-white px-3 text-xs font-semibold hover:border-ink disabled:opacity-50';

  if (search.watch === 'active') {
    return <div data-testid="card-watch" className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[#ffc2cd] bg-lime-wash px-4 py-3 md:px-5">
      <span className="flex min-w-0 items-center gap-2 text-sm"><BellRing size={17} aria-hidden="true" className="shrink-0 text-brand"/>
        <span data-testid="text-watch-status"><strong className="font-semibold">Recherche suivie</strong> · chaque jour à {hoursLabel(search.watchTimes)}{search.nextWatchAt ? ` · prochain passage ${nextPass(search.nextWatchAt)}` : ''}</span></span>
      <span className="ml-auto flex gap-2">
        <button type="button" data-testid="button-edit-watch" onClick={() => setOpen(true)} className={smallButton}>Modifier les heures</button>
        <button type="button" data-testid="button-unwatch" disabled={unwatch.isPending} onClick={() => void stop()} className={smallButton}>Arrêter</button>
      </span>
      {error && <p role="alert" className="w-full text-xs text-[#b42318]">{error}</p>}
      {dialog}
    </div>;
  }
  if (search.watch === 'paused') {
    return <div data-testid="card-watch" className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-sage px-4 py-3 md:px-5">
      <span className="flex items-center gap-2 text-sm"><PauseCircle size={17} aria-hidden="true" className="shrink-0 text-stone"/>
        <span data-testid="text-watch-status"><strong className="font-semibold">Recherche suivie en pause</strong> · 7 jours sans visite</span></span>
      <span className="ml-auto flex gap-2">
        <button type="button" data-testid="button-resume-watch" onClick={() => setOpen(true)} className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-dark">Reprendre</button>
        <button type="button" data-testid="button-unwatch" disabled={unwatch.isPending} onClick={() => void stop()} className={smallButton}>Arrêter</button>
      </span>
      {error && <p role="alert" className="w-full text-xs text-[#b42318]">{error}</p>}
      {dialog}
    </div>;
  }
  return <div data-testid="card-watch" className="mb-8 flex flex-col gap-3 rounded-2xl border border-line bg-cream px-4 py-4 sm:flex-row sm:items-center md:px-5">
    <span className="flex min-w-0 items-start gap-3 text-sm">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-sage text-stone"><Search size={17}/></span>
      <span data-testid="text-watch-status"><strong className="block font-semibold">Recherche suivie</strong>
        <span className="text-xs text-stone">Pour être prévenu des nouvelles annonces de cette recherche chaque jour, suivez-la.</span></span>
    </span>
    <button type="button" data-testid="button-watch" onClick={() => setOpen(true)} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark sm:ml-auto">
      <BellRing size={16} aria-hidden="true"/> Créer une recherche suivie</button>
    {dialog}
  </div>;
}

/** Fenêtre de confirmation : ce que fait une recherche suivie, ses heures, et la recherche suivie remplacée s'il y en a une. */
function WatchDialog({ open, onOpenChange, search, replaced, onDone }: {
  open: boolean; onOpenChange: (open: boolean) => void; search: HousingSearchDetail; replaced: HousingSearchSummary | null;
  onDone: (summary: HousingSearchSummary) => void;
}) {
  const watch = useWatchHousingSearch();
  const editing = search.watch === 'active';
  const [times, setTimes] = useState<string[]>(search.watchTimes.length ? [...search.watchTimes, ''].slice(0, 2) : DEFAULT_TIMES);
  const [error, setError] = useState('');
  const chosen = [...new Set(times.filter(Boolean))].sort();
  const confirm = async () => {
    setError('');
    if (!chosen.length) { setError('Choisissez au moins une heure.'); return; }
    try { onDone(await watch.mutateAsync({ id: search.id, data: { times: chosen } })); onOpenChange(false); }
    catch { setError('Impossible d’activer la recherche suivie pour le moment. Réessayez.'); }
  };
  const step = (Icon: typeof Repeat, text: ReactNode) =>
    <li className="flex gap-3"><Icon size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-brand"/><span>{text}</span></li>;
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40"/>
      <DialogPrimitive.Content data-testid="dialog-watch" aria-describedby="watch-dialog-intro" className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-[24px] bg-cream p-5 text-ink shadow-2xl outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-40px)] sm:max-w-[520px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <DialogPrimitive.Title className="flex items-center gap-2 text-xl font-semibold tracking-[-.02em]"><BellRing size={20} aria-hidden="true" className="text-brand"/>{editing ? 'Heures de passage' : 'Créer une recherche suivie'}</DialogPrimitive.Title>
          <DialogPrimitive.Close aria-label="Fermer" className="grid size-9 shrink-0 place-items-center rounded-full border border-line hover:bg-sage"><X size={16}/></DialogPrimitive.Close>
        </div>
        <p id="watch-dialog-intro" className="mt-3 text-sm leading-relaxed text-[#484848]">
          {editing ? 'Votre recherche suivie repasse chaque jour à ces heures (heure de Paris).' : <>Une recherche ponctuelle montre les annonces du moment. <strong>Une recherche suivie continue de chercher pour vous</strong>, chaque jour :</>}
        </p>
        {!editing && <ul data-testid="watch-explanation" className="mt-4 space-y-3 text-sm leading-relaxed">
          {step(History, <><strong>Tout de suite</strong> : toutes les annonces des 4 derniers jours (jusqu’à 105).</>)}
          {step(Repeat, <><strong>Puis chaque jour</strong>, aux heures choisies ci-dessous : seulement les nouvelles annonces.</>)}
          {step(BellRing, <>Une <strong>pastille rose</strong> vous les signale dès que vous ouvrez le site.</>)}
          {step(Info, <>Une annonce simplement remontée ou republiée par son auteur n’est jamais comptée comme nouvelle.</>)}
          {step(CalendarClock, <>Sans visite pendant 7 jours, elle se met en pause : elle ne coûte rien tant que vous ne la regardez pas.</>)}
        </ul>}
        <div className="mt-5 flex flex-wrap gap-3">
          {[0, 1].map(index => <label key={index} className="flex flex-col gap-1 text-xs text-stone">{index === 0 ? 'Premier passage' : 'Second (facultatif)'}
            <select data-testid={`input-watch-time-${index}`} value={times[index] ?? ''} onChange={event => setTimes(current => { const next = [...current]; next[index] = event.target.value; return next; })}
              className="h-11 rounded-lg border border-[#dddddd] bg-white px-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-[#ff385c]">
              {index === 1 && <option value="">Aucun</option>}
              {SLOTS.map(slot => <option key={slot} value={slot}>{slotLabel(slot)}</option>)}
            </select></label>)}
        </div>
        {replaced && !editing && <p data-testid="text-watch-replace" className="mt-5 flex gap-2 rounded-lg bg-sage px-3 py-2.5 text-xs leading-relaxed text-[#484848]"><Info size={15} aria-hidden="true" className="mt-px shrink-0"/>
          <span>Une seule recherche suivie à la fois : « {placeOf(replaced)} » s’arrêtera et redeviendra une recherche ponctuelle.</span></p>}
        {error && <p role="alert" className="mt-4 text-xs text-[#b42318]">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogPrimitive.Close className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-stone hover:text-ink">Annuler</DialogPrimitive.Close>
          <button type="button" data-testid="button-confirm-watch" disabled={watch.isPending} onClick={() => void confirm()} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50">
            <BellRing size={16} aria-hidden="true"/>{editing ? 'Enregistrer' : replaced ? 'Remplacer et suivre celle-ci' : 'Activer la recherche suivie'}</button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
