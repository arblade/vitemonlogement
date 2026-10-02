// Préchargé par `pnpm test` : les tests fonctionnels ne doivent jamais toucher les vrais Apify/OpenAI/Google/Resend (ni le géocodeur).
// Les URLs pointent vers un port mort et les clés sont neutralisées : un test qui oublierait son mock
// échoue bruyamment au lieu de coûter de l'argent. Les tests qui ont besoin d'un faux serveur
// (pipeline.test.ts) redéfinissent ces variables eux-mêmes. Les tests « prod » sont dans src/prod (pnpm test:prod).
process.env.APIFY_BASE_URL = "http://127.0.0.1:1";
process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
process.env.APIFY_TOKEN = "offline-guard";
process.env.OPENAI_API_KEY = "offline-guard";
process.env.GEOCODER_BASE_URL = "http://127.0.0.1:1";
process.env.GOOGLE_ROUTES_BASE_URL = "http://127.0.0.1:1";
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.DATABASE_URL;
process.env.RESEND_BASE_URL = "http://127.0.0.1:1";
delete process.env.RESEND_API_KEY;
delete process.env.ALERT_EMAIL;
