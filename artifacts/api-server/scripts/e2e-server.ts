// Serveur pour les tests de bout en bout (pnpm test:e2e) : vraie API + front compilé, base PGlite jetable en mémoire,
// une ancienne recherche sans propriétaire (pour vérifier son adoption par le premier compte) et AUCUN accès à Apify/OpenAI.
import { openDatabase } from "@workspace/db";
import { initDatabase } from "../src/lib/database";
import { completeSearch, createSearch, setCriteria } from "../src/routes/housing/store";

process.env.APIFY_BASE_URL = "http://127.0.0.1:1";
process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
process.env.APIFY_TOKEN = "e2e";
process.env.OPENAI_API_KEY = "e2e";
delete process.env.DATABASE_URL;

await initDatabase(await openDatabase({ dataDir: "memory://" }));
const id = await createSearch("Un studio à Lille, 700 € max, chat accepté");
await setCriteria(id, { location: "Lille", intent: "rent", maxPrice: 700, radius: 5, keywords: "", wishes: ["chat accepté"], checks: [{ id: "price", label: "Budget ≤ 700 €", availability: "api" }, { id: "wish-1", label: "chat accepté", availability: "description", apiField: null }] });
const listing = (n: number) => ({
  batch: "focused" as const, title: `Studio lumineux proche métro ${n}`, url: `https://www.leboncoin.fr/ad/locations/${n}`, description: "d", price: 590 + n * 10, area: 25, rooms: 1,
  location: "Lille", image: null, images: [], aiSummary: "Studio calme proche métro.", summaryEvidence: [], score: 80 - n, features: [],
  criterionResults: [
    { id: "price", label: "Budget ≤ 700 €", status: "confirmed" as const, source: "api" as const, value: "590 €", evidence: "" },
    { id: "wish-1", label: "chat accepté", status: "unknown" as const, source: "unknown" as const, value: "", evidence: "" },
  ],
});
await completeSearch(id, [listing(1), listing(2)], "focused");

const { default: app } = await import("../src/app");
app.listen(Number(process.env.PORT ?? 4180), () => console.log("prêt"));
