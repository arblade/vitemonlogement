import { describe, expect, it, vi } from 'vitest';
import { RELOAD_KEY, RELOAD_WINDOW_MS, reloadOnStaleBuild } from '@/lib/stale-build';

function setup(initial?: string, throwing = false) {
  const store = new Map<string, string>(initial ? [[RELOAD_KEY, initial]] : []);
  let clock = 1_000_000;
  const storage = {
    getItem: (key: string) => { if (throwing) throw new Error('storage'); return store.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (throwing) throw new Error('storage'); store.set(key, value); },
  };
  const reload = vi.fn(), preventDefault = vi.fn();
  return { store, reload, preventDefault, advance: (ms: number) => { clock += ms; }, run: () => reloadOnStaleBuild({ preventDefault }, { storage, reload, now: () => clock }) };
}

describe('onglet resté ouvert pendant un déploiement', () => {
  it('première erreur de chargement : la page se recharge, l’erreur est évitée', () => {
    const t = setup();
    expect(t.run()).toBe(true);
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.preventDefault).toHaveBeenCalledTimes(1);
    expect(t.store.get(RELOAD_KEY)).toBe('1000000');
  });

  it('déjà rechargée il y a moins de 30 s : pas de boucle, l’erreur reste visible (vrai problème)', () => {
    const t = setup('1000000');
    t.advance(RELOAD_WINDOW_MS - 1);
    expect(t.run()).toBe(false);
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.preventDefault).not.toHaveBeenCalled();
  });

  it('une nouvelle version publiée plus tard (plus de 30 s après) relance de nouveau', () => {
    const t = setup('1000000');
    t.advance(RELOAD_WINDOW_MS + 1);
    expect(t.run()).toBe(true);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('stockage indisponible (navigation privée stricte) : on ne recharge pas, au risque de boucler', () => {
    const t = setup(undefined, true);
    expect(t.run()).toBe(false);
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.preventDefault).not.toHaveBeenCalled();
  });

  it('valeur illisible en stockage : traitée comme « jamais rechargée »', () => {
    const t = setup('pas-un-nombre');
    expect(t.run()).toBe(true);
  });
});
