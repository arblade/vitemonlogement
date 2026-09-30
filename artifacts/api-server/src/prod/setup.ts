// Préchargé par `pnpm test:prod` : vrais Apify et OpenAI, mais budget plafonné et base PGlite jetable
// (jamais DATABASE_URL : ces tests n'écrivent pas dans Neon).
for (const name of ["APIFY_TOKEN", "OPENAI_API_KEY"]) {
  if (!process.env[name]) {
    console.error(`Tests prod impossibles : ${name} n'est pas défini.`);
    process.exit(1);
  }
}
delete process.env.APIFY_BASE_URL;
delete process.env.OPENAI_BASE_URL;
delete process.env.DATABASE_URL;
process.env.APIFY_MAX_CHARGE_USD ??= "0.05"; // un run de 10 annonces coûte ~0,015 €
process.env.APIFY_RESULT_LIMIT = "5";
