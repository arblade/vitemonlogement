import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { HousingCriterion, HousingListing } from '@workspace/api-client-react';
import { ArrowUpRight, Check, CircleHelp, Info, Layers2, MapPin, Minus, Sparkles, X } from 'lucide-react';
import { ListingGallery } from '@/components/listing-gallery';
import { listingFacts } from '@/components/listing-facts';

function sourceName(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'la source'; }
}

export function ListingDetail({ listing, checks = [], open, onOpenChange, selected, compareFull, onSelect }: {
  listing: HousingListing;
  checks?: HousingCriterion[];
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
    api: 'Donnée structurée · API',
    description: 'Description · lecture IA',
    unknown: 'Aucune source disponible',
  };
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#1d1b26]/75 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"/>
      <DialogPrimitive.Content data-testid={`dialog-listing-${listing.id}`} aria-describedby={`listing-detail-intro-${listing.id}`} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[24px] border border-[#d9d6c9] bg-[#fbfaf5] text-[#292635] shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 sm:inset-x-5 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[92dvh] sm:max-w-[1040px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px]">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#e4e1d6] px-5 py-3 md:px-8">
          <span className="font-data text-[10px] uppercase tracking-[.14em] text-[#6c7650]">Lecture de l’annonce <span className="mx-2 text-[#b2afa2]">/</span> {Math.round(listing.score)} points de pertinence</span>
          <DialogPrimitive.Close data-testid={`button-close-listing-${listing.id}`} aria-label="Fermer le détail de l’annonce" className="grid size-9 shrink-0 place-items-center rounded-full border border-[#d9d6c9] transition-colors hover:bg-[#e9ebdc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#87934d]"><X size={17}/></DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto overscroll-contain">
          <ListingGallery key={`detail-${listing.id}`} listing={listing} large/>
          <div className="px-5 pb-10 pt-8 md:px-10 md:pt-10">
            <div className="flex flex-col justify-between gap-6 border-b border-[#e4e1d6] pb-8 md:flex-row md:items-start">
              <div className="max-w-[700px]">
                <p className="mb-3 flex items-center gap-1.5 font-data text-[10px] uppercase tracking-[.1em] text-[#778356]"><MapPin size={13}/>{listing.location || 'Localisation non précisée'}</p>
                <DialogPrimitive.Title data-testid={`text-detail-title-${listing.id}`} className="text-[clamp(1.8rem,4vw,3rem)] font-semibold leading-[1.08] tracking-[-.055em]">{listing.title}</DialogPrimitive.Title>
                <p id={`listing-detail-intro-${listing.id}`} className="mt-3 text-xs text-[#77746a]">Les informations et extraits ci-dessous proviennent de l’annonce et de son analyse. Vérifiez-les auprès de la source.</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#e9edcf] px-4 py-2 font-data text-xs font-semibold">{Math.round(listing.score)}/100 · pertinence</span>
            </div>

            <section aria-labelledby={`generals-${listing.id}`} className="border-b border-[#e4e1d6] py-7">
              <h2 id={`generals-${listing.id}`} className="mb-4 font-data text-[10px] uppercase tracking-[.12em] text-[#626f49]">01 / Repères essentiels</h2>
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                {generals.map(({ label, value }) => <div key={label} data-testid={`general-${listing.id}-${label}`} className="min-w-0 rounded-xl bg-[#eeeee5] p-4"><span className="block font-data text-[10px] uppercase tracking-[.08em] text-[#77746a]">{label}</span><strong className="mt-2 block break-words text-[16px] font-semibold">{value}</strong></div>)}
              </div>
            </section>

            <div className="grid gap-10 py-9 lg:grid-cols-[minmax(0,1fr)_310px]">
              <div>
                <section aria-labelledby={`checks-${listing.id}`}>
                  <div className="mb-2 font-data text-[10px] uppercase tracking-[.12em] text-[#626f49]">02 / Vos critères</div>
                  <div className="flex items-center gap-2"><Layers2 size={18} className="text-[#778356]"/><h2 id={`checks-${listing.id}`} className="text-[22px] font-semibold tracking-[-.04em]">Votre demande, point par point.</h2></div>
                  <p className="mt-2 max-w-xl text-xs leading-relaxed text-[#77746a]">Une information absente n’est pas une réponse négative. Chaque statut indique ce qui a réellement pu être vérifié dans cette annonce.</p>
                  {checkedResults.length ? <div className="mt-5 space-y-3">
                    {checkedResults.map(result => <div key={result.id} data-testid={`criterion-result-${listing.id}-${result.id}`} className={`rounded-xl border p-4 sm:p-5 ${result.status === 'confirmed' ? 'border-[#c8d2a5] bg-[#f1f3e6]' : result.status === 'contradicted' ? 'border-[#dec9bc] bg-[#f8f0ea]' : 'border-[#e2dfd3] bg-[#f5f3ec]'}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <strong className="text-[14px] leading-snug">{result.label}</strong>
                        <span data-testid={`status-criterion-${listing.id}-${result.id}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-data text-[9px] font-semibold uppercase tracking-[.05em] ${result.status === 'confirmed' ? 'bg-[#dce6bd] text-[#465734]' : result.status === 'contradicted' ? 'bg-[#f0ded1] text-[#795342]' : 'bg-[#e9e6de] text-[#66655e]'}`}>
                          {result.status === 'confirmed' ? <Check size={12}/> : result.status === 'contradicted' ? <Minus size={12}/> : <CircleHelp size={12}/>}
                          {statusCopy[result.status]}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        <span className="font-data uppercase tracking-[.04em] text-[#727166]">Source : {sourceCopy[result.source]}</span>
                        {result.value && <span data-testid={`value-criterion-${listing.id}-${result.id}`} className="font-semibold text-[#45443f]">{result.value}</span>}
                      </div>
                      {result.evidence ? <p data-testid={`evidence-criterion-${listing.id}-${result.id}`} className="mt-3 border-l-2 border-[#a9ae92] pl-3 text-xs leading-[1.7] text-[#55534f]"><span className="font-semibold">{result.source === 'description' ? 'Extrait de l’annonce : ' : 'Justificatif : '}</span>« {result.evidence} »</p> : result.status === 'unknown' ? <p className="mt-2 text-xs text-[#77746a]">Aucune information permettant de conclure n’a été trouvée.</p> : null}
                    </div>)}
                  </div> : <div className="mt-5 rounded-xl border border-dashed border-[#d9d6c9] bg-[#f5f3ec] p-5 text-xs leading-relaxed text-[#77746a]">Aucun critère individuel n’a été transmis pour cette recherche.</div>}
                </section>
                <section aria-labelledby={`features-${listing.id}`} className="mt-10 border-t border-[#e4e1d6] pt-9">
                  <div className="mb-2 font-data text-[10px] uppercase tracking-[.12em] text-[#626f49]">03 / En complément</div>
                  <div className="flex items-center gap-2"><Info size={17} className="text-[#778356]"/><h2 id={`features-${listing.id}`} className="text-[22px] font-semibold tracking-[-.04em]">Caractéristiques & provenances</h2></div>
                  {features.length ? <div className="mt-5 space-y-3">{features.map((feature, index) => <div key={`${feature.label}-${index}`} className="rounded-xl border border-[#e5e3d9] bg-[#f5f3ec] p-4">
                     <div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-[13px]">{feature.label}{feature.value ? ` · ${feature.value}` : ''}</strong><span className={`rounded-full px-2 py-1 font-data text-[9px] uppercase tracking-[.04em] ${feature.source === 'ia' ? 'bg-[#e5ebc6] text-[#52613c]' : 'bg-[#e9e6df] text-[#68665f]'}`}>{feature.source === 'ia' ? 'Extrait IA' : 'Donnée API'}</span></div>
                    <p className="mt-2 text-xs leading-relaxed text-[#77746a]"><span className="font-semibold text-[#55534d]">{feature.source === 'ia' ? 'Extrait justificatif : ' : 'Provenance API : '}</span>{feature.evidence || 'Aucune précision fournie.'}</p>
                  </div>)}</div> : <p className="mt-4 text-sm text-[#77746a]">Aucune caractéristique documentée pour cette annonce.</p>}
                </section>
                <section aria-labelledby={`description-${listing.id}`} className="mt-10 border-t border-[#e4e1d6] pt-9">
                  <h2 id={`description-${listing.id}`} className="text-[22px] font-semibold tracking-[-.04em]">L’annonce, dans ses mots.</h2>
                  <p data-testid={`text-detail-description-${listing.id}`} className="mt-4 whitespace-pre-line break-words text-[14px] leading-[1.85] text-[#55534f]">{listing.description || 'Description non fournie par l’annonce.'}</p>
                </section>
              </div>
              <aside className="h-fit rounded-2xl bg-[#e9ebdc] p-5 md:p-6">
                <div className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[.12em] text-[#626f49]"><Sparkles size={15}/> Lecture complémentaire</div>
                <h2 className="mt-4 font-editorial text-[28px] italic leading-tight">Pourquoi ce logement ?</h2>
                <p data-testid={`text-ai-summary-${listing.id}`} className="mt-5 text-sm leading-[1.75] text-[#414337]">{listing.aiSummary || 'Aucun résumé IA disponible pour cette annonce.'}</p>
                <div className="mt-6 border-t border-[#cbd1b9] pt-5">
                  <h3 className="font-data text-[10px] uppercase tracking-[.1em] text-[#626f49]">Extraits à l’appui</h3>
                  {evidence.length ? <ul className="mt-4 space-y-3">{evidence.map((quote, index) => <li key={`${quote}-${index}`} className="border-l-2 border-[#8c995d] pl-3 text-xs leading-relaxed text-[#555b49]">« {quote} »</li>)}</ul> : <p className="mt-3 text-xs leading-relaxed text-[#6d705d]">Aucun extrait justificatif fourni pour ce résumé.</p>}
                </div>
                <p className="mt-6 text-[11px] leading-relaxed text-[#747966]">Ce résumé interprète le texte de l’annonce. Il ne remplace pas une visite ni une vérification auprès du vendeur ou du bailleur.</p>
              </aside>
            </div>
            <div className="flex flex-wrap gap-3 border-t border-[#e4e1d6] pt-6">
              <a href={listing.url} target="_blank" rel="noopener noreferrer" data-testid={`link-detail-source-${listing.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#292635] px-5 text-xs font-semibold text-[#e2eaa5] transition-colors hover:bg-[#484354]">Voir sur {sourceName(listing.url)} <ArrowUpRight size={15}/></a>
              <button type="button" data-testid={`button-detail-compare-${listing.id}`} onClick={onSelect} disabled={compareFull && !selected} aria-pressed={selected} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#b8bd9e] px-5 text-xs font-semibold transition-colors hover:bg-[#e9ebdc] disabled:cursor-not-allowed disabled:opacity-45">{selected ? <Check size={15}/> : <Layers2 size={15}/>} {selected ? 'Retirer du comparatif' : compareFull ? 'Limite de 3 atteinte' : 'Comparer cette annonce'}</button>
            </div>
          </div>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}