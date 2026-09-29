import { Check, LoaderCircle, Search, Sparkles, ScanSearch } from 'lucide-react';

const steps = [
  { key: 'interpreting', label: 'Comprendre votre demande', detail: 'Votre description devient des critères de recherche.', icon: Sparkles },
  { key: 'searching', label: 'Chercher les logements', detail: 'Jusqu’à cinq nouvelles annonces immobilières sont récupérées.', icon: Search },
  { key: 'analyzing', label: 'Vérifier les annonces', detail: 'Les logements sont analysés et leurs sources restent visibles.', icon: ScanSearch },
] as const;

export function SearchProgress({ stage }: { stage: string }) {
  const activeIndex = Math.max(0, steps.findIndex(step => step.key === stage));
  const progress = `${((activeIndex + 1) / steps.length) * 100}%`;

  return <div className="rounded-2xl border border-[#d7dcbc] bg-[#e9edcf] p-6 md:p-8">
    <div className="flex items-start gap-4">
      <div className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-[#292635] text-[#dfe89b]">
        <LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>
      </div>
      <div className="min-w-0">
        <div className="font-data text-[10px] uppercase tracking-[.12em] text-[#66704d]">Étape {activeIndex + 1} sur {steps.length}</div>
        <h3 className="mt-1 text-lg font-semibold">La recherche suit son cours.</h3>
        <p className="mt-1 text-xs text-[#626b51]">Vous pouvez laisser cette page ouverte : elle se met à jour automatiquement.</p>
      </div>
    </div>

    <div className="mt-7 h-1.5 overflow-hidden rounded-full bg-[#cdd5ae]" role="progressbar" aria-label="Progression de la recherche" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={activeIndex + 1}>
      <div className="h-full rounded-full bg-[#77874c] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: progress }}/>
    </div>

    <ol className="mt-6 space-y-2">
      {steps.map((step, index) => {
        const active = index === activeIndex;
        const done = index < activeIndex;
        const Icon = step.icon;
        return <li key={step.key} data-testid={`stage-${step.key}`} aria-current={active ? 'step' : undefined}
          className={`flex items-start gap-3 rounded-xl border px-4 py-4 transition-colors ${active ? 'border-[#9eaa6c] bg-[#fbfaf5] shadow-[0_5px_20px_rgba(41,38,53,.06)]' : 'border-[#dce0ca] bg-[#eef0df]/60'}`}>
          <span className={`grid size-9 shrink-0 place-items-center rounded-full ${active ? 'bg-[#292635] text-[#dfe89b]' : done ? 'bg-[#87934d] text-white' : 'border border-[#bbc4a0] text-[#747d61]'}`}>
            {done ? <Check size={16} aria-hidden="true"/> : active ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/> : <Icon size={16} aria-hidden="true"/>}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center justify-between gap-1">
              <strong className="text-sm">{step.label}</strong>
              <span className={`font-data text-[9px] uppercase tracking-[.08em] ${active ? 'text-[#66733e]' : 'text-[#868a76]'}`}>{active ? 'En cours' : done ? 'Terminé' : 'À venir'}</span>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-[#6d705d]">{step.detail}</span>
          </span>
        </li>;
      })}
    </ol>
  </div>;
}