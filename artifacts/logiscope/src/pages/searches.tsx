import { Link } from 'wouter';
import { useListHousingSearches, getListHousingSearchesQueryKey } from '@workspace/api-client-react';
import { ArrowRight, Check, ChevronRight, Search, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice, formatDate } from '@/components/site-shell';

export default function Searches() {
  const history = useListHousingSearches({
    query: {
      queryKey: getListHousingSearchesQueryKey(),
      refetchInterval: query => query.state.data?.some(item => item.status === 'running') ? 4000 : false,
    },
  });

  return <main className="min-h-[75dvh] text-[#292635]">
    <section className="border-b border-[#d9d6c9] bg-[#e9ebdc]">
      <div className="mx-auto max-w-[1440px] px-5 pb-10 pt-11 md:px-10 md:pb-14 md:pt-16 lg:px-16">
        <div className="flex items-center gap-3 font-data text-[10px] uppercase tracking-[.17em] text-[#757956]">
          <span className="grid size-6 place-items-center rounded-full border border-[#a8af77]">01</span>
          Votre espace de recherche
        </div>
        <div className="mt-5 flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-[clamp(2.8rem,6vw,5.4rem)] font-semibold leading-[.98] tracking-[-.065em]">Mes recherches<span className="font-editorial font-normal italic text-[#899259]">.</span></h1>
            <p className="mt-5 max-w-[540px] text-sm leading-relaxed text-[#686b5d] md:text-base">Retrouvez vos recherches locatives, suivez celles en cours et reprenez vos résultats là où vous les avez laissés.</p>
          </div>
          <Link href="/" data-testid="link-new-search-page" className="group inline-flex w-fit shrink-0 items-center gap-3 rounded-[11px] bg-[#292635] px-5 py-4 text-[13px] font-semibold text-[#f5f3eb] transition-colors hover:bg-[#454151]">
            Nouvelle recherche <ArrowRight size={17} aria-hidden="true" className="transition-transform group-hover:translate-x-1"/>
          </Link>
        </div>
      </div>
    </section>

    <section aria-label="Historique des recherches" className="mx-auto max-w-[1440px] px-5 pb-20 pt-10 md:px-10 md:pb-28 md:pt-14 lg:px-16">
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-[#d9d6c9] pb-4">
        <span className="font-data text-[10px] uppercase tracking-[.16em] text-[#77746a]">Historique</span>
        {!history.isLoading && !history.isError && !!history.data?.length && <span data-testid="text-search-count" className="font-data text-[10px] uppercase tracking-[.12em] text-[#77746a]">{history.data.length} recherche{history.data.length > 1 ? 's' : ''}</span>}
      </div>

      {history.isLoading ? <div data-testid="status-searches-loading" role="status" aria-label="Chargement de vos recherches" className="space-y-2">
        <span className="sr-only">Chargement de vos recherches…</span>
        {[0, 1, 2].map(index => <Skeleton key={index} className="h-24 rounded-xl bg-[#e7e5da] md:h-20"/>)}
      </div> : history.isError ? <ErrorNotice message="Impossible de charger vos recherches pour le moment." retry={() => { void history.refetch(); }}/> : !history.data?.length ? <div data-testid="status-searches-empty" className="flex flex-col items-start rounded-2xl border border-dashed border-[#c8c8b8] bg-[#eeeee4] px-7 py-12 md:px-12 md:py-16">
        <div className="mb-6 grid size-12 place-items-center rounded-full bg-[#dfe6b8]"><Search size={21} aria-hidden="true"/></div>
        <h2 className="text-xl font-semibold tracking-tight">Votre historique commence ici.</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[#77776d]">Décrivez le logement que vous cherchez. Vos recherches et leurs résultats apparaîtront ici.</p>
        <Link href="/" data-testid="link-first-search" className="group mt-6 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4">Lancer ma première recherche <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-1"/></Link>
      </div> : <div className="divide-y divide-[#d9d6c9] border-b border-[#d9d6c9]">
        {history.data.map(item => <Link key={item.id} href={`/searches/${item.id}`} data-testid={`link-search-${item.id}`} aria-label={`Voir la recherche ${item.criteria?.location || item.prompt}`} className="group grid gap-3 py-6 transition-colors hover:bg-[#eeeee5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#899259] md:grid-cols-[125px_minmax(0,1fr)_160px_24px] md:items-center md:gap-7 md:px-4">
          <span className="font-data text-[10px] text-[#89877d]">{formatDate(item.createdAt)}</span>
          <span className="min-w-0">
            <strong data-testid={`text-search-title-${item.id}`} className="block truncate text-[17px] font-semibold tracking-tight">{item.criteria?.location || item.prompt}</strong>
            <span className="mt-1 block truncate text-xs text-[#77746a]">{item.prompt}</span>
          </span>
          <span data-testid={`status-search-${item.id}`} role="status" aria-label={item.status === 'running' ? 'Recherche en cours' : item.status === 'failed' ? 'Recherche échouée' : `${item.count} annonce${item.count > 1 ? 's' : ''} trouvée${item.count > 1 ? 's' : ''}`} className={`inline-flex w-fit items-center gap-2 font-data text-[10px] uppercase tracking-[.06em] ${item.status === 'failed' ? 'text-[#a64c45]' : 'text-[#5e634a]'}`}>
            {item.status === 'running' ? <span className="pulse-dot size-2 rounded-full bg-[#a1ac62]" aria-hidden="true"/> : item.status === 'failed' ? <X size={13} aria-hidden="true"/> : <Check size={13} aria-hidden="true"/>}
            {item.status === 'running' ? 'En cours' : item.status === 'failed' ? 'Échouée' : `${item.count} annonce${item.count > 1 ? 's' : ''}`}
          </span>
          <ChevronRight size={18} aria-hidden="true" className="hidden text-[#9b9c85] transition-transform group-hover:translate-x-1 md:block"/>
        </Link>)}
      </div>}
    </section>
  </main>;
}