import { lazy, Suspense, useMemo } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { MapPin, X } from 'lucide-react';
import type { HousingListing, HousingPlace } from '@workspace/api-client-react';
import { locatedPlaces, mappedListings } from '@/lib/geo';

// MapLibre n'est chargé qu'à l'ouverture de la carte.
const ResultsMapCanvas = lazy(() => import('@/components/results-map-canvas'));

/**
 * Carte de tous les logements trouvés dont la position est précise (adresse exacte ou rue). Un clic sur la pastille
 * d'un logement ouvre sa fiche (`onPick`). Les logements dont on ne connaît que le quartier ou la commune n'y figurent
 * pas : la fenêtre le dit, au lieu de les placer à un endroit faux.
 */
export function ResultsMap({ listings, places = [], viewedIds, open, onOpenChange, onPick }: {
  listings: HousingListing[];
  places?: HousingPlace[];
  viewedIds: ReadonlySet<number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (id: number) => void;
}) {
  const items = useMemo(() => mappedListings(listings), [listings]);
  const located = useMemo(() => locatedPlaces(places), [places]);
  const hidden = listings.length - items.length;
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#222222]/75 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"/>
      <DialogPrimitive.Content data-testid="dialog-results-map" aria-describedby="results-map-note" onOpenAutoFocus={event => event.preventDefault()}
        className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-cream md:inset-8 md:rounded-3xl md:border md:border-line md:shadow-[0_24px_80px_rgba(0,0,0,.35)] lg:inset-x-[6vw]">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line-soft px-5 py-4 md:px-8">
          <div className="min-w-0">
            <DialogPrimitive.Title className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.02em]"><MapPin size={18} className="text-brand" aria-hidden="true"/>Carte des logements</DialogPrimitive.Title>
            <p id="results-map-note" data-testid="results-map-note" className="mt-1 text-xs leading-relaxed text-stone">
              {items.length} logement{items.length > 1 ? 's' : ''} sur la carte : touchez un prix pour ouvrir sa fiche.
              {hidden > 0 && ` ${hidden} autre${hidden > 1 ? 's' : ''} n’${hidden > 1 ? 'ont' : 'a'} qu’un quartier ou une commune pour toute position : ${hidden > 1 ? 'ils ne sont' : 'il n’est'} pas placé${hidden > 1 ? 's' : ''} ici, mais ${hidden > 1 ? 'figurent' : 'figure'} dans la liste.`}
            </p>
          </div>
          <DialogPrimitive.Close data-testid="button-close-results-map" aria-label="Fermer la carte" className="grid size-10 shrink-0 place-items-center rounded-full border border-line transition-colors hover:bg-sage focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c13515]"><X size={18}/></DialogPrimitive.Close>
        </div>
        <div className="isolate min-h-0 flex-1 bg-sage">
          <Suspense fallback={<div className="grid h-full place-items-center text-xs text-stone">Chargement de la carte…</div>}>
            <ResultsMapCanvas items={items} places={located} viewed={viewedIds} onPick={onPick}/>
          </Suspense>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
