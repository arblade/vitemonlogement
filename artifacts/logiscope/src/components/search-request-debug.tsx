import type { HousingSearchRequest } from '@workspace/api-client-react';

type Props = {
  requests?: HousingSearchRequest[];
  focusedMatches?: number | null;
  status: string;
  phase?: string;
  error?: string | null;
};

function formattedInput(input: string) {
  try { return JSON.stringify(JSON.parse(input), null, 2); }
  catch { return input; }
}

function queryFrom(input: string) {
  try {
    const value = JSON.parse(input) as { searchQuery?: unknown };
    return typeof value.searchQuery === 'string' ? value.searchQuery : null;
  } catch { return null; }
}

export function SearchRequestDebug({ requests = [], focusedMatches, status, phase, error }: Props) {
  const focused = requests.find(request => request.batch === 'focused');
  const broad = requests.find(request => request.batch === 'broad');
  const historical = status !== 'running' && !focused;
  const broadState = historical
    ? 'Le détail des appels de cette ancienne recherche n’a pas été enregistré.'
    : !focused || focusedMatches == null
      ? 'En attente du résultat de la recherche ciblée.'
      : broad
        ? null
        : focusedMatches >= 40
          ? `Non lancée : ${focusedMatches} annonces retenues dans la première recherche (seuil : 40).`
          : !queryFrom(focused.input)
            ? 'Non lancée : aucun mot-clé à retirer pour élargir la recherche.'
            : error
              ? 'Second appel non confirmé ; consultez le message d’erreur de la recherche.'
              : phase === 'broad' && status === 'running'
                ? 'Démarrage de la recherche élargie…'
                : 'Second appel non confirmé.';

  return <section data-testid="search-request-debug" aria-label="Requêtes envoyées à Leboncoin" className="mb-10 rounded-2xl border border-line bg-[#f7f7f7] p-5 md:p-7">
    <div className="font-data text-xs uppercase tracking-[.13em] text-[#c13515]">Suivi des appels · dernier lancement</div>
    <h2 className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">Recherches envoyées à Leboncoin</h2>
    <p className="mt-2 text-xs leading-relaxed text-stone">Paramètres transmis à l’acteur Apify. Un appel absent n’est pas présenté comme une recherche effectuée ; lors d’un rafraîchissement, ce suivi affiche les appels du nouveau lancement.</p>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {([
        { batch: 'focused', title: '1 · Recherche ciblée', request: focused },
        { batch: 'broad', title: '2 · Recherche élargie', request: broad },
      ] as const).map(({ batch, title, request }) => <div key={batch} data-testid={`search-request-${batch}`} className="min-w-0 rounded-xl border border-[#dddddd] bg-cream p-4 md:p-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {request ? <>
          <p className="mt-1 text-xs font-medium text-moss">Appel confirmé par Apify{batch === 'focused' && focusedMatches != null ? ` · ${focusedMatches} annonce${focusedMatches > 1 ? 's' : ''} retenue${focusedMatches > 1 ? 's' : ''}` : ''}</p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[.07em] text-stone">Route et limites de l’appel</p>
          <code className="mt-1 block break-all text-xs leading-relaxed text-[#222222]">{request.path}</code>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[.07em] text-stone">Paramètres envoyés</p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-4 text-xs leading-relaxed text-lime-wash">{formattedInput(request.input)}</pre>
        </> : <p className="mt-3 text-xs leading-relaxed text-stone">{batch === 'focused'
          ? historical ? 'Le détail des appels de cette ancienne recherche n’a pas été enregistré.' : 'En attente de confirmation par Apify.'
          : broadState}</p>}
      </div>)}
    </div>
  </section>;
}