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
process.env.APIFY_MAX_CHARGE_USD ??= "0.05"; // une page de 35 annonces coûte ~0,035 $
process.env.READ_MAX_PAGES = "1"; // une seule page lue
process.env.FIRST_ANALYSIS = "5"; // 5 annonces analysées par l'IA
