import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useAnalyzeHousingSearch, useCreateHousingSearch, useGetHousingSearch, getGetHousingSearchQueryKey, getGetWatchedSearchQueryKey, useRefreshHousingSearch, useVisitHousingSearch, getListHousingSearchesQueryKey, type HousingCriterion, type HousingCriterionResult, type HousingFeature, type HousingListing, type HousingPlace } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BellRing, ChevronDown, Check, CircleHelp, Clock3, ExternalLink, Heart, Info, Layers2, Map as MapIcon, Minus, RefreshCw, Search, Sparkles, TrainFront, TramFront, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice, Eyebrow, formatDate, formatPrice } from '@/components/site-shell';
import { ListingGallery } from '@/components/listing-gallery';
import { ListingDetail } from '@/components/listing-detail';
import { WatchPanel } from '@/components/watch-panel';
import { useWatchedSearch } from '@/lib/watch';
import { ago, at } from '@/lib/dates';
import { ResultsMap } from '@/components/results-map';
import { mappedListings } from '@/lib/geo';
import { featureIcon, featureText, generalIcons, listingFacts, cardAtouts } from '@/components/listing-facts';
import { SearchProgress } from '@/components/search-progress';
import { SearchRequestDebug } from '@/components/search-request-debug';
import { EditPromptButton, SearchPromptEditor } from '@/components/search-prompt-editor';
import { useAppConfig } from '@/hooks/use-app-config';
import { listingKey, markListingViewed, useFavoriteActions, useListingInteractions } from '@/lib/listing-interactions';
import { sourceName } from '@/lib/sources';
import { MatchGauge, matchLabel } from '@/components/match-gauge';
import { transitBadge } from '@/components/nearest-stop';


function refreshErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object' && 'error' in error.data && typeof error.data.error === 'string') return error.data.error;
  }
  return 'Le rafraîchissement n’a pas abouti. Vos annonces précédentes sont conservées ; réessayez dans un instant.';
}

function createErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error && error.data && typeof error.data === 'object' && 'error' in error.data && typeof error.data.error === 'string') return error.data.error;
  return 'La nouvelle recherche n’a pas pu démarrer. Votre texte est conservé : réessayez.';
}

/** « Publiée il y a 3 h » ; une annonce remontée par son auteur le dit (« Remontée hier · publiée le 14 sept. »). */
function dateLine(listing: HousingListing) {
  const posted = listing.postedAt ? Date.parse(listing.postedAt) : null, refreshed = listing.refreshedAt ? Date.parse(listing.refreshedAt) : null;
  if (posted == null && refreshed == null) return null;
  if (posted != null && refreshed != null && refreshed - posted > 24 * 3_600_000) return `Remontée ${ago(listing.refreshedAt)} · publiée ${ago(listing.postedAt)}`;
  return `Publiée ${ago(listing.postedAt ?? listing.refreshedAt)}`;
}

const PAGE_SIZE = 20; // annonces affichées (et analysées) d'un coup ; les suivantes arrivent en faisant défiler

/** Message qui change toutes les 3,5 s pendant une attente un peu longue (lecture des annonces par l'IA). */
export function RotatingMessage({ messages, testId }: { messages: string[]; testId?: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex(value => (value + 1) % messages.length), 3_500);
    return () => window.clearInterval(timer);
  }, [messages.length]);
  return <span data-testid={testId} aria-live="polite">{messages[index]}</span>;
}

const MORE_MESSAGES = [
  'Nous chargeons les annonces suivantes pour vous…',
  'L’IA lit les descriptions, une par une…',
  'Nous vérifions vos critères dans chaque annonce…',
  'Encore quelques secondes, presque prêt…',
];
const BACKFILL_MESSAGES = [
  'Nous rassemblons les annonces des 4 derniers jours…',
  'Nous remontons dans le temps, page après page…',
  'L’IA lit les premières descriptions pour vous…',
  'Encore un instant, votre veille quotidienne se met en place…',
];

/** Trait fin avec un petit texte au milieu : fin des annonces de la dernière relève. */
function ReleaseLine({ text, testId }: { text: string; testId: string }) {
  return <div data-testid={testId} role="separator" aria-label={text} className="my-6 flex items-center gap-3 text-xs font-medium text-stone">
    <span aria-hidden="true" className="h-px flex-1 bg-line"/><span className="shrink-0">{text}</span><span aria-hidden="true" className="h-px flex-1 bg-line"/>
  </div>;
}

/**
 * Mise en place d'une veille quotidienne (remontée de 4 jours) : progression réelle, à la façon Airbnb : une fine barre
 * en segments (une page lue = un segment à l'encre, la page en cours qui respire), le nombre d'annonces déjà trouvées,
 * et le message qui change en dessous.
 */
function BackfillProgress({ page, maxPages, found }: { page: number; maxPages: number; found: number }) {
  return <div role="status" data-testid="results-backfill" className="mb-6 rounded-2xl border border-line bg-cream px-5 py-4">
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm font-semibold text-ink">Mise en place de votre veille</span>
      <span data-testid="backfill-found" className="shrink-0 text-xs text-stone">{found} annonce{found > 1 ? 's' : ''} trouvée{found > 1 ? 's' : ''}</span>
    </div>
    <div aria-hidden="true" className="mt-3 flex gap-1.5">{Array.from({ length: maxPages }, (_, index) =>
      <span key={index} data-testid={`backfill-segment-${index + 1}`} data-state={index + 1 < page ? 'done' : index + 1 === page ? 'current' : 'todo'}
        className={`h-1 flex-1 rounded-full ${index + 1 < page ? 'bg-ink' : index + 1 === page ? 'animate-pulse bg-[#b0b0b0]' : 'bg-line-soft'}`}/>)}
    </div>
    <p className="mt-2.5 flex flex-wrap gap-x-1.5 text-xs text-stone"><span data-testid="backfill-page">Page {page} sur {maxPages} au plus ·</span><RotatingMessage messages={BACKFILL_MESSAGES}/></p>
  </div>;
}

const Spinner = () => <span aria-hidden="true" className="spin-arc size-8 rounded-full border-[3px] border-[#ffe3e8] border-t-brand"/>;

/**
 * Bas de liste : dès qu'il devient visible (ou au clic, pour le clavier), les 20 annonces suivantes sont demandées ;
 * l'indicateur rose tourne, avec un message qui change, jusqu'à ce qu'elles soient lues par l'IA.
 */
function LoadMore({ remaining, loading, onLoad }: { remaining: number; loading: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const load = useRef(onLoad);
  load.current = onLoad;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load.current(); }, { rootMargin: '120px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [remaining]);
  const next = Math.min(PAGE_SIZE, remaining);
  return <div ref={ref} data-testid="results-load-more" className="flex flex-col items-center gap-3 py-8">
    {loading
      ? <span role="status" data-testid="results-loader" className="flex flex-col items-center gap-3 text-center text-sm text-stone"><Spinner/><RotatingMessage messages={MORE_MESSAGES} testId="results-loader-message"/></span>
      : <button type="button" data-testid="button-load-more" onClick={() => load.current()} className="inline-flex h-10 items-center rounded-lg border border-[#dddddd] bg-white px-4 text-xs font-semibold transition-colors hover:border-ink">Afficher {next} annonce{next > 1 ? 's' : ''} de plus</button>}
  </div>;
}

const CARD_CHIPS = 6;
const STATUS_TEXT = { confirmed: 'confirmé', contradicted: 'ne correspond pas', unknown: 'à vérifier' } as const;

/**
 * Une seule rangée de pastilles, sans titre : vos critères d'abord (couleur = statut ; « à vérifier » seulement pour ce que
 * vous avez demandé), puis quelques atouts que l'annonce confirme (neutres). Ni « non », ni ce que l'annonce ne dit pas.
 */
function cardChips(id: number, criteria: HousingCriterionResult[], features: HousingFeature[], nearestStop: HousingListing['nearestStop']) {
  // Métro ou tram proche : un atout comme les autres (« Métro à 5 min »), juste après vos critères ; le détail est dans la fiche.
  const transit = transitBadge(nearestStop);
  const all = [
    ...criteria.map(result => ({ key: `c-${result.id}`, testId: `card-criterion-${id}-${result.id}`, tone: result.status, text: result.label,
      status: STATUS_TEXT[result.status], Icon: result.status === 'confirmed' ? Check : result.status === 'contradicted' ? Minus : CircleHelp })),
    ...(transit ? [{ key: 'transit', testId: `card-transit-${id}`, tone: 'feature' as const, text: transit.text, status: '', Icon: transit.metro ? TrainFront : TramFront }] : []),
    ...cardAtouts(features).map((feature, i) => ({ key: `f-${i}`, testId: `card-feature-${id}-${i}`, tone: 'feature' as const, text: featureText(feature), status: '', Icon: featureIcon(feature.label) })),
  ];
  return { chips: all.slice(0, CARD_CHIPS), hidden: Math.max(0, all.length - CARD_CHIPS) };
}

function ListingCard({ listing, checks, index, selected, compareFull, liked, viewed, isNew, open, setOpen, onSelect, onFavorite, onViewed, searchId, places, routingAvailable }: {
  listing: HousingListing; checks: HousingCriterion[]; index: number; selected: boolean; compareFull: boolean; isNew: boolean;
  open: boolean; setOpen: (open: boolean) => void;
  searchId?: number; places?: HousingPlace[]; routingAvailable?: boolean;
  liked: boolean; viewed: boolean; onSelect: () => void; onFavorite: () => void; onViewed: () => void;
}) {
  const [expandedSummary, setExpandedSummary] = useState(false);
  const [popping, setPopping] = useState(false); // petite animation du cœur, seulement au moment où l'on ajoute le favori
  const [canExpandSummary, setCanExpandSummary] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = summaryRef.current;
    if (!element || expandedSummary) return;
    const measure = () => setCanExpandSummary(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [listing.aiSummary, expandedSummary]);
  const { generals, criteria, features } = listingFacts(listing, checks);
  const { chips, hidden } = cardChips(listing.id, criteria, features, listing.nearestStop);
  return <><article data-testid={`card-listing-${listing.id}`} className={`group relative overflow-hidden rounded-3xl border border-line transition-all duration-300 hover:-translate-y-0.5 hover:border-[#b0b0b0] hover:shadow-[0_12px_34px_rgba(34,32,44,.08)] ${viewed ? 'bg-sage opacity-85 grayscale-[.2]' : 'bg-cream'}`}
    onClick={event => { if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label, summary')) return; onViewed(); setOpen(true); }}>
    <button type="button" data-testid={`button-open-listing-${listing.id}`} onClick={() => { onViewed(); setOpen(true); }} aria-label={`Lire le détail de l’annonce : ${listing.title}`} className="absolute inset-0 z-10 cursor-pointer rounded-3xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-moss"/>
    <div className="grid md:grid-cols-[260px_1fr] xl:grid-cols-[310px_1fr]">
      <div className="relative z-20 min-h-[230px] p-3 md:min-h-full">
        <ListingGallery key={listing.id} listing={listing}/>
      </div>
      <div className="flex flex-col p-5 md:p-6">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">{(isNew || viewed) && <span className="mb-2 flex gap-1.5">{isNew && <span data-testid={`badge-new-${listing.id}`} className="inline-block rounded-md bg-brand px-2 py-0.5 text-xs font-semibold text-white">Nouvelle</span>}{viewed && <span data-testid={`badge-viewed-${listing.id}`} className="inline-block rounded-md bg-[#ebebeb] px-2 py-0.5 text-xs font-medium text-[#484848]">Déjà consultée</span>}</span>}<h3 data-testid={`text-listing-title-${listing.id}`} className="text-[21px] font-semibold leading-[1.15] tracking-[-.03em] md:text-[24px]">{listing.title}</h3>{dateLine(listing) && <p data-testid={`text-listing-date-${listing.id}`} className="mt-1 text-xs text-stone">{dateLine(listing)}</p>}</div>
           <div className="relative z-20 flex shrink-0 items-center justify-between gap-2 sm:items-start sm:justify-end">
             <button type="button" data-testid={`button-like-${listing.id}`} aria-label={liked ? `Retirer des favoris : ${listing.title}` : `Ajouter aux favoris : ${listing.title}`} aria-pressed={liked} onClick={() => { if (!liked) setPopping(true); onFavorite(); }} className={`relative grid size-10 place-items-center rounded-lg border transition-colors ${liked ? 'border-brand bg-lime-wash text-brand' : 'border-[#dddddd] bg-white text-stone hover:text-brand'} ${popping && liked ? 'heart-pop' : ''}`}><Heart size={19} fill={liked ? 'currentColor' : 'none'} onAnimationEnd={() => setPopping(false)}/></button>
             <MatchGauge score={listing.score} testId={`gauge-card-${listing.id}`}/>
           </div>
        </div>
         <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft sm:grid-cols-4" aria-label="Repères essentiels">
           {generals.map(({ label, value }) => { const Icon = generalIcons[label]; return <div key={label} data-testid={`card-general-${listing.id}-${label}`} className="min-w-0 bg-[#f7f7f7] px-3 py-3"><span className="flex items-center gap-1.5 font-data text-xs uppercase tracking-[.06em] text-stone">{Icon && <Icon size={13} aria-hidden="true" className="shrink-0 text-brand"/>}{label}</span><strong className={`mt-1 block break-words font-semibold ${label === 'Prix' ? 'text-[16px] tracking-[-.03em]' : 'text-[12px]'}`}>{value}</strong></div>; })}
         </div>
         {chips.length > 0 && <ul className="mt-4 flex flex-wrap gap-1.5" data-testid={`card-facts-${listing.id}`} aria-label="Vos critères et caractéristiques">
           {chips.map(chip => <li key={chip.key} data-testid={chip.testId} title={chip.status ? `${chip.text} : ${chip.status}` : undefined} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs ${chip.tone === 'confirmed' ? 'border border-ok-line bg-ok-wash font-medium text-ok-deep' : chip.tone === 'contradicted' ? 'border border-[#fecdca] bg-[#fef3f2] font-medium text-[#b42318]' : chip.tone === 'unknown' ? 'border border-dashed border-[#b0b0b0] font-medium text-[#484848]' : 'bg-[#f2f2f2] text-[#484848]'}`}><chip.Icon size={13} aria-hidden="true" className="shrink-0"/>{chip.text}{chip.status && <span className="sr-only"> : {chip.status}</span>}</li>)}
           {hidden > 0 && <li className="inline-flex items-center px-1.5 py-1.5 text-xs text-stone" data-testid={`card-facts-more-${listing.id}`}>+{hidden}</li>}
         </ul>}
         {!listing.analyzed && <div data-testid={`card-analyzing-${listing.id}`} role="status" className="mt-5 flex items-center gap-2.5 rounded-lg bg-sage px-4 py-3 text-xs text-stone"><span aria-hidden="true" className="spin-arc size-4 shrink-0 rounded-full border-2 border-[#ffe3e8] border-t-brand"/>Lecture de l’annonce par l’IA…</div>}
         {listing.analyzed && listing.aiSummary && <div className="mt-5 rounded-lg bg-sage px-4 py-3"><span className="flex items-center gap-1.5 font-data text-xs uppercase tracking-[.08em] text-moss"><Sparkles size={12}/> Pourquoi ce logement ?</span><p ref={summaryRef} id={`listing-summary-${listing.id}`} data-testid={`text-card-summary-${listing.id}`} className={`mt-1.5 text-[13px] leading-[1.65] text-[#484848] ${expandedSummary ? '' : 'line-clamp-4'}`}>{listing.aiSummary}</p>{(canExpandSummary || expandedSummary) && <button type="button" data-testid={`button-expand-summary-${listing.id}`} aria-controls={`listing-summary-${listing.id}`} aria-expanded={expandedSummary} onClick={() => setExpandedSummary(value => !value)} className="relative z-20 mt-2 text-xs font-semibold text-[#c13515] underline underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c13515]">{expandedSummary ? 'Réduire le résumé' : 'Lire le résumé complet'}</button>}</div>}
         <div className="relative z-20 mt-auto grid grid-cols-[1fr_auto] gap-2 pt-6 sm:flex sm:flex-wrap sm:items-center">
          <button type="button" data-testid={`button-fiche-${listing.id}`} onClick={() => { onViewed(); setOpen(true); }} className="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-semibold text-lime-light transition-colors hover:bg-brand-dark">Fiche complète</button>
          <a href={listing.url} target="_blank" rel="noopener noreferrer" onClick={onViewed} data-testid={`link-source-${listing.id}`} aria-label={`Voir l’annonce sur ${sourceName(listing.url)} (nouvel onglet)`} className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#dddddd] bg-white px-3 text-xs font-semibold transition-colors hover:border-ink">Voir sur {sourceName(listing.url)} <ArrowUpRight size={14} className="shrink-0"/></a>
          <button type="button" data-testid={`button-compare-${listing.id}`} onClick={onSelect} disabled={compareFull && !selected} title={compareFull && !selected ? 'Retirez une annonce pour en comparer une autre' : undefined} aria-pressed={selected} className={`inline-flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${selected?'border-[#ff385c] bg-[#ffe3e8] text-[#a0290f]':'border-[#dddddd] bg-white hover:border-ink'}`}>{selected?<Check size={14}/>:<Layers2 size={14}/>} {selected?'Ajouté au comparatif':compareFull?'Limite de 3 atteinte':'Comparer'}</button>
        </div>
      </div>
    </div>
  </article><div onClickCapture={onViewed}><ListingDetail listing={listing} checks={checks} searchId={searchId} places={places} routingAvailable={routingAvailable} open={open} onOpenChange={setOpen} selected={selected} compareFull={compareFull} onSelect={onSelect}/></div></>;
}

export default function SearchDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sort, setSort] = useState<'recent'|'score'|'price'|'area'>('recent');
  // Veille quotidienne : date de la visite précédente, lue une fois à l'ouverture (la visite remet ensuite le compteur à zéro).
  const [newSince, setNewSince] = useState<number | null>(null);
  const requested = useRef(new Set<number>());
  const [refreshError, setRefreshError] = useState('');
  const [relaunchError, setRelaunchError] = useState('');
  const [interactionError, setInteractionError] = useState('');
  // Fiche ouverte (depuis la liste ou la carte) et carte des résultats : la fiche ouverte depuis la carte y ramène à sa fermeture.
  const [openId, setOpenId] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [fromMap, setFromMap] = useState(false);
  // Lien d'un e-mail (/searches/12?annonce=345) : la fiche de cette annonce s'ouvre dès que la recherche est chargée.
  const [linkedId, setLinkedId] = useState(() => Number(new URLSearchParams(window.location.search).get('annonce')) || null);
  const showDebug = new URLSearchParams(window.location.search).get('debug') === '1';
  const interactions = useListingInteractions();
  const favoriteActions = useFavoriteActions();
  const viewedUrls = new Set(interactions.viewed);
  const liveDays = useAppConfig().data?.liveDays ?? 4;
  const { search: watchedOther } = useWatchedSearch();
  const analyzeMore = useAnalyzeHousingSearch();
  const visit = useVisitHousingSearch();
  const [waitingAnalysis, setWaitingAnalysis] = useState(false);
  // Tranche suivante demandée : ses annonces, et l'heure de la demande (au-delà d'une minute, on les montre quand même).
  const [nextBatch, setNextBatch] = useState<{ ids: number[]; since: number } | null>(null);
  const search = useGetHousingSearch(id, { query: { queryKey: getGetHousingSearchQueryKey(id), enabled: validId, refetchInterval: query => query.state.data?.status === 'running' || query.state.data?.task || waitingAnalysis ? 3500 : false } });
  const refresh = useRefreshHousingSearch();
  const create = useCreateHousingSearch();
  const data = search.data;
  const time = (value: string | null | undefined) => value ? Date.parse(value) : -Infinity;
  const listings = useMemo(() => [...(data?.listings || [])].sort((a,b)=>
    sort==='price'?(a.price ?? Infinity)-(b.price ?? Infinity):sort==='area'?(b.area ?? -1)-(a.area ?? -1):sort==='score'?b.score-a.score:
      // Le dernier passage d'abord, puis la date de publication : une annonce remontée ne repasse pas devant les nouvelles.
      (time(b.firstSeenAt) - time(a.firstSeenAt)) || (time(b.postedAt ?? b.refreshedAt) - time(a.postedAt ?? a.refreshedAt)) || b.score-a.score), [data?.listings, sort]);
  // Veille quotidienne, tri « Plus récentes » : un trait marque la fin des annonces de la dernière relève.
  const releaseStart = data?.watch && data.lastWatchAt && sort === 'recent' ? Date.parse(data.lastWatchAt) : null;
  const releaseAt = releaseStart != null ? at(data?.lastWatchAt) : null;
  const releaseEnd = releaseStart == null ? -1 : (() => { const first = listings.findIndex(item => time(item.firstSeenAt) < releaseStart); return first === -1 ? -1 : first; })();
  const isNew = (listing: HousingListing) => data?.watch != null && newSince != null && time(listing.firstSeenAt) > newSince;
  const newCount = listings.filter(isNew).length;
  // Ouverture d'une veille quotidienne : on retient la visite précédente (pour marquer les nouvelles), puis on la note.
  useEffect(() => {
    if (!data || data.watch == null || newSince != null) return;
    setNewSince(data.lastVisitedAt ? Date.parse(data.lastVisitedAt) : 0);
    visit.mutate({ id: data.id }, { onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetWatchedSearchQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListHousingSearchesQueryKey() });
    } });
  }, [data, newSince, visit.mutate, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps
  const askAnalysis = (ids: number[]) => {
    const fresh = ids.filter(listingId => !requested.current.has(listingId));
    if (!data || !fresh.length) return;
    fresh.forEach(listingId => requested.current.add(listingId));
    analyzeMore.mutate({ id: data.id, data: { listingIds: fresh } }, { onError: () => fresh.forEach(listingId => requested.current.delete(listingId)) });
  };
  // Annonces affichées sans analyse (arrivées par un passage, ou ouvertes depuis la carte) : analyse demandée.
  useEffect(() => {
    if (!data || data.status !== 'completed') return;
    const visible = listings.slice(0, shown).filter(item => !item.analyzed);
    setWaitingAnalysis(visible.length > 0 || nextBatch !== null);
    askAnalysis(visible.map(item => item.id));
  }, [data, listings, shown, nextBatch]); // eslint-disable-line react-hooks/exhaustive-deps
  // Faire défiler : les 20 suivantes sont analysées avant d'être montrées (indicateur et messages en attendant).
  const loadMore = () => {
    if (nextBatch) return;
    const batch = listings.slice(shown, shown + PAGE_SIZE);
    askAnalysis(batch.filter(item => !item.analyzed).map(item => item.id));
    setNextBatch({ ids: batch.map(item => item.id), since: Date.now() });
  };
  useEffect(() => {
    if (!nextBatch) return;
    const done = () => { setShown(count => count + PAGE_SIZE); setNextBatch(null); };
    const ready = nextBatch.ids.every(listingId => listings.find(item => item.id === listingId)?.analyzed !== false);
    if (ready) { const timer = window.setTimeout(done, Math.max(0, 600 - (Date.now() - nextBatch.since))); return () => window.clearTimeout(timer); }
    const timer = window.setTimeout(done, Math.max(0, 60_000 - (Date.now() - nextBatch.since)));
    return () => window.clearTimeout(timer);
  }, [nextBatch, listings]);
  const mappableCount = useMemo(() => mappedListings(listings).length, [listings]);
  const viewedIds = useMemo(() => new Set(listings.filter(item => interactions.viewed.includes(listingKey(item.url))).map(item => item.id)), [listings, interactions.viewed]);
  const setFiche = (listingId: number, value: boolean) => {
    if (value) { setOpenId(listingId); return; }
    setOpenId(current => current === listingId ? null : current);
    if (fromMap) { setFromMap(false); setMapOpen(true); }
  };
  const pickOnMap = (listingId: number) => {
    const picked = listings.find(item => item.id === listingId);
    if (!picked) return;
    // Annonce pas encore affichée dans la liste (plus bas) : on l'affiche, sinon sa fiche ne peut pas s'ouvrir.
    const at = listings.indexOf(picked);
    setShown(count => Math.max(count, Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE));
    if (!markListingViewed(picked.url)) setInteractionError('Impossible de mémoriser les annonces consultées dans ce navigateur.');
    setMapOpen(false);
    setFromMap(true);
    setOpenId(listingId);
  };
  useEffect(() => {
    if (linkedId == null || !data) return;
    setLinkedId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('annonce'); // fermer la fiche ne la rouvre pas ; recharger la page montre la liste
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    const picked = listings.find(item => item.id === linkedId);
    if (!picked) return; // annonce retirée depuis l'e-mail : la liste s'affiche
    const position = listings.indexOf(picked);
    setShown(count => Math.max(count, Math.ceil((position + 1) / PAGE_SIZE) * PAGE_SIZE));
    if (!markListingViewed(picked.url)) setInteractionError('Impossible de mémoriser les annonces consultées dans ce navigateur.');
    setOpenId(picked.id);
  }, [linkedId, data, listings]);
  const freshCount = listings.filter(item => !viewedUrls.has(listingKey(item.url))).length;
  const selected = listings.filter(item=>selectedIds.includes(item.id));
  const toggle = (listingId: number) => setSelectedIds(current=>current.includes(listingId)?current.filter(id=>id!==listingId):current.length<3?[...current,listingId]:current);
  const resultsSection = listings.length > 0 && <section aria-label="Annonces trouvées">
    <p className="mb-4 text-xs text-stone">{freshCount} annonce{freshCount > 1 ? 's' : ''} non consultée{freshCount > 1 ? 's' : ''}. Celles déjà ouvertes sont grisées.</p>
    {data?.task === 'backfill' && <BackfillProgress page={data.readProgress?.page ?? 1} maxPages={data.readProgress?.maxPages ?? 3} found={data.count}/>}
    {newCount > 0 && <p data-testid="text-new-count" className="mb-5 inline-flex items-center gap-2 rounded-lg bg-lime-wash px-3 py-2 text-sm font-semibold text-brand-dark"><BellRing size={15} aria-hidden="true"/>{newCount} nouvelle{newCount > 1 ? 's' : ''} annonce{newCount > 1 ? 's' : ''} depuis votre dernière visite</p>}
    {releaseEnd === 0 && releaseAt && <ReleaseLine testId="separator-release" text={`Relève ${releaseAt} : aucune nouvelle annonce`}/>}
    <div className="space-y-5">{listings.slice(0, shown).map((listing,index) => <Fragment key={listing.id}><ListingCard key={listing.id} listing={listing} checks={data?.criteria.checks || []} searchId={data?.id} places={data?.criteria.places} routingAvailable={data?.routingAvailable} open={openId === listing.id} setOpen={value => setFiche(listing.id, value)} index={index} selected={selectedIds.includes(listing.id)} compareFull={selectedIds.length>=3}
      liked={Boolean(interactions.favorites[listingKey(listing.url)])} viewed={viewedUrls.has(listingKey(listing.url))} isNew={isNew(listing)}
      onSelect={()=>toggle(listing.id)}
      onViewed={()=>{ if (!markListingViewed(listing.url)) setInteractionError('Impossible de mémoriser les annonces consultées dans ce navigateur.'); }}
      onFavorite={()=>{ void favoriteActions.toggle(listing, id).then(ok => setInteractionError(ok ? '' : 'Impossible d’enregistrer vos favoris pour le moment. Réessayez.')); }}
    />{index + 1 === releaseEnd && releaseAt && <ReleaseLine testId="separator-release" text={`Fin de la dernière relève · ${releaseAt}`}/>}</Fragment>)}</div>
    {shown < listings.length && <LoadMore remaining={listings.length - shown} loading={nextBatch !== null} onLoad={loadMore}/>}
    {shown >= listings.length && data?.task === 'extend' && <div role="status" data-testid="results-extending" className="flex flex-col items-center gap-3 py-8 text-sm text-stone"><Spinner/>Recherche d’annonces plus anciennes…</div>}
  </section>;
  const onRelaunch = async (prompt: string) => {
    if (create.isPending) return;
    setRelaunchError('');
    try {
      // Veille quotidienne : elle suit la nouvelle demande (mêmes heures), côté serveur, en une seule opération.
      const updated = await create.mutateAsync({ data: { prompt, ...(data?.watch ? { watchFrom: data.id } : {}) } });
      if (data?.watch) void queryClient.invalidateQueries({ queryKey: getGetWatchedSearchQueryKey() });
      queryClient.setQueryData(getGetHousingSearchQueryKey(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: getListHousingSearchesQueryKey() });
      setSelectedIds([]);
      navigate(`/searches/${updated.id}`);
    } catch (error) { setRelaunchError(createErrorMessage(error)); }
  };
  const onRefresh = async () => {
    if (!validId || refresh.isPending || data?.status !== 'completed') return;
    setRefreshError('');
    try {
      const updated = await refresh.mutateAsync({ id });
      queryClient.setQueryData(getGetHousingSearchQueryKey(id), updated);
      void queryClient.invalidateQueries({ queryKey: getListHousingSearchesQueryKey() });
    } catch (error) { setRefreshError(refreshErrorMessage(error)); }
  };

  if (!validId) return <main className="mx-auto min-h-[70dvh] max-w-[1100px] px-5 py-24"><Eyebrow number="—">Adresse introuvable</Eyebrow><h1 className="mt-5 text-5xl font-semibold tracking-tight">Cette recherche n’existe pas.</h1><Link href="/" data-testid="link-back-invalid" className="mt-8 inline-flex items-center gap-2 underline underline-offset-4"><ArrowLeft size={16}/> Retour à l’accueil</Link></main>;
  return <main className="min-h-[75dvh]">
    <section>
      <div className="mx-auto max-w-[1440px] px-5 pt-2 md:px-10 md:pt-6 lg:px-16">
        <Link href="/searches" data-testid="link-back-home" className="inline-flex min-h-11 items-center gap-2 text-sm text-stone transition-colors hover:text-ink"><ArrowLeft size={15}/> Mes recherches</Link>
        {search.isLoading ? <div className="mt-3 space-y-3"><Skeleton className="h-8 w-2/3 bg-sage"/><Skeleton className="h-4 w-1/2 bg-sage"/></div> : data ? <>
          {/* En-tête compact (mobile d'abord) : ville et nombre d'annonces sur une ligne, la demande repliée, puis les actions. */}
          <h1 data-testid="text-search-location" className="text-[26px] font-semibold leading-tight tracking-[-.03em] md:text-[40px]">{data.criteria.location || 'Votre recherche'}{data.status === 'completed' && <span data-testid="text-listing-count" className="font-normal text-stone"> · {data.count} annonce{data.count>1?'s':''}</span>}</h1>
          <details data-testid="details-search-prompt" className="group/prompt mt-0.5 max-w-[760px]">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-sm text-stone"><span data-testid="text-search-prompt" className="min-w-0 truncate group-open/prompt:whitespace-normal">“{data.prompt}”</span><ChevronDown size={15} aria-hidden="true" className="shrink-0 transition-transform group-open/prompt:rotate-180"/></summary>
            <p data-testid="text-live-window" className="pb-2 text-xs leading-relaxed text-stone">{data.watch ? `Veille quotidienne : les annonces des ${liveDays} derniers jours, puis les nouvelles à chaque relève.` : 'Recherche ponctuelle : les annonces les plus récentes. « Étendre » remonte plus loin.'} Lancée le {formatDate(data.createdAt)}.</p>
          </details>
          {(data.status !== 'completed' || refresh.isPending) && <span data-testid="status-search-detail" role="status" aria-live="polite" className="mt-2 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs">{data.status==='failed' && !refresh.isPending ? <><X size={13}/> Recherche interrompue</> : <><span className="pulse-dot size-2 rounded-full bg-lime"/> Recherche en cours</>}</span>}
          {data.status !== 'running' && !refresh.isPending && <div className="mt-3 space-y-2.5">
            <div data-testid="results-actions" className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none] md:mx-0 md:px-0">
              {!editingPrompt && <EditPromptButton onClick={() => setEditingPrompt(true)}/>}
              {data.status === 'completed' && mappableCount>0 && <button type="button" data-testid="button-open-results-map" onClick={()=>setMapOpen(true)} className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[#dddddd] bg-white px-3.5 text-xs font-semibold transition-colors hover:border-ink disabled:opacity-50"><MapIcon size={14} aria-hidden="true"/> Carte <span className="rounded-full bg-sage px-1.5 text-xs" aria-label={`${mappableCount} logement${mappableCount>1?'s':''} sur la carte`}>{mappableCount}</span></button>}
              {data.status === 'completed' && !data.watch && <button type="button" data-testid="button-refresh" title="Étendre : remonter plus loin dans le temps (annonces plus anciennes)" disabled={data.task === 'extend'} onClick={onRefresh} className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[#dddddd] bg-white px-3.5 text-xs font-semibold transition-colors hover:border-ink disabled:opacity-50"><RefreshCw size={14} aria-hidden="true"/> Étendre</button>}
            </div>
            {data.status === 'completed' && listings.length>0 && <label className="relative flex h-10 w-fit max-w-full items-center rounded-lg border border-[#dddddd] bg-white text-xs font-semibold"><span className="pl-3.5 pr-1.5 font-normal text-stone">Trier par</span><select id="sort-results" data-testid="select-sort" value={sort} onChange={e=>setSort(e.target.value as typeof sort)} className="h-full appearance-none bg-transparent pr-8 font-semibold outline-none"><option value="recent">Plus récentes</option><option value="score">Meilleure correspondance</option><option value="price">Prix croissant</option><option value="area">Surface décroissante</option></select><ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-3"/></label>}
          </div>}
          {data.status !== 'running' && !refresh.isPending && <SearchPromptEditor key={data.id} prompt={data.prompt} watching={data.watch != null} pending={create.isPending} error={relaunchError} editing={editingPrompt} setEditing={setEditingPrompt} onSubmit={onRelaunch}/>}
        </> : null}
      </div>
    </section>

    <div className="mx-auto max-w-[1440px] px-5 pb-10 pt-5 md:px-10 md:pt-7 lg:px-16">
      {search.isError && <div className="max-w-2xl"><ErrorNotice message="Impossible de retrouver cette recherche. Vérifiez votre connexion puis réessayez." retry={()=>search.refetch()}/><Link href="/" data-testid="link-error-home" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4"><ArrowLeft size={15}/> Revenir à l’accueil</Link></div>}
      {search.isLoading && <div className="mx-auto max-w-3xl"><SearchProgress stage="interpreting"/></div>}
      {data && <>
        {data.status !== 'running' && !refresh.isPending && <>
          {showDebug && <SearchRequestDebug requests={data.searchRequests} focusedMatches={data.focusedMatches} status={data.status}/>}
        </>}
        {interactionError && <p role="alert" className="mb-5 text-sm text-brick">{interactionError}</p>}
         {data.status==='completed' && !refresh.isPending && <WatchPanel key={`${data.id}-${data.watch}`} search={data} other={watchedOther}/>}
         {(data.status==='running'||refresh.isPending) && <div className="mx-auto max-w-3xl">
           <SearchProgress stage={data.stage ?? 'interpreting'}/>
         </div>}
        {data.status==='failed' && <div className="max-w-2xl"><ErrorNotice message={data.error || 'La recherche n’a pas pu se terminer. Essayez une nouvelle description.'}/><Link href="/" data-testid="link-new-after-failure" className="mt-6 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4">Faire une nouvelle recherche <ArrowRight size={15}/></Link></div>}
        {(refreshError || (data.status==='completed' && data.error)) && <div role="alert" className="mb-7 max-w-2xl"><ErrorNotice message={refreshError || data.error || ''}/></div>}
         {data.status==='completed' && !refresh.isPending && <>
          {listings.length===0 ? <div className="rounded-2xl border border-dashed border-[#c4c4c4] bg-mist px-7 py-14 md:px-12"><div className="mb-6 grid size-12 place-items-center rounded-full bg-[#ffe3e8]"><Search size={21}/></div><h3 className="text-xl font-semibold">Aucune annonce dans cette sélection.</h3><p className="mt-2 max-w-md text-sm leading-relaxed text-stone">Le marché bouge vite. Essayez d’élargir la zone, de revoir le budget ou de simplifier vos critères.</p><Link href="/" data-testid="link-empty-new-search" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4">Repartir d’une description <ArrowRight size={15}/></Link></div> :
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_290px]">
              <div>{resultsSection}</div>
             <aside className="h-fit rounded-2xl border border-line bg-cream p-6 lg:sticky lg:top-6"><span className="font-data text-xs uppercase tracking-[.13em] text-[#717171]">Votre demande</span><h3 className="mt-4 text-[28px] leading-tight">Ce que nous avons cherché pour vous.</h3><div className="mt-6 space-y-3 border-t border-line-soft pt-5 text-xs">{[
                ['Projet','Location'],['Lieu',data.criteria.location],['Type de bien',data.criteria.propertyType==='house'?'Maison':data.criteria.propertyType==='apartment'?'Appartement':'Maison ou appartement'],['Budget min.',data.criteria.minPrice!=null?formatPrice(data.criteria.minPrice):'Non précisé'],['Budget max.',data.criteria.maxPrice!=null?formatPrice(data.criteria.maxPrice):'Non précisé'],['Surface min.',data.criteria.minArea!=null?`${data.criteria.minArea} m²`:'Non précisée'],['Surface max.',data.criteria.maxArea!=null?`${data.criteria.maxArea} m²`:'Non précisé'],['Pièces min.',data.criteria.minRooms!=null?String(data.criteria.minRooms):'Non précisées'],['Pièces max.',data.criteria.maxRooms!=null?String(data.criteria.maxRooms):'Non précisées'],['Chambres min.',data.criteria.minBedrooms!=null?String(data.criteria.minBedrooms):'Non précisées'],['DPE minimum',data.criteria.minEnergyClass?`${data.criteria.minEnergyClass} ou mieux`:'Non précisé'],['Rayon',data.criteria.radius?`${data.criteria.radius} km`:'Non précisé'],['Mots-clés',data.criteria.keywords||'Aucun']
             ].map(([label,value])=><div key={label} className="flex justify-between gap-4"><span className="text-[#717171]">{label}</span><strong className="max-w-[155px] text-right font-semibold">{value}</strong></div>)}</div>{!!data.criteria.wishes?.length && <div className="mt-5 border-t border-line-soft pt-5"><span className="text-xs text-[#717171]">Souhaits</span><p className="mt-2 text-xs font-semibold">{data.criteria.wishes.join(' · ')}</p></div>}
             <div className="mt-6 rounded-lg bg-sage p-4 text-xs leading-relaxed text-[#484848]"><Info size={15} className="mb-2"/> La jauge de correspondance aide à parcourir les annonces. Une information « à vérifier » n’est pas un critère manqué. Vérifiez les détails directement sur l’annonce avant toute décision.</div></aside>
          </div>}
        </>}
      </>}
    </div>
    {data && <ResultsMap listings={listings} places={data.criteria.places} viewedIds={viewedIds} open={mapOpen} onOpenChange={setMapOpen} onPick={pickOnMap}/>}
    {selected.length>0 && <div className="sticky bottom-0 z-20 border-t border-[#b0b0b0] bg-[#ffe3e8] shadow-[0_-12px_40px_rgba(39,37,51,.12)]"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-10 lg:px-16"><div className="flex items-center gap-3"><Layers2 size={18}/><span className="text-sm font-semibold">{selected.length} annonce{selected.length>1?'s':''} à comparer</span><span className="hidden text-xs text-[#484848] sm:inline">Jusqu’à 3 annonces</span></div><div className="flex items-center gap-3"><button data-testid="button-clear-compare" onClick={()=>setSelectedIds([])} className="text-xs font-semibold underline underline-offset-4">Effacer</button><a href="#comparatif" data-testid="link-show-compare" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-xs font-semibold text-[#ffe3e8]">Voir le comparatif <ArrowRight size={14}/></a></div></div></div>}
    {selected.length>0 && <section id="comparatif" className="scroll-mt-8 bg-sage"><div className="mx-auto max-w-[1440px] px-5 py-14 md:px-10 lg:px-16"><div className="mb-7 flex items-end justify-between"><div><Eyebrow number="02">En regard</Eyebrow><h2 className="mt-4 text-4xl font-semibold tracking-tight">Comparer pour choisir</h2></div><button data-testid="button-close-compare" onClick={()=>setSelectedIds([])} aria-label="Fermer le comparatif" className="grid size-9 place-items-center rounded-full border border-[#c4c4c4] hover:bg-[#ffe3e8]"><X size={16}/></button></div><div className="overflow-x-auto rounded-xl border border-[#dddddd] bg-cream"><table className="w-full min-w-[560px] border-collapse text-left text-xs"><thead><tr><th className="w-28 p-5 text-[#717171]">Critère</th>{selected.map(item=><th key={item.id} className="min-w-[175px] p-5 text-sm font-semibold">{item.title}</th>)}</tr></thead><tbody>{[
      ['Prix',(item:HousingListing)=>formatPrice(item.price)],['Surface',(item:HousingListing)=>item.area!=null?`${item.area} m²`:'Non précisée'],['Pièces',(item:HousingListing)=>item.rooms!=null?String(item.rooms):'Non précisées'],['Lieu',(item:HousingListing)=>item.location||'Non précisé'],['Correspondance',(item:HousingListing)=>`${matchLabel(item.score)} · ${Math.round(item.score)}/100`]
    ].map(([label,getValue])=><tr key={label as string} className="border-t border-[#dddddd]"><th className="p-5 font-medium text-[#717171]">{label as string}</th>{selected.map(item=><td key={item.id} className="p-5 font-semibold">{(getValue as (item:HousingListing)=>string)(item)}</td>)}</tr>)}<tr className="border-t border-[#dddddd]"><th className="p-5 text-[#717171]">Source</th>{selected.map(item=><td key={item.id} className="p-5"><a data-testid={`link-compare-source-${item.id}`} href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => { if (!markListingViewed(item.url)) setInteractionError('Impossible de mémoriser les annonces consultées dans ce navigateur.'); }} className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">Voir l’annonce <ExternalLink size={12}/></a></td>)}</tr></tbody></table></div><p className="mt-4 text-xs text-[#717171]">Les informations absentes sont indiquées comme telles. Comparez aussi les preuves et la description complète de chaque annonce.</p></div></section>}
  </main>;
}