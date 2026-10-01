import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateHousingSearch, useListHousingSearches, getListHousingSearchesQueryKey, getGetHousingSearchQueryKey } from '@workspace/api-client-react';
import { ArrowRight, ArrowUp, Building2, Cat, Check, ChevronRight, House, PenLine, ScanSearch, Search, TreeDeciduous, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { ErrorNotice, formatDate } from '@/components/site-shell';
import { NewListingsHero, WatchedSearchCard } from '@/components/watched-search';
import { useWatchedSearch } from '@/lib/watch';

const suggestions = [
  { icon: Cat, text: 'Un studio à Lille, 650 € maximum, chat accepté' },
  { icon: Building2, text: 'Un T2 à Lyon, 1 200 € maximum, avec ascenseur' },
  { icon: TreeDeciduous, text: 'Une maison à Nantes, 3 chambres, avec jardin' },
];
const steps = [
  { icon: PenLine, title: 'Vous décrivez', text: 'Ville, budget, et tout ce qui compte pour vous, avec vos propres mots.' },
  { icon: ScanSearch, title: 'On cherche et on vérifie', text: 'Nous parcourons les annonces et contrôlons chacun de vos critères.' },
  { icon: House, title: 'Vous choisissez', text: 'Vous voyez ce qui est confirmé, ce qui reste à vérifier, et vous comparez.' },
];
type PromptForm = { prompt: string };
const apiMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  }
  return fallback;
};

export default function Home() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const promptForm = useForm<PromptForm>({ defaultValues: { prompt: '' } });
  const [localError, setLocalError] = useState('');
  const create = useCreateHousingSearch();
  const { search: watched } = useWatchedSearch();
  const history = useListHousingSearches({ query: { queryKey: getListHousingSearchesQueryKey(), refetchInterval: query => query.state.data?.some(item => item.status === 'running') ? 4000 : false } });

  const onCreate = async ({ prompt }: PromptForm) => {
    if (create.isPending) return;
    setLocalError('');
    try {
      const result = await create.mutateAsync({ data: { prompt: prompt.trim() } });
      queryClient.setQueryData(getGetHousingSearchQueryKey(result.id), result);
      void queryClient.invalidateQueries({ queryKey: getListHousingSearchesQueryKey() });
      navigate(`/searches/${result.id}`);
    } catch (error) { setLocalError(apiMessage(error, 'La recherche n’a pas pu démarrer. Votre description est conservée : réessayez dans un instant.')); }
  };

  return <main>
    <section className="mx-auto max-w-3xl px-5 pb-10 pt-14 text-center md:pt-24">
      {watched && <div className="mb-9 md:-mt-10">{watched.unseenCount > 0 ? <NewListingsHero search={watched}/> : <WatchedSearchCard search={watched}/>}</div>}
      <h1 className="text-balance text-[clamp(1.9rem,4.6vw,3rem)] font-semibold leading-[1.1] tracking-[-.03em]">Trouvez votre prochain chez-vous</h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-stone">Racontez-nous le logement idéal. On lit les annonces à votre place et on vous montre lesquelles correspondent vraiment.</p>
      <Form {...promptForm}>
        <form onSubmit={promptForm.handleSubmit(onCreate)} className="mt-9 rounded-[28px] border border-line bg-paper p-3 text-left shadow-[0_6px_28px_rgba(0,0,0,.1)] transition-shadow focus-within:shadow-[0_8px_36px_rgba(0,0,0,.16)]">
          <FormField control={promptForm.control} name="prompt" rules={{ required: 'Décrivez le logement recherché.', minLength: { value: 10, message: 'Décrivez votre recherche en au moins 10 caractères.' }, maxLength: { value: 1000, message: 'Limitez votre description à 1 000 caractères.' } }} render={({ field }) => <FormItem className="space-y-0">
            <FormControl><Textarea {...field} rows={3} data-testid="input-housing-wish" aria-label="Décrivez votre recherche" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void promptForm.handleSubmit(onCreate)(); } }} placeholder="Ex. Un appartement à Bordeaux, proche du tram, avec deux chambres et un budget de 1 300 €…" className="min-h-[92px] resize-none border-0 bg-transparent px-3 py-2 text-base shadow-none placeholder:text-stone-soft focus-visible:ring-0 md:text-base"/></FormControl>
            <FormMessage className="px-3 pt-1"/>
          </FormItem>}/>
          <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
            <span className="hidden text-xs text-stone-soft sm:inline">Entrée pour lancer · Maj + Entrée pour une nouvelle ligne</span>
            <Button data-testid="button-start-search" type="submit" disabled={create.isPending} aria-label="Lancer la recherche" className="ml-auto h-11 rounded-full px-5 bg-brand px-4 text-sm font-medium text-paper hover:bg-brand-dark disabled:opacity-40">
              {create.isPending ? 'Préparation…' : <>Rechercher <ArrowUp size={16} className="ml-1.5"/></>}
            </Button>
          </div>
        </form>
      </Form>
      {localError && <div role="alert" className="mt-5 text-left"><ErrorNotice message={localError}/></div>}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {suggestions.map(({ icon: Icon, text: suggestion }, index) => <button key={suggestion} type="button" data-testid={`button-suggestion-${index}`} onClick={() => { promptForm.setValue('prompt', suggestion, { shouldValidate: true }); promptForm.setFocus('prompt'); }} className="inline-flex items-center rounded-full border border-line bg-paper px-4 py-2.5 text-sm text-ink shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime"><Icon size={16} aria-hidden="true" className="mr-2 shrink-0 text-brand"/>{suggestion}</button>)}
      </div>
    </section>

    <section aria-label="Comment ça marche" className="mx-auto max-w-5xl px-5 pb-14">
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map(({ icon: Icon, ...step }, index) => <div key={step.title} className="rounded-3xl bg-sage p-6">
          <div className="mb-3 flex items-center gap-3"><span aria-hidden="true" className="grid size-11 place-items-center rounded-2xl bg-brand-wash text-brand"><Icon size={22} strokeWidth={1.75}/></span><span className="text-xs font-semibold text-brand-deep">Étape {index + 1}</span></div>
          <h2 className="text-lg font-semibold">{step.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-stone">{step.text}</p>
        </div>)}
      </div>
    </section>

    <section id="recherches" className="mx-auto max-w-3xl px-5 pb-20 pt-6">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-stone">Recherches récentes</h2>
        <Link href="/searches" data-testid="link-all-searches" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-stone transition-colors hover:text-ink">Tout voir <ArrowRight size={14} aria-hidden="true"/></Link>
      </div>
      {history.isLoading ? <div className="space-y-2">{[0,1,2].map(i=><Skeleton key={i} className="h-16 rounded-2xl bg-sage"/>)}</div> :
        history.isError ? <ErrorNotice message="Impossible de charger vos recherches pour le moment." retry={()=>history.refetch()}/> :
        !history.data?.length ? <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-7 py-12 text-center">
          <div className="mb-4 grid size-11 place-items-center rounded-full bg-sage text-stone"><Search size={20}/></div>
          <h3 className="text-base font-semibold">Pas encore de recherche</h3>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-stone">Décrivez votre location idéale ci-dessus. Vos recherches et leurs résultats apparaîtront ici.</p>
          <button data-testid="button-go-to-prompt" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4">Lancer ma première recherche <ArrowRight size={14}/></button>
        </div> :
        <div className="space-y-2">{history.data.slice(0, 3).map(item=><Link key={item.id} href={`/searches/${item.id}`} data-testid={`link-search-${item.id}`} className="group flex items-center gap-4 rounded-2xl border border-line px-5 py-4 transition-colors hover:bg-mist">
          <span className="min-w-0 flex-1"><strong className="block truncate text-[15px] font-semibold">{item.criteria.location || item.prompt}</strong><span className="mt-0.5 block truncate text-sm text-stone">{item.prompt}</span></span>
          <span className="hidden text-xs text-stone-soft sm:block">{formatDate(item.createdAt)}</span>
          <span data-testid={`status-search-${item.id}`} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-sage px-3 py-1 text-xs font-medium text-stone">{item.status==='running'?<span className="pulse-dot size-2 rounded-full bg-lime"/>:item.status==='failed'?<X size={13} className="text-brick"/>:<Check size={13} className="text-moss"/>} {item.status==='running'?'En cours':item.status==='failed'?'Échouée':`${item.count} annonce${item.count>1?'s':''}`}</span>
          <ChevronRight size={16} className="hidden text-stone-soft transition-transform group-hover:translate-x-0.5 sm:block"/>
        </Link>)}</div>}
    </section>
  </main>;
}
