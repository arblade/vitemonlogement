import { Bus, TrainFront, TramFront } from 'lucide-react';
import type { HousingListing, NearestStop, StopLine } from '@workspace/api-client-react';
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
 * Arrêt le plus proche, à pied : station de métro ou de tram, ou arrêt de bus (`bus`). Carte : une ligne courte. Fiche
 * (`detailed`) : la distance, à pied si la marche est calculée (OpenRouteService), sinon à vol d'oiseau avec « estimé ».
 */
export function NearestStopLine({ stop, testId, bus = false, detailed = false }: { stop: NearestStop; testId: string; bus?: boolean; detailed?: boolean }) {
  const Icon = bus ? Bus : stop.lines.some(line => line.mode === 'metro') ? TrainFront : TramFront;
  return <div data-testid={testId} className="flex items-start gap-2 text-[13px] text-ink">
    <Icon size={16} aria-hidden="true" className="mt-px shrink-0 text-stone"/>
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <strong className="font-semibold">{stop.estimated ? '≈ ' : ''}{stop.walkMinutes} min à pied</strong>
        <span className="text-stone">· {bus ? 'Bus' : stopKind(stop)} {stop.name}</span>
        {!bus && <StopLines lines={stop.lines}/>}
      </p>
      {detailed && <p className="mt-0.5 text-xs text-stone">{stop.estimated
        ? `${formatDistance(stop.distanceMeters)} à vol d’oiseau ; temps de marche estimé, sans itinéraire.`
        : `${formatDistance(stop.distanceMeters)} à pied.`}</p>}
    </div>
  </div>;
}

/** Accès à pied d'une annonce : métro ou tram, puis bus (ce qui est connu). */
export function NearestStops({ listing, testId, detailed = false }: { listing: Pick<HousingListing, 'nearestStop' | 'nearestBusStop'>; testId: string; detailed?: boolean }) {
  if (!listing.nearestStop && !listing.nearestBusStop) return null;
  return <div data-testid={testId} className={`flex flex-col ${detailed ? 'gap-2' : 'mt-3 gap-1.5'}`}>
    {listing.nearestStop && <NearestStopLine stop={listing.nearestStop} testId={`${testId}-metro`} detailed={detailed}/>}
    {listing.nearestBusStop && <NearestStopLine stop={listing.nearestBusStop} testId={`${testId}-bus`} bus detailed={detailed}/>}
  </div>;
}
