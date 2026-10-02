/**
 * Jauge de correspondance (score de 0 à 100) : un anneau fin à l'encre sur un fond gris clair, le score au centre, à la
 * façon Airbnb. Le vert reste réservé à « critère satisfait » ; la jauge dit « à quel point », pas « oui ou non ».
 */
export function matchLabel(score: number) {
  const value = Math.round(score);
  if (value >= 80) return 'Excellente correspondance';
  if (value >= 60) return 'Bonne correspondance';
  if (value >= 40) return 'Correspondance partielle';
  return 'Faible correspondance';
}

const SIZES = { sm: { box: 40, stroke: 3.5, text: 'text-[13px]' }, md: { box: 48, stroke: 4, text: 'text-[15px]' } } as const;

export function MatchGauge({ score, size = 'sm', label = false, testId }: { score: number; size?: keyof typeof SIZES; label?: boolean; testId?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const { box, stroke, text } = SIZES[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const words = matchLabel(value);
  return <span data-testid={testId} className="inline-flex min-w-0 items-center gap-2.5 sm:gap-3" title={`${words} : ${value} sur 100`}>
    <span role="img" aria-label={`${words} : ${value} sur 100`} className="relative grid shrink-0 place-items-center" style={{ width: box, height: box }}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle cx={box / 2} cy={box / 2} r={radius} fill="none" stroke="#ebebeb" strokeWidth={stroke}/>
        <circle data-testid={testId ? `${testId}-arc` : undefined} cx={box / 2} cy={box / 2} r={radius} fill="none" stroke="#222222" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(circumference * value) / 100} ${circumference}`}/>
      </svg>
      <span aria-hidden="true" className={`relative font-semibold tracking-[-.02em] text-ink ${text}`}>{value}</span>
    </span>
    {label && <span aria-hidden="true" className="max-w-[6.5rem] text-xs font-semibold leading-tight text-ink sm:max-w-none sm:text-sm">{words}</span>}
  </span>;
}
