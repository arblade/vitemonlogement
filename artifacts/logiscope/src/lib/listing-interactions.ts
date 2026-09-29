import { useSyncExternalStore } from 'react';
import type { HousingListing } from '@workspace/api-client-react';

const STORAGE_KEY = 'logiscope:listing-interactions:v1';

export type FavoriteListing = Pick<HousingListing, 'url' | 'title' | 'image' | 'price' | 'area' | 'rooms' | 'location' | 'score'> & {
  searchId: number;
  savedAt: string;
};
type Interactions = { favorites: Record<string, FavoriteListing>; viewed: string[] };
const empty: Interactions = { favorites: {}, viewed: [] };
const listeners = new Set<() => void>();
let snapshot: Interactions | undefined;

export function listingKey(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

function read(): Interactions {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return empty;
    const data = value as Partial<Interactions>;
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

export function useListingInteractions() {
  return useSyncExternalStore(subscribe, current, () => empty);
}

function save(next: Interactions) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    snapshot = next;
    listeners.forEach(listener => listener());
    return true;
  } catch {
    return false;
  }
}

export function markListingViewed(url: string) {
  const key = listingKey(url);
  const state = current();
  if (state.viewed.includes(key)) return true;
  return save({ ...state, viewed: [...state.viewed, key] });
}

export function toggleListingFavorite(listing: HousingListing, searchId: number) {
  const state = current();
  const key = listingKey(listing.url);
  const favorites = { ...state.favorites };
  if (favorites[key]) delete favorites[key];
  else favorites[key] = {
    url: listing.url, title: listing.title, image: listing.image, price: listing.price,
    area: listing.area, rooms: listing.rooms, location: listing.location, score: listing.score,
    searchId, savedAt: new Date().toISOString(),
  };
  return save({ ...state, favorites });
}

export function removeListingFavorite(url: string) {
  const state = current();
  const favorites = { ...state.favorites };
  delete favorites[listingKey(url)];
  return save({ ...state, favorites });
}