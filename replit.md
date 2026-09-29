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
- Never trigger a billable actor run during verification unless the user explicitly asks. The actor input schema requires `adLimit >= 10`. In dev the app inspects at most 10 candidates and retains 5 listings per actor run; in production it requests/retains up to 100 per run. A focused rental search can use a wish keyword (e.g. parking) inside the rental category/location/budget filters; if fewer than 40 valid candidates are returned, the app runs a second broader search without the keyword (unless there was no keyword to remove). At 40, no second run. Apify documents `maxItems` as a cap on chargeable dataset items for pay-per-result Actors, not on raw output; this Actor's real billing behavior remains unverified. User-initiated searches and refreshes have no daily quota; seller profiles and phone lookup are disabled.
- Published Replit server files are ephemeral. Use Turso/libSQL for production SQLite; do not publish without its server-side connection configured.

## Product

Describe a housing wish (Quimper example prefilled); one Enter creates a persistent search and a simple progress page while AI interprets and the app reads up to 5 ads per Apify run in development or up to 100 in production. Interpretation classifies criteria as structured API facts, fields only sometimes available through the API, or wishes requiring description review. Listings failing known numeric constraints are skipped; API facts take precedence, and an LLM fills missing or uncertain fields only with exact quotations from the ad. Unknown is distinct from contradicted. AI generates evidence-backed relevance summaries before atomic persistence and the completed state. Refresh fetches more ads per the environment limit, deduplicates by listing URL, can restore missing images on old ads and keeps existing ads. Editing and relaunching the prompt creates a new persistent search, leaving the old one in history. Users can browse photos in each card, open a detailed view, compare listings and see exact textual evidence. Liked and consulted listings are saved per browser in localStorage (no accounts or cross-device sync), deduplicated by listing URL, with unconsulted ads shown first.
Each listing presents four general facts first (price, area, rooms, location), then explicitly requested preferences, then other API or cited-description features. The card previews only a few preferences and extras; the detail view contains every available value with its provenance. Missing values stay "Non précisé", and the API feature extractor only reads recognized structured fields actually present in each ad.

## User preferences

- Make Logiscope practical and intuitive before making it promotional: explain its purpose briefly, then prioritize the search form and quick access to saved searches. Avoid marketing sections that push the useful controls down the page.
- Keep Apify usage small in development to protect the user's account: inspect at most 10 candidates and store at most 5 per actor call. Production can request and store up to 100 per call. Actor input itself cannot be configured below 10 due to schema minimum.
- Production data must persist in SQLite; user accepted managed Turso/libSQL instead of the ephemeral server filesystem.

## Gotchas

- The actor is `clearpath/leboncoin-api`, not `clearpath/leboncoin` (the latter returned 404).
- OpenAI access uses Replit AI Integrations; no personal OpenAI key is needed. Usage consumes credits. Automated interpretation and listing analysis happen on the API server.
- A development SQLite file is local and deliberately ignored by Git. Production refuses to start without the Turso URL and auth token in server-side secrets; remote persistence cannot be verified until credentials and a Turso database are available.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
