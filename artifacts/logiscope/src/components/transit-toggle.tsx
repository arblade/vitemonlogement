import { useState } from 'react';
import { TramFront } from 'lucide-react';

const KEY = 'vml-transit-lines';

/** Lignes de tram et de métro affichées ou non : choix mémorisé sur l'appareil (masquées par défaut). */
export function useTransitLines() {
  const [show, setShow] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const toggle = () => setShow(value => {
    try { localStorage.setItem(KEY, value ? '0' : '1'); } catch { /* navigation privée : choix non mémorisé */ }
    return !value;
  });
  return [show, toggle] as const;
}

/** Interrupteur posé sur la carte, en bas à gauche (le logement est au centre, le zoom en haut à droite). */
export function TransitLinesToggle({ show, onToggle, testId }: { show: boolean; onToggle: () => void; testId: string }) {
  return <button type="button" role="switch" aria-checked={show} data-testid={testId} onClick={onToggle}
    className={`absolute bottom-2.5 left-2.5 z-10 inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_1px_4px_rgba(0,0,0,.18)] transition-colors ${show ? 'border-ink bg-ink text-[#ffffff]' : 'border-line bg-[#ffffff] text-ink hover:border-ink'}`}>
    <TramFront size={14} aria-hidden="true"/>Lignes tram · métro
  </button>;
}
