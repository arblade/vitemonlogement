import type { Criteria } from "./store";

export type SearchBatch = "focused" | "broad";
export type ActorRequest = { batch: SearchBatch; path: string; input: string };
export const BROAD_THRESHOLD = 40;

// An actor accepts only one free-text searchQuery. Prefer the first explicit
// amenity over a dwelling type; the broad pass removes only that text filter.
export function focusedSearchTerm(criteria: Criteria): string | null {
  for (const wish of criteria.wishes ?? []) {
    const match = wish.match(/\b(parking|stationnement|garage|meubl[ée]|balcon|jardin|terrasse|ascenseur)\b/i);
    if (match) return match[0].toLocaleLowerCase("fr");
  }
  return criteria.keywords.match(/\b(appartement|maison|studio|duplex|loft|chambre)\b/i)?.[0]?.toLocaleLowerCase("fr") ?? null;
}

export function shouldRunBroad(focusedMatches: number, hasFocusedQuery: boolean) {
  return hasFocusedQuery && focusedMatches < BROAD_THRESHOLD;
}

// The app only searches rentals. The actor's documented category 10 is locations;
// category 11 (colocations) is also a rental in older saved searches.
export function isHousingListingUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)leboncoin\.fr$/i.test(url.hostname)) return false;
    const parts = url.pathname.toLowerCase().split("/").filter(Boolean);
    const category = parts[0] === "ad" ? parts[1] : parts[0];
    return category === "locations" || category === "colocations";
  } catch {
    return false;
  }
}

export function housingActorInput(criteria: Criteria, batch: SearchBatch = "focused", adLimit = 10) {
  // Even a keyword-only search remains restricted to rental category, place,
  // radius and budget. A missing mention is not proof the amenity is absent.
  const term = batch === "focused" ? focusedSearchTerm(criteria) : null;
  return {
    ...(term ? { searchQuery: term } : {}),
    category: "10",
    location: criteria.location,
    radius: Math.max(0, Math.min(200, criteria.radius ?? 5)),
    ...(criteria.minPrice != null ? { price_min_filter: criteria.minPrice } : {}),
    ...(criteria.maxPrice != null ? { price_max_filter: criteria.maxPrice } : {}),
    adLimit,
    mode: "standard",
    includeSeller: false,
    includePhone: false,
    shippable: false,
  };
}

export function actorRequest(criteria: Criteria, batch: SearchBatch, candidateLimit: number, chargeCap: string, timeout: number): ActorRequest {
  return {
    batch,
    path: `/v2/actors/clearpath~leboncoin-api/runs?maxItems=${candidateLimit}&maxTotalChargeUsd=${chargeCap}&timeout=${timeout}`,
    input: JSON.stringify(housingActorInput(criteria, batch, Math.max(10, candidateLimit))),
  };
}