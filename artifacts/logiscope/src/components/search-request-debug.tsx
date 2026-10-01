import type { HousingSearchRequest } from '@workspace/api-client-react';

type Props = {
  requests?: HousingSearchRequest[];
  focusedMatches?: number | null;
  status: string;
};

function formattedInput(input: string) {
  try { return JSON.stringify(JSON.parse(input), null, 2); }
  catch { return input; }
}

const TITLES: Record<string, string> = { leboncoin: 'Le Bon Coin', pap: 'PAP', seloger: 'SeLoger' };

/** Suivi des appels Apify (?debug=1) : une carte par site interrogé. « broad » n'existe plus que dans d'anciennes recherches. */
export function SearchRequestDebug({ requests = [], focusedMatches, status }: Props) {
  const leboncoin = requests.find(request => (!request.source || request.source === 'leboncoin') && request.batch === 'focused');
  const cards = [
    { key: 'focused', title: 'Le Bon Coin', request: leboncoin },
    ...requests.filter(request => (!request.source || request.source === 'leboncoin') && request.batch === 'broad')
      .map(request => ({ key: 'broad', title: 'Le Bon Coin · recherche élargie (ancienne)', request })),
    ...requests.filter(request => request.source && request.source !== 'leboncoin')
      .map(request => ({ key: request.source!, title: TITLES[request.source!] ?? request.source!, request })),
  ];
  const historical = status !== 'running' && !leboncoin;

  return <section data-testid="search-request-debug" aria-label="Requêtes envoyées aux sites d’annonces" className="mb-10 rounded-2xl border border-line bg-[#f7f7f7] p-5 md:p-7">
    <div className="font-data text-xs uppercase tracking-[.13em] text-[#c13515]">Suivi des appels · dernier lancement</div>
    <h2 className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">Recherches envoyées aux sites d’annonces</h2>
    <p className="mt-2 text-xs leading-relaxed text-stone">Paramètres transmis à l’acteur Apify. Un appel absent n’est pas présenté comme une recherche effectuée ; lors d’un rafraîchissement, ce suivi affiche les appels du nouveau lancement.</p>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {cards.map(({ key, title, request }) => <div key={key} data-testid={`search-request-${key}`} className="min-w-0 rounded-xl border border-[#dddddd] bg-cream p-4 md:p-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {request ? <>
          <p className="mt-1 text-xs font-medium text-moss">Appel confirmé par Apify{key === 'focused' && focusedMatches != null ? ` · ${focusedMatches} annonce${focusedMatches > 1 ? 's' : ''} retenue${focusedMatches > 1 ? 's' : ''}` : ''}</p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[.07em] text-stone">Route et limites de l’appel</p>
          <code className="mt-1 block break-all text-xs leading-relaxed text-[#222222]">{request.path}</code>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[.07em] text-stone">Paramètres envoyés</p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-4 text-xs leading-relaxed text-lime-wash">{formattedInput(request.input)}</pre>
        </> : <p className="mt-3 text-xs leading-relaxed text-stone">{historical ? 'Le détail des appels de cette ancienne recherche n’a pas été enregistré.' : 'En attente de confirmation par Apify.'}</p>}
      </div>)}
    </div>
  </section>;
}
