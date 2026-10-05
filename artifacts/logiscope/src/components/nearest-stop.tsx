import { TrainFront, TramFront } from 'lucide-react';
import type { NearestStop, StopLine } from '@workspace/api-client-react';
import { formatDistance, ROUTE_COLOR, textOn } from '@/lib/geo';

/** « Métro », « Tram » ou « Métro et tram » selon les lignes qui desservent la station. */
export function stopKind(stop: Pick<NearestStop, 'lines'>) {
  const metro = stop.lines.some(line => line.mode === 'metro'), tram = stop.lines.some(line => line.mode === 'tram');
  return metro && tram ? 'Métro et tram' : metro ? 'Métro' : 'Tram';
}

/** Nom affiché d'une ligne : « M1 » pour une ligne de métro numérotée (Paris, Lille…), sinon son nom (« T2 », « A »). */
export const lineLabel = (line: StopLine) => line.mode === 'metro' && /^\d/.test(line.name) ? `M${line.name}` : line.name;

export function StopLines({ lines }: { lines: StopLine[] }) {
  if (!lines.length) return null;
  return <span className="inline-flex flex-wrap items-center gap-1" aria-label={`Lignes ${lines.map(lineLabel).join(', ')}`}>
    {lines.slice(0, 4).map(line => {
      const color = line.color && /^#[0-9a-f]{6}$/i.test(line.color) ? line.color : ROUTE_COLOR;
      return <span key={`${line.mode}-${line.name}`} aria-hidden="true" className="rounded-[5px] px-1.5 py-0.5 text-[12px] font-extrabold leading-none" style={{ background: color, color: textOn(color) }}>{lineLabel(line)}</span>;
    })}
    {lines.length > 4 && <span aria-hidden="true" className="text-xs text-stone">+{lines.length - 4}</span>}
  </span>;
}

/**
 * Station de métro ou de tram la plus proche, à pied. Carte : une ligne courte. Fiche (`detailed`) : la distance et le
 * fait que la marche est estimée (vol d'oiseau majoré, sans itinéraire).
 */
export function NearestStopLine({ stop, testId, detailed = false }: { stop: NearestStop; testId: string; detailed?: boolean }) {
  const Icon = stop.lines.some(line => line.mode === 'metro') ? TrainFront : TramFront;
  return <div data-testid={testId} className={`flex items-start gap-2 text-[13px] text-ink ${detailed ? '' : 'mt-3'}`}>
    <Icon size={16} aria-hidden="true" className="mt-px shrink-0 text-stone"/>
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <strong className="font-semibold">{stop.walkMinutes} min à pied</strong>
        <span className="text-stone">· {stopKind(stop)} {stop.name}</span>
        <StopLines lines={stop.lines}/>
      </p>
      {detailed && <p className="mt-0.5 text-xs text-stone">{formatDistance(stop.distanceMeters)} à vol d’oiseau ; temps de marche estimé, sans itinéraire.</p>}
    </div>
  </div>;
}
