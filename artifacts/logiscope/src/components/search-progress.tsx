import { Check } from 'lucide-react';

const steps = [
  { key: 'interpreting', label: 'Comprendre votre recherche', hint: 'Ville, budget, surface et souhaits' },
  { key: 'searching', label: 'Chercher des annonces', hint: 'Parcours des annonces du moment' },
  { key: 'analyzing', label: 'Vérifier les annonces', hint: 'Lecture des textes, critère par critère' },
] as const;

function StepIcon({ state }: { state: 'done' | 'current' | 'todo' }) {
  if (state === 'done') return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-paper"><Check size={14} strokeWidth={3} aria-hidden="true" /></span>;
  if (state === 'current') return <span className="relative grid size-7 shrink-0 place-items-center">
    <span className="absolute inset-0 rounded-full border-2 border-brand-wash" />
    <span className="spin-arc absolute inset-0 rounded-full border-2 border-brand border-t-transparent" />
    <span className="size-2 rounded-full bg-brand" />
  </span>;
  return <span className="size-7 shrink-0 rounded-full border-2 border-line-soft" />;
}

function PreviewCard({ className = '' }: { className?: string }) {
  return <div className={`overflow-hidden rounded-3xl border border-line-soft bg-paper ${className}`}>
    <div className="shimmer aspect-[16/10] w-full" />
    <div className="space-y-3 p-5">
      <div className="shimmer h-4 w-3/4 rounded-full" />
      <div className="shimmer h-3 w-1/2 rounded-full" />
      <div className="shimmer h-3 w-2/3 rounded-full" />
    </div>
  </div>;
}

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
  const stateOf = (index: number) => phase === 'broad' || index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'todo';

  return <section className="rounded-[2rem] border border-line-soft bg-paper p-6 shadow-[0_6px_24px_rgba(0,0,0,.06)] md:p-10" aria-label="Recherche en cours" aria-live="polite">
    <div className="flex items-center gap-2.5 text-sm font-semibold text-ink">
      <span className="relative flex size-2.5" aria-hidden="true">
        <span className="pulse-ring absolute inline-flex size-full rounded-full bg-brand" />
        <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
      </span>
      Recherche en cours
    </div>
    <h3 data-testid="text-current-activity" className="mt-4 max-w-xl text-2xl font-semibold leading-snug tracking-[-.02em] text-ink md:text-[28px]">{activity}</h3>
    <p className="mt-2 text-sm leading-relaxed text-stone">{phase === 'broad' ? 'Les premières annonces sont disponibles plus bas.' : 'Vous pouvez quitter cette page : la recherche continue et vos résultats vous attendront dans « Mes recherches ».'}</p>

    <div
      className="mt-7 h-1.5 overflow-hidden rounded-full bg-line-soft"
      role="progressbar"
      aria-label="Étapes de la recherche"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-valuetext={phase === 'broad' ? 'Recherche élargie en cours' : steps[activeIndex].label}
    >
      <div className="progress-fill h-full rounded-full bg-gradient-to-r from-brand to-brand-dark transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
    </div>

    <ol className="mt-8 space-y-5">
      {steps.map((step, index) => {
        const state = stateOf(index);
        return <li key={step.key} data-testid={`stage-${step.key}`} aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-4">
          <StepIcon state={state} />
          <span className="min-w-0">
            <span className={`block text-base ${state === 'current' ? 'font-semibold text-ink' : state === 'done' ? 'font-medium text-ink' : 'text-stone-soft'}`}>{step.label}</span>
            {state === 'current' && <span className="mt-0.5 block text-sm text-stone">{step.hint}</span>}
          </span>
          <span className="sr-only">{state === 'done' ? 'terminée' : state === 'current' ? 'en cours' : 'à venir'}</span>
        </li>;
      })}
      {phase === 'broad' && <li data-testid="stage-broad" aria-current="step" className="flex items-center gap-4">
        <StepIcon state="current" />
        <span className="text-base font-semibold text-ink">Recherche élargie <span className="sr-only">en cours</span></span>
      </li>}
    </ol>

    {phase !== 'broad' && <div aria-hidden="true" data-testid="progress-preview" className="mt-10 grid gap-5 sm:grid-cols-2">
      <PreviewCard />
      <PreviewCard className="hidden sm:block" />
    </div>}
  </section>;
}
