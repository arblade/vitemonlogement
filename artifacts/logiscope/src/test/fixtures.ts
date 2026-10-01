import type { HousingCriterion, HousingListing, HousingSearchDetail } from '@workspace/api-client-react';

export const listing = (id: number, overrides: Partial<HousingListing> = {}): HousingListing => ({
  id, source: 'leboncoin', batch: 'focused', title: `Studio lumineux ${id}`, url: `https://www.leboncoin.fr/ad/locations/${id}`, description: 'd',
  price: 590 + id * 10, area: 25, rooms: 1, location: 'Lille', image: null, images: [], aiSummary: 'Studio calme proche métro.',
  summaryEvidence: [], score: 80 - id, features: [],
  criterionResults: [
    { id: 'price', label: 'Budget ≤ 700 €', status: 'confirmed', source: 'api', value: '590 €', evidence: '' },
    { id: 'wish-1', label: 'chat accepté', status: 'unknown', source: 'description', value: '', evidence: '' },
  ],
  ...overrides,
});

export const checks: HousingCriterion[] = [
  { id: 'price', label: 'Budget ≤ 700 €', availability: 'api' },
  { id: 'wish-1', label: 'chat accepté', availability: 'description', apiField: null },
];

export const search = (overrides: Partial<HousingSearchDetail> = {}): HousingSearchDetail => ({
  id: 1, prompt: 'Un studio à Lille, 700 € max, chat accepté', status: 'completed', stage: 'ready', phase: 'focused',
  createdAt: '2026-09-30T10:00:00Z', count: 3, error: null, focusedMatches: 3, analyzed: true,
  searchRequests: [{ batch: 'focused', path: '/v2/acts/x/runs', input: '{"searchQuery":"chat"}' }],
  criteria: { location: 'Lille', intent: 'rent', maxPrice: 700, radius: 5, keywords: '', wishes: ['chat accepté'], checks },
  listings: [listing(1), listing(2), listing(3)],
  ...overrides,
} as HousingSearchDetail);

/** Routeur de fetch simulé : la première route dont le motif correspond répond ; tout le reste répond 404. */
export type Route = { method?: string; match: RegExp; respond: (init: RequestInit | undefined, url: string) => { status?: number; body?: unknown } };
export function mockFetch(routes: Route[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes.find(item => item.match.test(url) && (item.method ?? 'GET') === method);
    const { status = route ? 200 : 404, body = {} } = route ? route.respond(init, url) : {};
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  globalThis.fetch = impl as typeof fetch;
  return calls;
}
