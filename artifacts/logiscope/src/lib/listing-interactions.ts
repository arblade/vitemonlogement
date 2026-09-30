import { useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HousingListing } from '@workspace/api-client-react';
import { UNAUTHORIZED_EVENT } from '@/components/auth-gate';

// Annonces consultées : mémorisées dans ce navigateur (simple confort d'affichage).
// Favoris : en base, liés au compte connecté (/api/favorites), donc retrouvés sur tous les appareils.
const STORAGE_KEY = 'logiscope:listing-interactions:v1';
const FAVORITES_KEY = ['vml', 'favorites'] as const;

export type FavoriteListing = Pick<HousingListing, 'url' | 'title' | 'image' | 'price' | 'area' | 'rooms' | 'location' | 'score'> & {
  searchId: number | null;
  savedAt: string;
};
type Local = { favorites: Record<string, FavoriteListing>; viewed: string[] };
const empty: Local = { favorites: {}, viewed: [] };
const emptyFavorites: Record<string, FavoriteListing> = {};
const listeners = new Set<() => void>();
let snapshot: Local | undefined;

export function listingKey(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

function read(): Local {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return empty;
    const data = value as Partial<Local>;
    return {
      favorites: data.favorites && typeof data.favorites === 'object' && !Array.isArray(data.favorites) ? data.favorites : {},
      viewed: Array.isArray(data.viewed) ? data.viewed.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    return empty;
  }
}

function current() {
  if (!snapshot) snapshot = read();
  return snapshot;
}

/** Oublie le cache mémoire du localStorage (utilisé par les tests, qui réécrivent le stockage entre deux cas). */
export function resetListingInteractionsCache() { snapshot = undefined; }

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    snapshot = read();
    listeners.forEach(notify => notify());
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

function save(next: Local) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    snapshot = next;
    listeners.forEach(listener => listener());
    return true;
  } catch {
    return false;
  }
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!response.ok) throw new Error(`Erreur ${response.status}`);
  return response;
}

/** Une seule fois par navigateur : les favoris d'avant les comptes (localStorage) sont repris dans le compte. */
async function importLegacyFavorites() {
  const legacy = Object.values(current().favorites);
  if (!legacy.length) return;
  await api('/favorites/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: legacy }) });
  save({ ...current(), favorites: {} });
}

async function fetchFavorites(): Promise<FavoriteListing[]> {
  await importLegacyFavorites().catch(() => undefined); // un échec d'import ne doit pas empêcher d'afficher les favoris
  return (await api('/favorites')).json() as Promise<FavoriteListing[]>;
}

export function useListingInteractions() {
  const local = useSyncExternalStore(subscribe, current, () => empty);
  const query = useQuery({ queryKey: FAVORITES_KEY, queryFn: fetchFavorites });
  const favorites = query.data ? Object.fromEntries(query.data.map(item => [listingKey(item.url), item])) : emptyFavorites;
  return { favorites, viewed: local.viewed, favoritesLoading: query.isLoading, favoritesError: query.isError };
}

export function markListingViewed(url: string) {
  const key = listingKey(url);
  const state = current();
  if (state.viewed.includes(key)) return true;
  return save({ ...state, viewed: [...state.viewed, key] });
}

/** Ajout / retrait des favoris en base, avec mise à jour immédiate de l'écran (annulée si le serveur refuse). */
export function useFavoriteActions() {
  const queryClient = useQueryClient();
  const mutate = async (update: (items: FavoriteListing[]) => FavoriteListing[], request: () => Promise<unknown>) => {
    const previous = queryClient.getQueryData<FavoriteListing[]>(FAVORITES_KEY) ?? [];
    queryClient.setQueryData(FAVORITES_KEY, update(previous));
    try { await request(); return true; }
    catch { queryClient.setQueryData(FAVORITES_KEY, previous); return false; }
  };
  const remove = (url: string) => mutate(
    items => items.filter(item => listingKey(item.url) !== listingKey(url)),
    () => api(`/favorites?url=${encodeURIComponent(url)}`, { method: 'DELETE' }),
  );
  const toggle = (listing: HousingListing, searchId: number) => {
    const existing = queryClient.getQueryData<FavoriteListing[]>(FAVORITES_KEY)?.some(item => listingKey(item.url) === listingKey(listing.url));
    if (existing) return remove(listing.url);
    const favorite: FavoriteListing = {
      url: listing.url, title: listing.title, image: listing.image, price: listing.price, area: listing.area,
      rooms: listing.rooms, location: listing.location, score: listing.score, searchId, savedAt: new Date().toISOString(),
    };
    return mutate(items => [favorite, ...items], () => api('/favorites', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(favorite) }));
  };
  return { toggle, remove };
}
