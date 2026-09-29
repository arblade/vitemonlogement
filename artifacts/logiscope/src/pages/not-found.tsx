import { Link } from 'wouter';
import { ArrowLeft, Compass } from 'lucide-react';
import { Eyebrow } from '@/components/site-shell';

export default function NotFound() {
  return <main className="flex min-h-[75dvh] items-center bg-[#e9ebdc] px-5 py-20 md:px-10 lg:px-16">
    <div className="mx-auto w-full max-w-[1440px]">
      <Eyebrow number="—">Hors carte</Eyebrow>
      <div className="mt-8 flex flex-col items-start gap-10 md:flex-row md:items-end md:justify-between">
        <div><h1 className="text-[clamp(5rem,14vw,13rem)] font-semibold leading-[.8] tracking-[-.09em]">404<span className="font-editorial font-normal italic text-[#8c9858]">.</span></h1><p className="mt-8 max-w-md font-editorial text-[34px] italic leading-tight">Cette adresse ne mène nulle part.</p><p className="mt-3 text-sm text-[#6e715f]">Reprenons depuis le début de votre recherche.</p><Link href="/" data-testid="link-not-found-home" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[#292635] px-5 py-3 text-sm font-semibold text-[#e1e99d] transition-colors hover:bg-[#484354]"><ArrowLeft size={16}/> Retour à l’accueil</Link></div>
        <Compass className="size-28 rotate-[-18deg] text-[#aeb78c] md:size-52" strokeWidth={.65}/>
      </div>
    </div>
  </main>;
}