import { ExternalLink, MessageCircle } from 'lucide-react';
import type { HousingListing } from '@workspace/api-client-react';

function sourceName(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'le site de l’annonce'; }
}

/** Une ligne pour contacter le vendeur : la messagerie est celle du site de l'annonce (ni nom ni téléphone récupérés). */
export function ListingContact({ listing }: { listing: HousingListing }) {
  const source = sourceName(listing.url);
  return <div data-testid={`contact-${listing.id}`} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
    <MessageCircle size={18} aria-hidden="true" className="shrink-0 text-brand"/>
    <p className="min-w-0 flex-1 leading-tight"><strong className="block text-sm font-semibold">Contacter le vendeur</strong><span className="block truncate text-xs text-stone">via {source}</span></p>
    <a href={listing.url} target="_blank" rel="noopener noreferrer" data-testid={`contact-open-${listing.id}`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-paper transition-colors hover:bg-brand-dark">
      Écrire <ExternalLink size={14} aria-hidden="true"/>
    </a>
  </div>;
}
