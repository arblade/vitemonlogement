import { useState } from 'react';
import { TramFront } from 'lucide-react';
import { METRO_COLOR, TRAM_COLOR } from '@/components/map-transit';

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

/** Interrupteur posé sur la carte, en bas à gauche (le logement est au centre, le zoom en haut à droite) ; légende des couleurs quand les lignes sont affichées. */
export function TransitLinesToggle({ show, onToggle, testId, zoomHint = false }: { show: boolean; onToggle: () => void; testId: string; zoomHint?: boolean }) {
  return <div className="absolute bottom-2.5 left-2.5 z-10 flex flex-col-reverse items-start gap-1">
    <button type="button" role="switch" aria-checked={show} data-testid={testId} onClick={onToggle}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_1px_4px_rgba(0,0,0,.18)] transition-colors ${show ? 'border-ink bg-ink text-[#ffffff]' : 'border-line bg-[#ffffff] text-ink hover:border-ink'}`}>
      <TramFront size={14} aria-hidden="true"/>Lignes tram · métro
    </button>
    {show && <p data-testid={`${testId}-legend`} className="flex items-center gap-2 rounded-full bg-[#ffffff]/95 px-2.5 py-1 text-xs text-ink shadow-[0_1px_4px_rgba(0,0,0,.18)]">
      {zoomHint ? 'Zoomez pour voir les lignes' : <>
        <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-1 w-3.5 rounded-full" style={{ background: METRO_COLOR }}/>Métro</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-1 w-3.5 rounded-full" style={{ background: TRAM_COLOR }}/>Tram</span>
      </>}
    </p>}
  </div>;
}
