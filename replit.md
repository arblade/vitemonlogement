# Logiscope

Une recherche immobilière en langage naturel, avec résultats Le Bon Coin fournis par Apify et observations IA vérifiables.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (managed workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- The product uses SQLite via Node's built-in `node:sqlite`; no PostgreSQL migration is needed for Logiscope.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Product DB: SQLite (`.data/logiscope.sqlite`, or `LOGISCOPE_SQLITE_PATH`); the workspace's unused PostgreSQL package remains untouched.
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
- Never trigger a billable actor run during verification unless the user explicitly asks. Actor runs have a hard maximum of 10 results per search and a separate global daily cap of 5 searches; seller profiles and phone lookup are disabled.
- SQLite is appropriate for this single-instance proof of concept; before publishing a multi-instance or ephemeral server, choose durable file storage or migrate the data layer with the user's agreement.

## Product

Describe a housing wish, review/edit interpreted filters, search up to 10 matching announcements, compare listings, optionally analyze descriptions with AI and see exact textual evidence, revisit search history.

## User preferences

- Keep Apify usage small to protect the user's account: only 5–10 results per search; current implementation caps at 10.

## Gotchas

- The actor is `clearpath/leboncoin-api`, not `clearpath/leboncoin` (the latter returned 404).
- OpenAI access uses Replit AI Integrations; no personal OpenAI key is needed. Usage consumes credits.
- The SQLite file is local to the running API service; its persistence across deployment environments has not been verified.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
