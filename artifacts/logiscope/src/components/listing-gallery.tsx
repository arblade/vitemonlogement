import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { HousingListing } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, ImageOff } from 'lucide-react';

export function listingImages(listing: HousingListing) {
  const images = (listing.images || []).filter((url): url is string => typeof url === 'string' && !!url.trim());
  if (listing.image && !images.includes(listing.image)) images.push(listing.image);
  return images;
}

export function ListingGallery({ listing, large = false }: { listing: HousingListing; large?: boolean }) {
  const images = listingImages(listing);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const visibleIndex = Math.min(active, Math.max(0, images.length - 1));
  const current = images[visibleIndex];
  const broken = current && failed.includes(current);
  const move = (step: number) => setActive(index => (Math.min(index, images.length - 1) + step + images.length) % images.length);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (images.length < 2) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  };
  const stop = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation();

  return <div
    data-testid={`${large ? 'detail' : 'card'}-gallery-${listing.id}`}
    className={`relative isolate overflow-hidden bg-[#dce1ca] ${large ? 'h-[280px] sm:h-[420px] lg:h-[510px]' : 'h-[230px] md:h-full md:min-h-[270px]'}`}
    onClick={stop}
    onKeyDown={onKeyDown}
    tabIndex={images.length > 1 ? 0 : undefined}
    role={images.length > 1 ? 'group' : undefined}
    aria-label={images.length > 1 ? `Galerie de ${listing.title}. Utilisez les flèches gauche et droite pour naviguer.` : undefined}
  >
    {current && !broken ? <img
      key={current}
      data-testid={`${large ? 'detail' : 'card'}-image-${listing.id}`}
      src={current}
      alt={`${listing.title}, photo ${visibleIndex + 1} sur ${images.length}`}
      className="h-full w-full object-cover"
      onError={() => setFailed(previous => previous.includes(current) ? previous : [...previous, current])}
    /> : <div role="status" className="flex h-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_80%_20%,#e9eecf_0%,#d8dfc3_55%,#c6d0b0_100%)] px-8 text-center text-[#59654c]">
      <ImageOff size={30} strokeWidth={1.4} aria-hidden="true"/>
      <span className="max-w-[230px] text-sm font-semibold">{broken ? 'Cette photo n’a pas pu être chargée.' : 'Aucune photo fournie pour cette annonce.'}</span>
      {broken && <span className="text-xs">Vous pouvez consulter les autres photos ou l’annonce d’origine.</span>}
    </div>}
    {images.length > 0 && <span className="absolute left-4 top-4 rounded-full bg-[#fbfaf5]/95 px-3 py-1.5 font-data text-[10px] uppercase tracking-[.08em] text-[#343341]">
      Photo {visibleIndex + 1} / {images.length}
    </span>}
    {images.length > 1 && <>
      <div className="absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
        <button type="button" data-testid={`${large ? 'detail' : 'card'}-photo-prev-${listing.id}`} aria-label="Photo précédente" onClick={() => move(-1)} className="grid size-10 place-items-center rounded-full bg-[#fbfaf5]/95 text-[#292635] shadow-sm transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#292635]"><ArrowLeft size={18}/></button>
        <button type="button" data-testid={`${large ? 'detail' : 'card'}-photo-next-${listing.id}`} aria-label="Photo suivante" onClick={() => move(1)} className="grid size-10 place-items-center rounded-full bg-[#fbfaf5]/95 text-[#292635] shadow-sm transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#292635]"><ArrowRight size={18}/></button>
      </div>
      <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-label="Choisir une photo">
        {images.map((url, index) => <button key={`${url}-${index}`} type="button" data-testid={`${large ? 'detail' : 'card'}-photo-dot-${listing.id}-${index}`} aria-label={`Afficher la photo ${index + 1}`} aria-current={index === visibleIndex ? 'true' : undefined} onClick={() => setActive(index)} className={`size-2.5 rounded-full border border-[#fbfaf5] transition-transform hover:scale-125 ${index === visibleIndex ? 'bg-[#fbfaf5]' : 'bg-[#292635]/50'}`}/>)}
      </div>
    </>}
  </div>;
}