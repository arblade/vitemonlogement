import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateHousingSearch, useListHousingSearches, getListHousingSearchesQueryKey, getGetHousingSearchQueryKey } from '@workspace/api-client-react';
import { ArrowRight, ArrowUpRight, Check, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { ErrorNotice, Eyebrow, formatDate } from '@/components/site-shell';

const suggestions = [
  'Un deux-pièces lumineux à Lyon, proche du métro, moins de 1 100 € par mois',
  'Une maison à louer avec jardin autour de Nantes, 3 chambres, jusqu’à 1 200 € par mois',
  'Un appartement calme à Paris 11e avec balcon, au moins 45 m²',
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
  const promptForm = useForm<PromptForm>({ defaultValues: { prompt: 'Je cherche à louer un logement à Quimper entre 400 € et 1 200 € par mois, avec une place de parking et une surface entre 30 et 50 m².' } });
  const [localError, setLocalError] = useState('');
  const create = useCreateHousingSearch();
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
    <section className="relative overflow-hidden bg-[#292635] text-[#f5f3eb]">
      <div className="grid-paper absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute -right-[20rem] -top-[20rem] size-[56rem] rounded-full border border-[#dfe89b]/15 sm:right-[-9rem] sm:top-[-17rem]"/>
      <div className="pointer-events-none absolute -right-[15rem] -top-[15rem] size-[45rem] rounded-full border border-[#dfe89b]/15 sm:right-[-3rem] sm:top-[-11rem]"/>
      <div className="pointer-events-none absolute -right-[10rem] -top-[10rem] size-[34rem] rounded-full border border-[#dfe89b]/15 sm:right-[3rem] sm:top-[-5rem]"/>
      <div className="relative mx-auto max-w-[1440px] px-5 pb-16 pt-12 md:px-10 md:pb-24 md:pt-20 lg:px-16">
        <div className="reveal mb-8 flex items-center gap-2 font-data text-[10px] uppercase tracking-[.2em] text-[#dfe89b]"><span className="h-px w-7 bg-[#dfe89b]"/> Votre prochain chez-vous commence ici</div>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-end lg:gap-16">
          <div className="reveal">
            <h1 className="max-w-[880px] text-[clamp(3.6rem,7vw,7.5rem)] font-semibold leading-[.94] tracking-[-.075em]">Décrivez une vie.<br/><span className="font-editorial font-normal italic tracking-[-.035em] text-[#dfe89b]">Trouvez son adresse.</span></h1>
            <p className="mt-8 max-w-[590px] text-[16px] leading-relaxed text-[#c4c2c6] md:text-[18px]">Dites-nous ce qui compte vraiment. Nous transformons vos mots en critères clairs, puis en annonces que vous pouvez vérifier.</p>
          </div>
          <div className="reveal reveal-delay hidden max-w-[380px] justify-self-end border-l border-[#dfe89b]/35 pl-7 lg:block">
            <span className="font-data text-[10px] uppercase tracking-[.18em] text-[#dfe89b]">La méthode Logiscope</span>
            <p className="mt-3 font-editorial text-[28px] leading-[1.1] italic">Vos envies d’abord. Les faits ensuite.</p>
            <p className="mt-4 text-[12px] leading-relaxed text-[#aaa8ae]">Chaque observation distingue ce que dit l’annonce de ce que l’IA déduit, avec sa preuve à l’appui.</p>
          </div>
        </div>
        <div className="reveal reveal-delay mt-12 max-w-[1000px] rounded-[18px] border border-[#62606c] bg-[#f5f3eb] p-2 text-[#292635] shadow-[0_22px_80px_rgba(13,12,22,.2)] md:mt-16 md:p-3">
          <Form {...promptForm}>
            <form onSubmit={promptForm.handleSubmit(onCreate)} className="flex flex-col gap-2 md:flex-row md:items-stretch">
              <FormField control={promptForm.control} name="prompt" rules={{ required: 'Décrivez le logement recherché.', minLength: { value: 10, message: 'Décrivez votre recherche en au moins 10 caractères.' }, maxLength: { value: 1000, message: 'Limitez votre description à 1 000 caractères.' } }} render={({ field }) => <FormItem className="min-w-0 flex-1 space-y-0">
                <FormControl><Textarea {...field} data-testid="input-housing-wish" aria-label="Décrivez votre recherche" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void promptForm.handleSubmit(onCreate)(); } }} placeholder="Ex. Je cherche un appartement lumineux à Bordeaux, proche du tram, avec deux chambres et un budget de 1 300 €…" className="min-h-[116px] resize-none border-0 bg-transparent px-4 py-4 text-[16px] leading-relaxed shadow-none placeholder:text-[#929086] focus-visible:ring-0 md:min-h-[102px]"/></FormControl><FormMessage className="px-4 pb-2"/>
              </FormItem>}/>
              <Button data-testid="button-start-search" type="submit" disabled={create.isPending} className="group h-auto min-h-[56px] rounded-[11px] bg-[#dfe89b] px-7 text-[13px] font-bold text-[#292635] hover:bg-[#d3e277] md:min-w-[194px]">
                {create.isPending ? 'Recherche en préparation…' : 'Lancer la recherche'} <ArrowRight size={17} className="ml-2 transition-transform group-hover:translate-x-1"/>
              </Button>
            </form>
          </Form>
        </div>
        {localError && <div role="alert" className="mt-5 max-w-[1000px]"><ErrorNotice message={localError}/></div>}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[#aaa8ae]"><span className="font-data uppercase tracking-[.12em] text-[#dfe89b]">À savoir</span><span>Entrée pour rechercher · Maj + Entrée pour une nouvelle ligne</span><span className="hidden sm:inline">·</span><span>5 nouvelles annonces maximum par appel, sans perdre les anciennes</span></div>
      </div>
    </section>

    <section className="mx-auto max-w-[1440px] px-5 py-14 md:px-10 md:py-20 lg:px-16">
      <div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr] lg:gap-24">
        <div>
          <Eyebrow number="01">La conversation</Eyebrow>
          <h2 className="mt-6 max-w-[380px] text-[35px] font-semibold leading-[1.05] tracking-[-.055em] md:text-[48px]">Pas besoin de parler <span className="font-editorial font-normal italic text-[#7d874e]">immobilier.</span></h2>
          <p className="mt-5 max-w-[380px] text-sm leading-relaxed text-[#77746a]">Une phrase suffit. Vos priorités, votre quartier, votre façon de vivre : écrivez comme vous le feriez à un ami.</p>
        </div>
        <div>
          <p className="mb-4 font-data text-[10px] uppercase tracking-[.16em] text-[#77746a]">Quelques façons de commencer</p>
          <div className="space-y-2">
            {suggestions.map((suggestion, index) => <button key={suggestion} type="button" data-testid={`button-suggestion-${index}`} onClick={() => { promptForm.setValue('prompt', suggestion, { shouldValidate: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="group flex w-full items-start justify-between gap-4 rounded-xl border border-[#d9d6c9] bg-[#fbfaf5] px-5 py-5 text-left text-sm leading-relaxed transition-all hover:-translate-y-0.5 hover:border-[#9ba664] hover:shadow-[0_10px_24px_rgba(38,35,50,.06)]">
              <span className="flex gap-4"><span className="font-data text-[10px] text-[#9ba664]">0{index+1}</span>{suggestion}</span><ArrowUpRight size={17} className="mt-0.5 shrink-0 text-[#8d925f] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"/>
            </button>)}
          </div>
        </div>
      </div>
    </section>

    <section id="recherches" className="scroll-mt-12 mx-auto max-w-[1440px] px-5 py-16 md:px-10 md:py-24 lg:px-16">
       <div className="mb-8 flex items-end justify-between gap-4"><div><Eyebrow number="02">Vos recherches</Eyebrow><h2 className="mt-5 text-[36px] font-semibold tracking-[-.055em] md:text-[52px]">Reprendre le fil<span className="font-editorial font-normal italic text-[#899259]">.</span></h2></div><span className="hidden font-data text-[10px] uppercase tracking-[.1em] text-[#8a887e] sm:block">Historique des explorations</span></div>
      {history.isLoading ? <div className="space-y-3">{[0,1,2].map(i=><Skeleton key={i} className="h-24 rounded-xl bg-[#e7e5da]"/>)}</div> :
        history.isError ? <ErrorNotice message="Impossible de charger vos recherches pour le moment." retry={()=>history.refetch()}/> :
        !history.data?.length ? <div className="flex flex-col items-start rounded-2xl border border-dashed border-[#c8c8b8] bg-[#eeeee4] px-7 py-12 md:px-12">
          <div className="mb-6 grid size-12 place-items-center rounded-full bg-[#dfe6b8]"><Search size={21}/></div>
          <h3 className="text-xl font-semibold tracking-tight">Tout commence par une idée de lieu.</h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[#77776d]">Vos recherches apparaîtront ici. Pour l’instant, racontez-nous le logement que vous imaginez.</p>
          <button data-testid="button-go-to-prompt" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})} className="mt-5 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4">Décrire mon projet <ArrowRight size={15}/></button>
        </div> :
        <div className="divide-y divide-[#d9d6c9] border-y border-[#d9d6c9]">{history.data.map(item=><Link key={item.id} href={`/searches/${item.id}`} data-testid={`link-search-${item.id}`} className="group grid gap-3 py-6 transition-colors hover:bg-[#eeeee5] md:grid-cols-[105px_1fr_150px_28px] md:items-center md:gap-7 md:px-4">
          <span className="font-data text-[10px] text-[#89877d]">{formatDate(item.createdAt)}</span>
          <span className="min-w-0"><strong className="block truncate text-[17px] font-semibold tracking-tight">{item.criteria.location || item.prompt}</strong><span className="mt-1 block truncate text-xs text-[#77746a]">{item.prompt}</span></span>
          <span data-testid={`status-search-${item.id}`} className="inline-flex w-fit items-center gap-2 font-data text-[10px] uppercase tracking-[.06em] text-[#5e634a]">{item.status==='running'?<span className="pulse-dot size-2 rounded-full bg-[#a1ac62]"/>:item.status==='failed'?<X size={13} className="text-[#a64c45]"/>:<Check size={13}/>} {item.status==='running'?'En cours':item.status==='failed'?'Échouée':`${item.count} annonce${item.count>1?'s':''}`}</span>
          <ChevronRight size={18} className="hidden text-[#9b9c85] transition-transform group-hover:translate-x-1 md:block"/>
        </Link>)}</div>}
    </section>
     <section className="bg-[#e9ebdc]"><div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-12 md:grid-cols-[1fr_1fr] md:items-center md:px-10 lg:px-16"><div><div className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[.13em] text-[#747d51]"><SlidersHorizontal size={15}/> Une recherche à taille humaine</div><p className="mt-3 max-w-lg font-editorial text-[27px] leading-tight italic text-[#343341]">Moins de bruit. Plus de contexte pour décider.</p></div><p className="max-w-md text-[13px] leading-relaxed text-[#66695c] md:justify-self-end">Chaque appel récupère <strong>5 nouvelles annonces maximum</strong>. Un rafraîchissement conserve les résultats précédents sans doublons. La lecture et l’analyse IA se font automatiquement ; les observations indiquent leur origine et leur extrait justificatif.</p></div></section>
  </main>;
}