# Logiscope

Une recherche immobilière en langage naturel, avec résultats Le Bon Coin fournis par Apify et observations IA vérifiables.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (managed workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Development uses local SQLite even when Turso secrets exist. Production requires Turso/libSQL: set a real `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as server-side secrets before publishing. Without a valid Turso URL the production API fails at startup rather than silently losing data.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Product DB: SQLite via `@libsql/client` (local `.data/logiscope.sqlite`, or `LOGISCOPE_SQLITE_PATH` during development; remote Turso in production). The workspace's unused PostgreSQL package remains untouched.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Frontend: `artifacts/logiscope/src/`
- API: `artifacts/api-server/src/routes/housing/`
- API contract: `lib/api-spec/openapi.yaml`
- SQLite tables and persistence: `artifacts/api-server/src/routes/housing/store.ts`

## Architecture decisions

- Apify is accessed only from the API server using the connected `apify` connector, never from the browser.
- Never trigger a billable actor run during verification unless the user explicitly asks. The actor input schema requires `adLimit >= 10`, so the app sends 10, requests `maxItems=10` from Apify to inspect candidates after property/price filters, and returns/persists at most 5 new matching rentals per call. Apify documents `maxItems` as a cap on chargeable dataset items for pay-per-result Actors, not on raw output; this Actor's real billing behavior remains unverified. Searches must use the actor's rental category 10 and filter returned ad URLs by rental category before showing or saving them; wishes like parking must not become unrestricted search keywords. User-initiated searches and refreshes have no daily quota; seller profiles and phone lookup are disabled.
- Published Replit server files are ephemeral. Use Turso/libSQL for production SQLite; do not publish without its server-side connection configured.

## Product

Describe a housing wish (Quimper example prefilled); one Enter creates a persistent search and a waiting page while AI interprets and the app reads up to 5 ads from each Apify run. Interpretation classifies criteria as structured API facts, fields only sometimes available through the API, or wishes requiring description review. Listings failing known numeric constraints are skipped; API facts take precedence, and an LLM fills missing or uncertain fields only with exact quotations from the ad. Unknown is distinct from contradicted. AI generates evidence-backed relevance summaries before atomic persistence and the completed state. Refresh fetches up to 5 more, deduplicates by listing URL, can restore missing images on old ads and keeps existing ads. Users can browse photos in each card, open a detailed view, compare listings and see exact textual evidence.
Each listing presents four general facts first (price, area, rooms, location), then explicitly requested preferences, then other API or cited-description features. The card previews only a few preferences and extras; the detail view contains every available value with its provenance. Missing values stay "Non précisé", and the API feature extractor only reads recognized structured fields actually present in each ad.

## User preferences

- Keep Apify usage small to protect the user's account: 5 retrieved and stored results per actor call. Actor input itself cannot be configured below 10 due to schema minimum.
- Production data must persist in SQLite; user accepted managed Turso/libSQL instead of the ephemeral server filesystem.

## Gotchas

- The actor is `clearpath/leboncoin-api`, not `clearpath/leboncoin` (the latter returned 404).
- OpenAI access uses Replit AI Integrations; no personal OpenAI key is needed. Usage consumes credits. Automated interpretation and listing analysis happen on the API server.
- A development SQLite file is local and deliberately ignored by Git. Production refuses to start without the Turso URL and auth token in server-side secrets; remote persistence cannot be verified until credentials and a Turso database are available.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
