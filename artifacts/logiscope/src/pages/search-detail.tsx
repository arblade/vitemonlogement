import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetHousingSearch, getGetHousingSearchQueryKey, useAnalyzeHousingSearch, getListHousingSearchesQueryKey, type HousingListing } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Clock3, ExternalLink, Info, Layers2, MapPin, Search, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice, Eyebrow, formatDate, formatPrice } from '@/components/site-shell';

function ListingCard({ listing, index, selected, compareFull, onSelect }: { listing: HousingListing; index: number; selected: boolean; compareFull: boolean; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const features = listing.features || [];
  const announcementFeatures = features.filter(feature => feature.source === 'annonce');
  const aiFeatures = features.filter(feature => feature.source === 'ia');
  return <article data-testid={`card-listing-${listing.id}`} className="group overflow-hidden rounded-2xl border border-[#dddace] bg-[#fbfaf5] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#afb597] hover:shadow-[0_12px_34px_rgba(34,32,44,.08)]">
    <div className="grid md:grid-cols-[260px_1fr] xl:grid-cols-[310px_1fr]">
      <div className="relative min-h-[220px] overflow-hidden bg-[#dce1ca] md:min-h-full">
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_80%_25%,#e9eecf_0%,#d8dfc3_55%,#c6d0b0_100%)]">
          <div className="relative size-32 rotate-[-13deg] border border-[#929d79]/50"><div className="absolute left-1/3 top-0 h-full w-px bg-[#929d79]/50"/><div className="absolute right-0 top-1/2 h-px w-2/3 bg-[#929d79]/50"/><span className="absolute -bottom-8 -left-4 font-editorial text-[90px] italic leading-none text-[#74845e]/50">{String(index+1).padStart(2,'0')}</span></div>
        </div>
        {listing.image ? <img src={listing.image} alt={`Photo de ${listing.title}`} className="relative h-full max-h-[350px] w-full object-cover transition-transform duration-500 group-hover:scale-[1.025] md:max-h-none" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}
        <span className="absolute left-4 top-4 rounded-full bg-[#fbfaf5] px-3 py-1.5 font-data text-[10px] uppercase tracking-[.09em] text-[#343341]">Annonce {String(index+1).padStart(2,'0')}</span>
      </div>
      <div className="relative z-10 flex flex-col p-5 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><div className="mb-2 flex items-center gap-1.5 font-data text-[10px] uppercase tracking-[.08em] text-[#79835b]"><MapPin size={12}/>{listing.location || 'Localisation non précisée'}</div><h3 data-testid={`text-listing-title-${listing.id}`} className="text-[21px] font-semibold leading-[1.15] tracking-[-.04em] md:text-[24px]">{listing.title}</h3></div>
          <div className="shrink-0 rounded-lg bg-[#e9edcf] px-2.5 py-2 text-center"><span className="block font-data text-[16px] font-bold leading-none">{Math.round(listing.score)}<span className="text-[10px]">/100</span></span><span className="mt-1 block text-[8px] uppercase tracking-[.05em]">pertinence</span></div>
        </div>
        <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#e4e1d6] pb-5">
          <strong data-testid={`text-listing-price-${listing.id}`} className="text-[22px] font-semibold tracking-[-.04em]">{formatPrice(listing.price)}</strong>
          <span className="text-xs text-[#77746a]">{listing.area != null ? `${listing.area} m²` : 'Surface non précisée'} <span className="mx-1.5 text-[#b2afa2]">/</span> {listing.rooms != null ? `${listing.rooms} pièce${listing.rooms>1?'s':''}` : 'Pièces non précisées'}</span>
        </div>
        <p className={`mt-4 text-[13px] leading-[1.7] text-[#6f6d67] ${expanded ? '' : 'line-clamp-2'}`}>{listing.description || 'Description non fournie par l’annonce.'}</p>
        {listing.description?.length > 150 && <button type="button" data-testid={`button-description-${listing.id}`} onClick={()=>setExpanded(!expanded)} className="mt-1 w-fit text-xs font-semibold text-[#676f46] underline underline-offset-4">{expanded?'Réduire':'Lire la description'}</button>}
        {!!features.length && <div className="mt-5 space-y-2">
          {announcementFeatures.slice(0,3).map((feature,i)=><div key={`annonce-${i}`} className="flex items-start gap-2 text-xs"><Check size={14} className="mt-0.5 shrink-0 text-[#718049]"/><span><strong className="font-semibold">{feature.label}</strong>{feature.value ? ` · ${feature.value}` : ''}</span></div>)}
          {aiFeatures.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8ebd5] px-2.5 py-1 font-data text-[9px] uppercase tracking-[.04em] text-[#5f6b46]"><Sparkles size={11}/>{aiFeatures.length} observation{aiFeatures.length>1?'s':''} IA</span>}
        </div>}
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
          <a href={listing.url} target="_blank" rel="noopener noreferrer" data-testid={`link-source-${listing.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#292635] px-4 text-xs font-semibold text-[#e2eaa5] transition-colors hover:bg-[#484354]">Voir l’annonce <ArrowUpRight size={15}/></a>
          <button type="button" data-testid={`button-compare-${listing.id}`} onClick={onSelect} disabled={compareFull && !selected} title={compareFull && !selected ? 'Retirez une annonce pour en comparer une autre' : undefined} aria-pressed={selected} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${selected?'border-[#939e5b] bg-[#e7edcb] text-[#4f5d36]':'border-[#d5d2c4] hover:border-[#939e5b]'}`}>{selected?<Check size={14}/>:<Layers2 size={14}/>} {selected?'Ajouté au comparatif':compareFull?'Limite de 3 atteinte':'Comparer'}</button>
        </div>
      </div>
    </div>
    {!!features.length && <details className="border-t border-[#e4e1d6] px-5 py-4 md:px-6">
      <summary data-testid={`toggle-evidence-${listing.id}`} className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-[#555e42] [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2"><Info size={15}/> Voir les faits et leurs sources ({features.length})</span><ChevronDown size={15} className="transition-transform [[open]>&]:rotate-180"/></summary>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">{features.map((feature,i)=><div key={`${feature.label}-${i}`} className="rounded-lg border border-[#e5e3d9] bg-[#f5f3ec] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong className="text-[13px]">{feature.label}{feature.value?` · ${feature.value}`:''}</strong><span className={`rounded-full px-2 py-1 font-data text-[9px] uppercase ${feature.source==='ia'?'bg-[#e5ebc6] text-[#52613c]':'bg-[#e9e6df] text-[#68665f]'}`}>{feature.source==='ia'?'Observation IA':'Dans l’annonce'}</span></div>
        <p className="text-[12px] leading-relaxed text-[#77746a]"><span className="font-semibold text-[#55534d]">Extrait justificatif : </span>{feature.evidence || 'Aucun extrait fourni.'}</p>
      </div>)}</div>
      {aiFeatures.length>0 && <p className="mt-4 text-[11px] leading-relaxed text-[#77746a]">Les observations IA interprètent le texte de l’annonce. Elles ne remplacent ni une visite ni une vérification auprès du vendeur ou du bailleur.</p>}
    </details>}
  </article>;
}

export default function SearchDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sort, setSort] = useState<'score'|'price'|'area'>('score');
  const [analysisError, setAnalysisError] = useState('');
  const search = useGetHousingSearch(id, { query: { queryKey: getGetHousingSearchQueryKey(id), enabled: validId, refetchInterval: query => query.state.data?.status === 'running' ? 3500 : false } });
  const analyze = useAnalyzeHousingSearch();
  const data = search.data;
  const listings = [...(data?.listings || [])].sort((a,b)=>sort==='price'?(a.price ?? Infinity)-(b.price ?? Infinity):sort==='area'?(b.area ?? -1)-(a.area ?? -1):b.score-a.score);
  const selected = listings.filter(item=>selectedIds.includes(item.id));
  const toggle = (listingId: number) => setSelectedIds(current=>current.includes(listingId)?current.filter(id=>id!==listingId):current.length<3?[...current,listingId]:current);
  const onAnalyze = async () => {
    setAnalysisError('');
    try {
      const updated = await analyze.mutateAsync({ id });
      queryClient.setQueryData(getGetHousingSearchQueryKey(id), updated);
      await queryClient.invalidateQueries({ queryKey: getListHousingSearchesQueryKey() });
    } catch { setAnalysisError('L’analyse n’a pas abouti. Les annonces restent disponibles ; vous pourrez réessayer.'); }
  };

  if (!validId) return <main className="mx-auto min-h-[70dvh] max-w-[1100px] px-5 py-24"><Eyebrow number="—">Adresse introuvable</Eyebrow><h1 className="mt-5 text-5xl font-semibold tracking-tight">Cette recherche n’existe pas.</h1><Link href="/" data-testid="link-back-invalid" className="mt-8 inline-flex items-center gap-2 underline underline-offset-4"><ArrowLeft size={16}/> Retour à l’accueil</Link></main>;
  return <main className="min-h-[75dvh]">
    <section className="bg-[#292635] text-[#f5f3eb]">
      <div className="grid-paper mx-auto max-w-[1440px] px-5 pb-12 pt-8 md:px-10 md:pb-16 md:pt-12 lg:px-16">
        <Link href="/" data-testid="link-back-home" className="inline-flex items-center gap-2 text-xs text-[#c5c3c9] transition-colors hover:text-[#dfe89b]"><ArrowLeft size={15}/> Toutes mes recherches</Link>
        {search.isLoading ? <div className="mt-12 space-y-4"><Skeleton className="h-16 w-2/3 bg-[#454252]"/><Skeleton className="h-5 w-1/3 bg-[#454252]"/></div> : data ? <>
          <div className="mt-10 flex flex-wrap items-center gap-3 font-data text-[10px] uppercase tracking-[.12em] text-[#dfe89b]"><span>Recherche / {String(data.id).padStart(3,'0')}</span><span className="h-px w-6 bg-[#dfe89b]/40"/><span>{data.criteria.intent==='rent'?'Location':'Achat'}</span></div>
          <div className="mt-5 flex flex-col justify-between gap-7 lg:flex-row lg:items-end"><div><h1 data-testid="text-search-location" className="text-[clamp(3.1rem,6.6vw,6.7rem)] font-semibold leading-[.97] tracking-[-.07em]">{data.criteria.location || 'Votre recherche'}<span className="font-editorial font-normal italic text-[#dfe89b]">.</span></h1><p data-testid="text-search-prompt" className="mt-5 max-w-[700px] text-sm leading-relaxed text-[#c6c4ca]">“{data.prompt}”</p></div>
          <div className="flex shrink-0 flex-wrap gap-3 lg:justify-end"><span data-testid="status-search-detail" className="inline-flex items-center gap-2 rounded-full border border-[#777580] px-4 py-2 text-xs text-[#eeede8]">{data.status==='running'?<span className="pulse-dot size-2 rounded-full bg-[#dfe89b]"/>:data.status==='failed'?<X size={14}/>:<Check size={14}/>} {data.status==='running'?'Recherche en cours':data.status==='failed'?'Recherche interrompue':'Recherche terminée'}</span><span className="inline-flex items-center gap-2 rounded-full border border-[#777580] px-4 py-2 text-xs text-[#eeede8]"><Clock3 size={14}/>{formatDate(data.createdAt)}</span></div></div>
        </> : null}
      </div>
    </section>

    <div className="mx-auto max-w-[1440px] px-5 py-10 md:px-10 md:py-14 lg:px-16">
      {search.isError && <div className="max-w-2xl"><ErrorNotice message="Impossible de retrouver cette recherche. Vérifiez votre connexion puis réessayez." retry={()=>search.refetch()}/><Link href="/" data-testid="link-error-home" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4"><ArrowLeft size={15}/> Revenir à l’accueil</Link></div>}
      {search.isLoading && <div className="space-y-5"><div className="flex justify-between"><Skeleton className="h-12 w-48 bg-[#e6e4d8]"/><Skeleton className="h-12 w-40 bg-[#e6e4d8]"/></div>{[0,1,2].map(i=><Skeleton key={i} className="h-72 rounded-2xl bg-[#e6e4d8]"/>)}</div>}
      {data && <>
        <div className="mb-9 flex flex-col justify-between gap-6 border-b border-[#d9d6c9] pb-8 md:flex-row md:items-end">
          <div><Eyebrow number="01">Le résultat</Eyebrow><h2 data-testid="text-listing-count" className="mt-4 text-[38px] font-semibold leading-tight tracking-[-.055em] md:text-[52px]">{data.status==='running'?'On cherche pour vous':`${data.count} annonce${data.count>1?'s':''} à explorer`}<span className="font-editorial font-normal italic text-[#899259]">.</span></h2><p className="mt-2 text-xs text-[#77746a]">10 annonces maximum par recherche · Résultats issus des annonces disponibles</p></div>
          {data.status==='completed' && listings.length>0 && <div className="flex items-center gap-3"><label htmlFor="sort-results" className="font-data text-[10px] uppercase tracking-[.08em] text-[#77746a]">Trier par</label><select id="sort-results" data-testid="select-sort" value={sort} onChange={e=>setSort(e.target.value as typeof sort)} className="h-10 rounded-lg border border-[#d6d2c5] bg-[#fbfaf5] px-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#9aa464]"><option value="score">Pertinence</option><option value="price">Prix croissant</option><option value="area">Surface décroissante</option></select></div>}
        </div>
        {data.status==='running' && <div className="grid gap-7 lg:grid-cols-[1fr_320px]"><div className="space-y-4"><div className="flex items-center gap-3 rounded-xl border border-[#d7dcbc] bg-[#e9edcf] px-5 py-5 text-sm"><span className="pulse-dot size-2.5 rounded-full bg-[#87934d]"/> Les annonces arrivent. Cette page se met à jour automatiquement.</div>{[0,1,2].map(i=><Skeleton key={i} className="h-[240px] rounded-2xl bg-[#e8e6db]"/>)}</div><aside className="h-fit rounded-xl bg-[#e9ebdc] p-6"><Search size={22} className="text-[#7b8755]"/><h3 className="mt-5 text-lg font-semibold">Une sélection, pas une avalanche.</h3><p className="mt-3 text-xs leading-relaxed text-[#6d705d]">Nous cherchons jusqu’à 10 annonces qui correspondent à vos critères. Vous pourrez ouvrir chaque source et examiner les éléments retenus.</p></aside></div>}
        {data.status==='failed' && <div className="max-w-2xl"><ErrorNotice message={data.error || 'La recherche n’a pas pu se terminer. Essayez une nouvelle description.'}/><Link href="/" data-testid="link-new-after-failure" className="mt-6 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4">Faire une nouvelle recherche <ArrowRight size={15}/></Link></div>}
        {data.status==='completed' && <>
          <div className="mb-8 grid gap-5 rounded-2xl border border-[#d9d6c9] bg-[#e9ebdc] p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
            <div><div className="mb-2 flex items-center gap-2 font-data text-[10px] uppercase tracking-[.13em] text-[#626f49]"><Sparkles size={14}/> Regard complémentaire</div><h3 className="text-[22px] font-semibold tracking-[-.04em]">{data.analyzed?'Observations disponibles':'Envie d’aller un peu plus loin ?'}</h3><p className="mt-2 max-w-xl text-xs leading-relaxed text-[#66695a]">{data.analyzed?'Les observations sont signalées « Observation IA » dans les faits de chaque annonce, avec un extrait justificatif.':'L’analyse IA est facultative. Elle relève des indices dans le texte des annonces, jamais des certitudes. Chaque observation est accompagnée de sa source.'}</p></div>
            {!data.analyzed && listings.length>0 && <Button data-testid="button-analyze" onClick={onAnalyze} disabled={analyze.isPending} className="h-11 rounded-lg bg-[#292635] px-5 text-xs font-semibold text-[#e2eaa5] hover:bg-[#454050]">{analyze.isPending?'Analyse en cours…':'Analyser les annonces'}<ArrowRight size={15} className="ml-2"/></Button>}
          </div>
          {analysisError && <div className="mb-7"><ErrorNotice message={analysisError} retry={onAnalyze}/></div>}
          {listings.length===0 ? <div className="rounded-2xl border border-dashed border-[#c9c8b9] bg-[#eeeee5] px-7 py-14 md:px-12"><div className="mb-6 grid size-12 place-items-center rounded-full bg-[#dfe6b8]"><Search size={21}/></div><h3 className="text-xl font-semibold">Aucune annonce dans cette sélection.</h3><p className="mt-2 max-w-md text-sm leading-relaxed text-[#77746a]">Le marché bouge vite. Essayez d’élargir la zone, de revoir le budget ou de simplifier vos critères.</p><Link href="/" data-testid="link-empty-new-search" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4">Repartir d’une description <ArrowRight size={15}/></Link></div> :
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_290px]">
            <div className="space-y-5">{listings.map((listing,index)=><ListingCard key={listing.id} listing={listing} index={index} selected={selectedIds.includes(listing.id)} compareFull={selectedIds.length>=3} onSelect={()=>toggle(listing.id)}/>)}</div>
            <aside className="h-fit rounded-2xl border border-[#d9d6c9] bg-[#fbfaf5] p-6 lg:sticky lg:top-6"><span className="font-data text-[10px] uppercase tracking-[.13em] text-[#7b8559]">Votre boussole</span><h3 className="mt-4 font-editorial text-[28px] italic leading-tight">Les critères qui ont guidé cette sélection.</h3><div className="mt-6 space-y-3 border-t border-[#e4e1d6] pt-5 text-xs">{[
              ['Projet',data.criteria.intent==='rent'?'Location':'Achat'],['Lieu',data.criteria.location],['Budget max.',data.criteria.maxPrice!=null?formatPrice(data.criteria.maxPrice):'Non précisé'],['Surface min.',data.criteria.minArea!=null?`${data.criteria.minArea} m²`:'Non précisée'],['Pièces min.',data.criteria.minRooms!=null?String(data.criteria.minRooms):'Non précisées'],['Rayon',data.criteria.radius?`${data.criteria.radius} km`:'Non précisé'],['Mots-clés',data.criteria.keywords||'Aucun']
            ].map(([label,value])=><div key={label} className="flex justify-between gap-4"><span className="text-[#858277]">{label}</span><strong className="max-w-[155px] text-right font-semibold">{value}</strong></div>)}</div>{!!data.criteria.wishes?.length && <div className="mt-5 border-t border-[#e4e1d6] pt-5"><span className="text-xs text-[#858277]">Souhaits</span><p className="mt-2 text-xs font-semibold">{data.criteria.wishes.join(' · ')}</p></div>}<div className="mt-6 rounded-lg bg-[#e9ebdc] p-4 text-[11px] leading-relaxed text-[#676c56]"><Info size={15} className="mb-2"/> Un score de pertinence aide à parcourir les annonces. Vérifiez les détails directement sur la source avant toute décision.</div></aside>
          </div>}
        </>}
      </>}
    </div>
    {selected.length>0 && <div className="sticky bottom-0 z-20 border-t border-[#aeb597] bg-[#e5ebc8] shadow-[0_-12px_40px_rgba(39,37,51,.12)]"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-10 lg:px-16"><div className="flex items-center gap-3"><Layers2 size={18}/><span className="text-sm font-semibold">{selected.length} annonce{selected.length>1?'s':''} à comparer</span><span className="hidden text-xs text-[#6f7657] sm:inline">Jusqu’à 3 annonces</span></div><div className="flex items-center gap-3"><button data-testid="button-clear-compare" onClick={()=>setSelectedIds([])} className="text-xs font-semibold underline underline-offset-4">Effacer</button><a href="#comparatif" data-testid="link-show-compare" className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#292635] px-4 text-xs font-semibold text-[#e5ebc8]">Voir le comparatif <ArrowRight size={14}/></a></div></div></div>}
    {selected.length>0 && <section id="comparatif" className="scroll-mt-8 bg-[#e9ebdc]"><div className="mx-auto max-w-[1440px] px-5 py-14 md:px-10 lg:px-16"><div className="mb-7 flex items-end justify-between"><div><Eyebrow number="02">En regard</Eyebrow><h2 className="mt-4 text-4xl font-semibold tracking-tight">Comparer pour choisir<span className="font-editorial italic text-[#899259]">.</span></h2></div><button data-testid="button-close-compare" onClick={()=>setSelectedIds([])} aria-label="Fermer le comparatif" className="grid size-9 place-items-center rounded-full border border-[#c4c9ae] hover:bg-[#d9e0bd]"><X size={16}/></button></div><div className="overflow-x-auto rounded-xl border border-[#d1d4c4] bg-[#fbfaf5]"><table className="w-full min-w-[560px] border-collapse text-left text-xs"><thead><tr><th className="w-28 p-5 text-[#818272]">Critère</th>{selected.map(item=><th key={item.id} className="min-w-[175px] p-5 text-sm font-semibold">{item.title}</th>)}</tr></thead><tbody>{[
      ['Prix',(item:HousingListing)=>formatPrice(item.price)],['Surface',(item:HousingListing)=>item.area!=null?`${item.area} m²`:'Non précisée'],['Pièces',(item:HousingListing)=>item.rooms!=null?String(item.rooms):'Non précisées'],['Lieu',(item:HousingListing)=>item.location||'Non précisé'],['Pertinence',(item:HousingListing)=>`${Math.round(item.score)}/100`]
    ].map(([label,getValue])=><tr key={label as string} className="border-t border-[#e5e3d8]"><th className="p-5 font-medium text-[#818272]">{label as string}</th>{selected.map(item=><td key={item.id} className="p-5 font-semibold">{(getValue as (item:HousingListing)=>string)(item)}</td>)}</tr>)}<tr className="border-t border-[#e5e3d8]"><th className="p-5 text-[#818272]">Source</th>{selected.map(item=><td key={item.id} className="p-5"><a data-testid={`link-compare-source-${item.id}`} href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">Voir l’annonce <ExternalLink size={12}/></a></td>)}</tr></tbody></table></div><p className="mt-4 text-xs text-[#77786c]">Les informations absentes sont indiquées comme telles. Comparez aussi les preuves et la description complète de chaque annonce.</p></div></section>}
  </main>;
}