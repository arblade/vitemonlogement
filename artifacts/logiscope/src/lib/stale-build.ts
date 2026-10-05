// Après un déploiement, un onglet resté ouvert garde l'ancienne version de l'appli : les fichiers chargés à la demande
// (la carte, par exemple) portent un nom qui n'existe plus. Vite signale alors `vite:preloadError` : on recharge la page
// pour récupérer la version en ligne, une seule fois (au-delà, c'est un vrai problème : l'erreur s'affiche).
export const RELOAD_KEY = 'vml-stale-reload';
export const RELOAD_WINDOW_MS = 30_000;

type Deps = { storage: Pick<Storage, 'getItem' | 'setItem'>; reload: () => void; now: () => number };
const browser = (): Deps => ({ storage: sessionStorage, reload: () => location.reload(), now: Date.now });

/** Recharge la page si on ne l'a pas déjà fait il y a moins de 30 s. Vrai si elle se recharge (l'erreur est alors évitée). */
export function reloadOnStaleBuild(event: { preventDefault: () => void }, deps: Deps = browser()): boolean {
  try {
    const last = Number(deps.storage.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && deps.now() - last < RELOAD_WINDOW_MS) return false;
    deps.storage.setItem(RELOAD_KEY, String(deps.now()));
  } catch {
    return false; // stockage indisponible : impossible de garantir une seule relance, on ne boucle pas
  }
  event.preventDefault();
  deps.reload();
  return true;
}
