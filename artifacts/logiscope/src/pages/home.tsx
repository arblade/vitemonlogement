import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateHousingSearch, useListHousingSearches, getListHousingSearchesQueryKey, getGetHousingSearchQueryKey } from '@workspace/api-client-react';
import { ArrowRight, Check, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { ErrorNotice, formatDate } from '@/components/site-shell';

const suggestions = [
  'Un studio à Lille, 650 € maximum, chat accepté',
  'Un T2 à Lyon, 1 200 € maximum, avec ascenseur',
  'Une maison à Nantes, 3 chambres, avec jardin',
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
    <section className="bg-[#292635] text-[#f5f3eb]">
      <div className="mx-auto max-w-[1440px] px-5 py-10 md:px-10 md:py-14 lg:px-16">
        <p className="font-data text-[11px] uppercase tracking-[.15em] text-[#dfe89b]">Rechercher une location</p>
        <h1 className="mt-4 max-w-[900px] text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-[1.05] tracking-[-.055em]">Décrivez le logement que vous cherchez.</h1>
        <p className="mt-4 max-w-[760px] text-sm leading-relaxed text-[#d1cfd4] md:text-base">Indiquez la ville, votre budget et ce qui compte pour vous. Vite mon logement parcourt les annonces et indique quels critères sont confirmés ou restent à vérifier.</p>
        <div className="mt-8 max-w-[1000px] rounded-xl bg-[#f5f3eb] p-2 text-[#292635] md:p-3">
          <Form {...promptForm}>
            <form onSubmit={promptForm.handleSubmit(onCreate)} className="flex flex-col gap-2 md:flex-row md:items-stretch">
              <FormField control={promptForm.control} name="prompt" rules={{ required: 'Décrivez le logement recherché.', minLength: { value: 10, message: 'Décrivez votre recherche en au moins 10 caractères.' }, maxLength: { value: 1000, message: 'Limitez votre description à 1 000 caractères.' } }} render={({ field }) => <FormItem className="min-w-0 flex-1 space-y-0">
                <FormControl><Textarea {...field} data-testid="input-housing-wish" aria-label="Décrivez votre recherche" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void promptForm.handleSubmit(onCreate)(); } }} placeholder="Ex. Je cherche un appartement à Bordeaux, proche du tram, avec deux chambres et un budget de 1 300 €…" className="min-h-[116px] resize-none border-0 bg-transparent px-4 py-4 text-[16px] leading-relaxed shadow-none placeholder:text-[#929086] focus-visible:ring-0 md:min-h-[102px]"/></FormControl><FormMessage className="px-4 pb-2"/>
              </FormItem>}/>
              <Button data-testid="button-start-search" type="submit" disabled={create.isPending} className="group h-auto min-h-[56px] rounded-[11px] bg-[#dfe89b] px-7 text-[13px] font-bold text-[#292635] hover:bg-[#d3e277] md:min-w-[194px]">
                {create.isPending ? 'Recherche en préparation…' : 'Lancer la recherche'} <ArrowRight size={17} className="ml-2 transition-transform group-hover:translate-x-1"/>
              </Button>
            </form>
          </Form>
        </div>
        {localError && <div role="alert" className="mt-5 max-w-[1000px]"><ErrorNotice message={localError}/></div>}
        <p className="mt-3 text-xs text-[#c4c2c6]">Entrée pour lancer la recherche · Maj + Entrée pour une nouvelle ligne</p>
        <div className="mt-6 flex max-w-[1000px] flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[#c4c2c6]">Exemples :</span>
          {suggestions.map((suggestion, index) => <button key={suggestion} type="button" data-testid={`button-suggestion-${index}`} onClick={() => { promptForm.setValue('prompt', suggestion, { shouldValidate: true }); promptForm.setFocus('prompt'); }} className="rounded-full border border-[#777382] px-3 py-2 text-left text-xs text-[#f5f3eb] transition-colors hover:border-[#dfe89b] hover:bg-[#3c3947] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfe89b]">{suggestion}</button>)}
        </div>
      </div>
    </section>

    <section id="recherches" className="mx-auto max-w-[1440px] px-5 py-10 md:px-10 md:py-14 lg:px-16">
       <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
         <h2 className="text-2xl font-semibold tracking-[-.04em] md:text-3xl">Recherches récentes</h2>
         <Link href="/searches" data-testid="link-all-searches" className="inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4 hover:text-[#6b7848]">Toutes mes recherches <ArrowRight size={16} aria-hidden="true"/></Link>
       </div>
      {history.isLoading ? <div className="space-y-3">{[0,1,2].map(i=><Skeleton key={i} className="h-24 rounded-xl bg-[#e7e5da]"/>)}</div> :
        history.isError ? <ErrorNotice message="Impossible de charger vos recherches pour le moment." retry={()=>history.refetch()}/> :
        !history.data?.length ? <div className="flex flex-col items-start rounded-2xl border border-dashed border-[#c8c8b8] bg-[#eeeee4] px-7 py-12 md:px-12">
          <div className="mb-6 grid size-12 place-items-center rounded-full bg-[#dfe6b8]"><Search size={21}/></div>
          <h3 className="text-xl font-semibold tracking-tight">Pas encore de recherche ?</h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[#77776d]">Décrivez votre location idéale en quelques mots. Vos recherches et leurs résultats apparaîtront ici.</p>
          <button data-testid="button-go-to-prompt" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})} className="mt-5 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4">Lancer ma première recherche <ArrowRight size={15}/></button>
        </div> :
         <div className="divide-y divide-[#d9d6c9] border-y border-[#d9d6c9]">{history.data.slice(0, 3).map(item=><Link key={item.id} href={`/searches/${item.id}`} data-testid={`link-search-${item.id}`} className="group grid gap-3 py-5 transition-colors hover:bg-[#eeeee5] md:grid-cols-[105px_1fr_150px_28px] md:items-center md:gap-7 md:px-4">
          <span className="font-data text-[10px] text-[#89877d]">{formatDate(item.createdAt)}</span>
          <span className="min-w-0"><strong className="block truncate text-[17px] font-semibold tracking-tight">{item.criteria.location || item.prompt}</strong><span className="mt-1 block truncate text-xs text-[#77746a]">{item.prompt}</span></span>
          <span data-testid={`status-search-${item.id}`} className="inline-flex w-fit items-center gap-2 font-data text-[10px] uppercase tracking-[.06em] text-[#5e634a]">{item.status==='running'?<span className="pulse-dot size-2 rounded-full bg-[#a1ac62]"/>:item.status==='failed'?<X size={13} className="text-[#a64c45]"/>:<Check size={13}/>} {item.status==='running'?'En cours':item.status==='failed'?'Échouée':`${item.count} annonce${item.count>1?'s':''}`}</span>
          <ChevronRight size={18} className="hidden text-[#9b9c85] transition-transform group-hover:translate-x-1 md:block"/>
        </Link>)}</div>}
    </section>
  </main>;
}