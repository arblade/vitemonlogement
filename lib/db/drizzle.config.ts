import { defineConfig } from "drizzle-kit";

// `pnpm --filter @workspace/db generate` produit les migrations ; elles sont appliquées
// au démarrage du serveur (openDatabase().migrate()), jamais par `push`.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(process.env.DATABASE_URL ? { dbCredentials: { url: process.env.DATABASE_URL } } : {}),
});
