import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { HousingCriterion, HousingListing, HousingPlace } from '@workspace/api-client-react';
import { ArrowUpRight, Check, CircleHelp, Info, Layers2, MapPin, Minus, Sparkles, X } from 'lucide-react';
import { ListingGallery } from '@/components/listing-gallery';
import { generalIcons, listingFacts } from '@/components/listing-facts';
import { ListingMap } from '@/components/listing-map';
import { sourceName } from '@/lib/sources';


export function ListingDetail({ listing, checks = [], open, onOpenChange, selected, compareFull, onSelect, searchId, places, routingAvailable }: {
  listing: HousingListing;
  checks?: HousingCriterion[];
  searchId?: number;
  places?: HousingPlace[];
  routingAvailable?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: boolean;
  compareFull: boolean;
  onSelect: () => void;
}) {
  const { generals, criteria: checkedResults, features } = listingFacts(listing, checks);
  const evidence = listing.summaryEvidence || [];
  const statusCopy = {
    confirmed: 'Critère satisfait',
    contradicted: 'Critère non satisfait',
    unknown: 'Non précisé',
  };
  const sourceCopy = {
    api: 'Indiqué dans l’annonce',
    description: 'Lu dans la description',
    unknown: 'À vérifier dans l’annonce',
  };
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#222222]/75 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"/>
      <DialogPrimitive.Content data-testid={`dialog-listing-${listing.id}`} aria-describedby={`listing-detail-intro-${listing.id}`} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[24px] border border-line bg-cream text-ink shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:max-h-[92dvh] sm:w-[calc(100%-40px)] sm:max-w-[1040px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px]">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line-soft px-5 py-3 md:px-8">
          <span className="min-w-0 font-data text-xs uppercase tracking-[.14em] text-[#c13515]"><span className="hidden sm:inline">Lecture de l’annonce <span className="mx-2 text-[#b0b0b0]">/</span> </span>{Math.round(listing.score)} points<span className="hidden sm:inline"> de pertinence</span></span>
          <div className="flex shrink-0 items-center gap-2">
          <a href={listing.url} target="_blank" rel="noopener noreferrer" data-testid={`link-detail-top-${listing.id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand px-4 text-xs font-semibold text-[#ffffff] transition-colors hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c13515]"><span>Voir l’annonce<span className="hidden sm:inline"> sur {sourceName(listing.url)}</span></span><ArrowUpRight size={15} aria-hidden="true"/></a>
          <DialogPrimitive.Close data-testid={`button-close-listing-${listing.id}`} aria-label="Fermer le détail de l’annonce" className="grid size-9 shrink-0 place-items-center rounded-full border border-line transition-colors hover:bg-sage focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c13515]"><X size={17}/></DialogPrimitive.Close>
          </div>
        </div>
        <div className="overflow-y-auto overscroll-contain">
          <ListingGallery key={`detail-${listing.id}`} listing={listing} large/>
          <div className="px-5 pb-10 pt-8 md:px-10 md:pt-10">
            <div className="flex flex-col justify-between gap-6 border-b border-line-soft pb-8 md:flex-row md:items-start">
              <div className="max-w-[700px]">
                <p className="mb-3 flex items-center gap-1.5 font-data text-xs uppercase tracking-[.1em] text-[#717171]"><MapPin size={13}/>{listing.location || 'Localisation non précisée'}</p>
                <DialogPrimitive.Title data-testid={`text-detail-title-${listing.id}`} className="text-[clamp(1.8rem,4vw,3rem)] font-semibold leading-[1.08] tracking-[-.03em]">{listing.title}</DialogPrimitive.Title>
                <p id={`listing-detail-intro-${listing.id}`} className="mt-3 text-xs text-stone">Les informations et extraits ci-dessous proviennent de l’annonce et de son analyse. Vérifiez-les auprès de la source.</p>
              </div>
              <span className="shrink-0 rounded-full bg-lime-wash px-4 py-2 font-data text-xs font-semibold">{Math.round(listing.score)}/100 · pertinence</span>
            </div>

            <section aria-labelledby={`generals-${listing.id}`} className="border-b border-line-soft py-7">
              <h2 id={`generals-${listing.id}`} className="mb-4 font-data text-xs uppercase tracking-[.12em] text-moss">01 / Repères essentiels</h2>
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                {generals.map(({ label, value }) => { const Icon = generalIcons[label]; return <div key={label} data-testid={`general-${listing.id}-${label}`} className="min-w-0 rounded-xl bg-mist p-4"><span className="flex items-center gap-1.5 font-data text-xs uppercase tracking-[.08em] text-stone">{Icon && <Icon size={14} aria-hidden="true" className="shrink-0 text-brand"/>}{label}</span><strong className="mt-2 block break-words text-[16px] font-semibold">{value}</strong></div>; })}
              </div>
            </section>

            <ListingMap listing={listing} searchId={searchId} places={places} routingAvailable={routingAvailable}/>

            <div className="grid gap-10 py-9 lg:grid-cols-[minmax(0,1fr)_310px]">
              <div>
                <section aria-labelledby={`checks-${listing.id}`}>
                  <div className="mb-2 font-data text-xs uppercase tracking-[.12em] text-moss">02 / Vos critères</div>
                  <div className="flex items-center gap-2"><Layers2 size={18} className="text-[#717171]"/><h2 id={`checks-${listing.id}`} className="text-[22px] font-semibold tracking-[-.03em]">Votre demande, point par point.</h2></div>
                  {checkedResults.length ? <div className="mt-5 space-y-2">
                    {checkedResults.map(result => <div key={result.id} data-testid={`criterion-result-${listing.id}-${result.id}`} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border px-4 py-3 ${result.status === 'confirmed' ? 'border-ok-line bg-ok-wash' : result.status === 'contradicted' ? 'border-[#fecdca] bg-[#fef3f2]' : 'border-[#dddddd] bg-[#ffffff]'}`}>
                      <div className="min-w-0">
                        <strong className="block text-[14px] leading-snug">{result.label}</strong>
                        <span data-testid={`source-criterion-${listing.id}-${result.id}`} className="text-xs text-stone">{sourceCopy[result.source]}</span>
                      </div>
                      <span data-testid={`status-criterion-${listing.id}-${result.id}`} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-data text-xs font-semibold uppercase tracking-[.05em] ${result.status === 'confirmed' ? 'bg-ok-wash text-ok-deep' : result.status === 'contradicted' ? 'bg-[#fecdca] text-[#b42318]' : 'bg-[#ebebeb] text-[#484848]'}`}>
                        {result.status === 'confirmed' ? <Check size={12}/> : result.status === 'contradicted' ? <Minus size={12}/> : <CircleHelp size={12}/>}
                        {statusCopy[result.status]}
                      </span>
                    </div>)}
                  </div> : <div className="mt-5 rounded-xl border border-dashed border-line bg-[#ffffff] p-5 text-xs leading-relaxed text-stone">Aucun critère individuel n’a été transmis pour cette recherche.</div>}
                </section>
                <section aria-labelledby={`features-${listing.id}`} className="mt-10 border-t border-line-soft pt-9">
                  <div className="mb-2 font-data text-xs uppercase tracking-[.12em] text-moss">03 / En complément</div>
                  <div className="flex items-center gap-2"><Info size={17} className="text-[#717171]"/><h2 id={`features-${listing.id}`} className="text-[22px] font-semibold tracking-[-.03em]">Caractéristiques</h2></div>
                  {features.length ? <ul data-testid={`features-${listing.id}`} className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">{features.map((feature, index) => <li key={`${feature.label}-${index}`} className="flex min-w-0 items-center gap-3 rounded-xl bg-mist px-4 py-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#ffffff] text-ink"><Check size={13} aria-hidden="true"/></span>
                    <span className="min-w-0 text-[14px] leading-snug"><strong className="font-semibold">{feature.label}</strong>{feature.value ? <span className="text-stone"> · {feature.value}</span> : null}</span>
                  </li>)}</ul> : <p className="mt-4 text-sm text-stone">Aucune caractéristique documentée pour cette annonce.</p>}
                </section>
                <section aria-labelledby={`description-${listing.id}`} className="mt-10 border-t border-line-soft pt-9">
                  <h2 id={`description-${listing.id}`} className="text-[22px] font-semibold tracking-[-.03em]">L’annonce, dans ses mots.</h2>
                  <p data-testid={`text-detail-description-${listing.id}`} className="mt-4 whitespace-pre-line break-words text-[14px] leading-[1.85] text-[#484848]">{listing.description || 'Description non fournie par l’annonce.'}</p>
                </section>
              </div>
              <aside className="h-fit rounded-2xl bg-sage p-5 md:p-6">
                <div className="flex items-center gap-2 font-data text-xs uppercase tracking-[.12em] text-moss"><Sparkles size={15}/> Lecture complémentaire</div>
                <h2 className="mt-4 text-[28px] leading-tight">Pourquoi ce logement ?</h2>
                <p data-testid={`text-ai-summary-${listing.id}`} className="mt-5 text-sm leading-[1.75] text-[#222222]">{listing.aiSummary || 'Aucun résumé IA disponible pour cette annonce.'}</p>
                <div className="mt-6 border-t border-[#c4c4c4] pt-5">
                  <h3 className="font-data text-xs uppercase tracking-[.1em] text-moss">Extraits à l’appui</h3>
                  {evidence.length ? <ul className="mt-4 space-y-3">{evidence.map((quote, index) => <li key={`${quote}-${index}`} className="border-l-2 border-[#ff385c] pl-3 text-xs leading-relaxed text-[#484848]">« {quote} »</li>)}</ul> : <p className="mt-3 text-xs leading-relaxed text-[#484848]">Aucun extrait justificatif fourni pour ce résumé.</p>}
                </div>
                <p className="mt-6 text-xs leading-relaxed text-[#717171]">Ce résumé interprète le texte de l’annonce. Il ne remplace pas une visite ni une vérification auprès du vendeur ou du bailleur.</p>
              </aside>
            </div>
            <div className="flex flex-wrap gap-3 border-t border-line-soft pt-6">
              <a href={listing.url} target="_blank" rel="noopener noreferrer" data-testid={`link-detail-source-${listing.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 text-xs font-semibold text-lime-light transition-colors hover:bg-brand-dark">Voir sur {sourceName(listing.url)} <ArrowUpRight size={15}/></a>
              <button type="button" data-testid={`button-detail-compare-${listing.id}`} onClick={onSelect} disabled={compareFull && !selected} aria-pressed={selected} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#b0b0b0] px-5 text-xs font-semibold transition-colors hover:bg-sage disabled:cursor-not-allowed disabled:opacity-45">{selected ? <Check size={15}/> : <Layers2 size={15}/>} {selected ? 'Retirer du comparatif' : compareFull ? 'Limite de 3 atteinte' : 'Comparer cette annonce'}</button>
            </div>
          </div>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}