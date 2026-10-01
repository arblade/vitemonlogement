/** Appels à l'API Apify (jeton APIFY_TOKEN ; APIFY_BASE_URL permet de la remplacer dans les tests). */
export async function apify(path: string, init?: { method: string; headers: Record<string, string>; body: string }) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN n'est pas configuré.");
  const response = await fetch(`${process.env.APIFY_BASE_URL || "https://api.apify.com"}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Apify (${response.status}) : ${body.slice(0, 250)}`);
  }
  return response.json() as Promise<unknown>;
}

/** Journal texte d'un run (sert à lire le code de lieu SeLoger résolu par l'acteur). */
export async function apifyText(path: string) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN n'est pas configuré.");
  const response = await fetch(`${process.env.APIFY_BASE_URL || "https://api.apify.com"}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Apify (${response.status}) : ${(await response.text()).slice(0, 250)}`);
  return response.text();
}
