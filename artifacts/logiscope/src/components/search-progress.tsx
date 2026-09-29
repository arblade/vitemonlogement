import { Check } from 'lucide-react';

const steps = [
  { key: 'interpreting', label: 'Comprendre votre recherche' },
  { key: 'searching', label: 'Chercher des annonces' },
  { key: 'analyzing', label: 'Vérifier les annonces' },
] as const;

export function SearchProgress({ stage, phase = 'focused' }: { stage: string; phase?: 'focused' | 'broad' }) {
  const stageIndex = steps.findIndex(step => step.key === stage);
  // Une recherche élargie peut recommencer à chercher après la vérification
  // initiale. Ce nouveau passage ne doit pas faire reculer la barre.
  const activeIndex = phase === 'broad' ? steps.length - 1 : Math.max(0, stageIndex);
  // Milestones, not a time estimate: do not announce 100% while work is still running.
  const progress = phase === 'broad' ? (stage === 'analyzing' ? 92 : 85) : [20, 50, 75][activeIndex];
  const activity = phase === 'broad'
    ? stage === 'analyzing'
      ? 'Nous vérifions aussi les annonces trouvées en élargissant la recherche.'
      : 'Nous cherchons d’autres annonces qui pourraient vous convenir.'
    : stage === 'analyzing'
      ? 'Nous lisons les annonces et vérifions ce qui correspond à vos critères.'
      : stage === 'searching'
        ? 'Nous parcourons les annonces qui pourraient vous convenir.'
        : 'Nous repérons vos critères dans votre description.';

  return <section className="rounded-2xl border border-[#d7dcbc] bg-[#e9edcf] px-5 py-6 md:px-8 md:py-7" aria-label="Recherche en cours" aria-live="polite">
    <div className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[.14em] text-[#66704d]">
      <span className="pulse-dot size-2 rounded-full bg-[#77874c]" aria-hidden="true" />
      Recherche en cours
    </div>
    <h3 data-testid="text-current-activity" className="mt-3 max-w-xl text-lg font-semibold leading-snug tracking-tight text-[#292635]">{activity}</h3>
    <p className="mt-1 text-xs leading-relaxed text-[#626b51]">{phase === 'broad' ? 'Les premières annonces sont disponibles plus bas.' : 'Les résultats apparaîtront sur cette page dès qu’ils seront prêts.'}</p>

    <div
      className="mt-6 h-2 overflow-hidden rounded-full bg-[#cdd5ae]"
      role="progressbar"
      aria-label="Étapes de la recherche"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-valuetext={phase === 'broad' ? 'Recherche élargie en cours' : steps[activeIndex].label}
    >
      <div className="h-full rounded-full bg-[#77874c] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
    </div>

    <ol className="mt-5 space-y-2">
      {steps.slice(0, activeIndex + 1).map((step, index) => {
        const complete = phase === 'broad' || index < activeIndex;
        return <li key={step.key} data-testid={`stage-${step.key}`} aria-current={!complete ? 'step' : undefined} className="flex items-center gap-2.5 text-sm text-[#3c4233]">
          <span className={`grid size-5 shrink-0 place-items-center rounded-full ${complete ? 'bg-[#77874c] text-[#f5f3eb]' : 'border-2 border-[#77874c]'}`} aria-hidden="true">
            {complete && <Check size={12} strokeWidth={2.5} />}
          </span>
          <span className={complete ? 'text-[#68705a]' : 'font-semibold'}>{step.label}</span>
          <span className="sr-only">{complete ? 'terminée' : 'en cours'}</span>
        </li>;
      })}
      {phase === 'broad' && <li data-testid="stage-broad" aria-current="step" className="flex items-center gap-2.5 text-sm font-semibold text-[#3c4233]">
        <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-[#77874c]" aria-hidden="true" />
        Recherche élargie <span className="sr-only">en cours</span>
      </li>}
    </ol>
  </section>;
}