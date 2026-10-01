const SITES: [RegExp, string][] = [[/(^|\.)leboncoin\.fr$/, 'Le Bon Coin'], [/(^|\.)pap\.fr$/, 'PAP'], [/(^|\.)seloger\.com$/, 'SeLoger']];

/** Nom du site d'origine d'une annonce, d'après son adresse (aussi pour les favoris, enregistrés sans source). */
export function sourceName(url: string, fallback = 'la source') {
  try {
    const host = new URL(url).hostname;
    return SITES.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^www\./, '');
  } catch {
    return fallback;
  }
}
