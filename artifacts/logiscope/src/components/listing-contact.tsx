import { useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle } from 'lucide-react';
import type { HousingCriterionResult, HousingListing } from '@workspace/api-client-react';

function sourceName(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'le site de l’annonce'; }
}

/** Message prêt à envoyer : il demande la disponibilité, pose une question par critère « non précisé » (5 max) et propose une visite. */
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

export function ListingContact({ listing, results, onViewed }: { listing: HousingListing; results: HousingCriterionResult[]; onViewed: () => void }) {
  const [message, setMessage] = useState(() => contactMessage(listing, results));
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied('yes'); }
    catch { setCopied('failed'); }
    setTimeout(() => setCopied(null), 2500);
  };
  const source = sourceName(listing.url);
  return <section id={`contact-${listing.id}`} data-testid={`contact-${listing.id}`} aria-labelledby={`contact-title-${listing.id}`} className="scroll-mt-4 rounded-3xl border border-line bg-brand-wash p-5 md:p-7">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-2xl bg-paper text-brand shadow-sm"><MessageCircle size={22} strokeWidth={1.75}/></span>
      <div>
        <h2 id={`contact-title-${listing.id}`} className="text-lg font-semibold">Contacter l’annonceur</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone">Les échanges se font directement sur {source}. Voici un message prêt à envoyer : copiez-le, puis collez-le dans la messagerie de l’annonce.</p>
      </div>
    </div>
    <label htmlFor={`contact-message-${listing.id}`} className="sr-only">Message à l’annonceur</label>
    <textarea id={`contact-message-${listing.id}`} data-testid={`contact-message-${listing.id}`} value={message} onChange={event => setMessage(event.target.value)} rows={9}
      className="mt-4 w-full resize-y rounded-2xl border border-line bg-paper p-4 text-base leading-relaxed outline-none focus:border-brand md:text-sm"/>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <button type="button" data-testid={`contact-copy-${listing.id}`} onClick={() => void copy()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line bg-paper px-5 text-sm font-semibold transition-colors hover:bg-sage">
        {copied === 'yes' ? <Check size={16} className="text-ok"/> : <Copy size={16}/>} {copied === 'yes' ? 'Message copié' : copied === 'failed' ? 'Copie impossible : sélectionnez le texte' : 'Copier le message'}
      </button>
      <a href={listing.url} target="_blank" rel="noopener noreferrer" onClick={onViewed} data-testid={`contact-open-${listing.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-paper transition-colors hover:bg-brand-dark">
        Écrire sur {source} <ExternalLink size={15}/>
      </a>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-stone">Nous n’affichons ni numéro de téléphone ni nom de l’annonceur : ces informations restent sur le site de l’annonce.</p>
  </section>;
}
