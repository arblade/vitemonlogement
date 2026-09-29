import { Link } from 'wouter';
import { ArrowLeft, ArrowUpRight, Heart, Trash2 } from 'lucide-react';
import { formatPrice } from '@/components/site-shell';
import { listingKey, markListingViewed, removeListingFavorite, useListingInteractions } from '@/lib/listing-interactions';
import { useState } from 'react';

export default function Likes() {
  const { favorites, viewed } = useListingInteractions();
  const [error, setError] = useState('');
  const listings = Object.values(favorites).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return <main className="mx-auto min-h-[75dvh] max-w-[1100px] px-5 py-12 md:px-10 md:py-16">
    <Link href="/searches" className="inline-flex items-center gap-2 text-xs font-semibold text-[#77746a] hover:text-[#292635]"><ArrowLeft size={15}/> Revenir aux recherches</Link>
    <div className="mt-10 flex items-center gap-3 text-[#72804c]"><Heart size={18} fill="currentColor"/><span className="font-data text-[11px] uppercase tracking-[.14em]">Votre sélection</span></div>
    <h1 className="mt-3 text-4xl font-semibold tracking-[-.06em] md:text-6xl">Annonces aimées<span className="text-[#899259]">.</span></h1>
    <p className="mt-4 text-sm text-[#77746a]">Vos annonces mises de côté restent ici après actualisation, sur ce navigateur.</p>
    {error && <p role="alert" className="mt-5 text-sm text-[#a84d43]">{error}</p>}
    {!listings.length ? <div className="mt-10 rounded-2xl border border-dashed border-[#c9c8b9] bg-[#eeeee5] p-8 md:p-12"><Heart className="text-[#788653]"/><h2 className="mt-5 text-xl font-semibold">Aucune annonce aimée pour le moment.</h2><p className="mt-2 text-sm text-[#77746a]">Touchez le cœur d’une annonce pour la retrouver ici.</p><Link href="/searches" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4">Voir mes recherches <ArrowUpRight size={14}/></Link></div> :
      <div className="mt-10 grid gap-5 md:grid-cols-2">{listings.map(item => <article key={listingKey(item.url)} className={`overflow-hidden rounded-2xl border border-[#d9d6c9] bg-[#fbfaf5] ${viewed.includes(listingKey(item.url)) ? 'opacity-70' : ''}`}>
        {item.image && <img src={item.image} alt="" loading="lazy" className="h-48 w-full bg-[#e9ebdc] object-cover"/>}
        <div className="p-5">
          <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
          <p className="mt-3 text-sm font-semibold">{formatPrice(item.price)} <span className="font-normal text-[#77746a]">· {item.area != null ? `${item.area} m²` : 'Surface non précisée'} · {item.location || 'Lieu non précisé'}</span></p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={`/searches/${item.searchId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-4">Voir dans la recherche <ArrowUpRight size={13}/></Link>
            <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => { if (!markListingViewed(item.url)) setError('Impossible de mémoriser les annonces consultées dans ce navigateur.'); }} className="inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-4">Voir sur Leboncoin <ArrowUpRight size={13}/></a>
            <button type="button" aria-label={`Retirer des annonces aimées : ${item.title}`} onClick={() => { if (!removeListingFavorite(item.url)) setError('Impossible de sauvegarder vos changements dans ce navigateur.'); else setError(''); }} className="ml-auto inline-flex items-center gap-1 text-xs text-[#80685f] hover:text-[#a84d43]"><Trash2 size={13}/> Retirer</button>
          </div>
        </div>
      </article>)}</div>}
  </main>;
}