import { useState } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, MessageCircle } from 'lucide-react';
import type { HousingCriterionResult, HousingListing } from '@workspace/api-client-react';

function sourceName(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'le site de l’annonce'; }
}

/** Message type : disponibilité, une question par critère « non précisé » (5 max), proposition de visite. */
export function contactMessage(listing: Pick<HousingListing, 'title' | 'location'>, results: Pick<HousingCriterionResult, 'label' | 'status'>[]) {
  const questions = results.filter(result => result.status === 'unknown').slice(0, 5).map(result => `- ${result.label} ?`);
  return [
    'Bonjour,',
    '',
    `Votre annonce « ${listing.title} »${listing.location ? ` à ${listing.location}` : ''} m’intéresse. Est-elle toujours disponible ?`,
    ...(questions.length ? ['', 'Pourriez-vous me préciser :', ...questions] : []),
    '',
    'Si oui, serait-il possible d’organiser une visite ?',
    '',
    'Merci d’avance et bonne journée.',
  ].join('\n');
}

/** Une ligne pour contacter le vendeur (messagerie du site source) ; le message type est proposé mais replié par défaut. */
export function ListingContact({ listing, results }: { listing: HousingListing; results: HousingCriterionResult[] }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(() => contactMessage(listing, results));
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const source = sourceName(listing.url);
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied('yes'); }
    catch { setCopied('failed'); }
    setTimeout(() => setCopied(null), 2500);
  };
  return <div data-testid={`contact-${listing.id}`} className="rounded-2xl border border-line">
    <div className="flex items-center gap-3 px-4 py-3">
      <MessageCircle size={18} aria-hidden="true" className="shrink-0 text-brand"/>
      <p className="min-w-0 flex-1 leading-tight"><strong className="block text-sm font-semibold">Contacter le vendeur</strong><span className="block truncate text-xs text-stone">via {source}</span></p>
      <a href={listing.url} target="_blank" rel="noopener noreferrer" data-testid={`contact-open-${listing.id}`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-paper transition-colors hover:bg-brand-dark">
        Écrire <ExternalLink size={14} aria-hidden="true"/>
      </a>
    </div>
    <button type="button" data-testid={`contact-toggle-${listing.id}`} aria-expanded={open} aria-controls={`contact-message-panel-${listing.id}`} onClick={() => setOpen(value => !value)}
      className="flex min-h-11 w-full items-center gap-1.5 border-t border-line-soft px-4 text-sm text-stone transition-colors hover:text-ink">
      Proposer un message <ChevronDown size={15} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}/>
    </button>
    {open && <div id={`contact-message-panel-${listing.id}`} className="border-t border-line-soft p-4">
      <label htmlFor={`contact-message-${listing.id}`} className="sr-only">Message à l’annonceur</label>
      <textarea id={`contact-message-${listing.id}`} data-testid={`contact-message-${listing.id}`} value={message} onChange={event => setMessage(event.target.value)} rows={9}
        className="w-full resize-y rounded-xl border border-line bg-paper p-3 text-base leading-relaxed outline-none focus:border-brand md:text-sm"/>
      <button type="button" data-testid={`contact-copy-${listing.id}`} onClick={() => void copy()} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-5 text-sm font-semibold transition-colors hover:bg-sage">
        {copied === 'yes' ? <Check size={16} className="text-ok"/> : <Copy size={16}/>} {copied === 'yes' ? 'Message copié' : copied === 'failed' ? 'Copie impossible : sélectionnez le texte' : 'Copier le message'}
      </button>
    </div>}
  </div>;
}
