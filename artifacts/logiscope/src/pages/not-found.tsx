import { Link } from 'wouter';
import { ArrowLeft, Compass } from 'lucide-react';
import { Eyebrow } from '@/components/site-shell';

export default function NotFound() {
  return <main className="flex min-h-[75dvh] items-center bg-sage px-5 py-20 md:px-10 lg:px-16">
    <div className="mx-auto w-full max-w-[1440px]">
      <Eyebrow number="—">Hors carte</Eyebrow>
      <div className="mt-8 flex flex-col items-start gap-10 md:flex-row md:items-end md:justify-between">
        <div><h1 className="text-[clamp(4rem,10vw,8rem)] font-semibold leading-[1.08] tracking-[-.03em]">404</h1><p className="mt-8 max-w-md text-[34px] leading-tight">Cette adresse ne mène nulle part.</p><p className="mt-3 text-sm text-[#3f3f46]">Reprenons depuis le début de votre recherche.</p><Link href="/" data-testid="link-not-found-home" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-[#5cc9a7] transition-colors hover:bg-[#27272a]"><ArrowLeft size={16}/> Retour à l’accueil</Link></div>
        <Compass className="size-28 rotate-[-18deg] text-[#5cc9a7] md:size-52" strokeWidth={.65}/>
      </div>
    </div>
  </main>;
}