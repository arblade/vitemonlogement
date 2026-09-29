import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Compass,
  Home,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import "./logiscopehomerefined.css";

const examples = [
  "Un deux-pièces lumineux à Lyon, près du métro, moins de 1 100 € par mois",
  "Une maison avec jardin autour de Nantes, trois chambres",
  "Un appartement calme à Paris 11e avec balcon",
];

const searches = [
  { location: "Quimper", detail: "Location · 30–50 m² · parking", date: "Aujourd’hui", count: "12 annonces" },
  { location: "Lyon 7e", detail: "Deux pièces · proche du métro", date: "Hier", count: "8 annonces" },
  { location: "Nantes & alentours", detail: "Maison · jardin · 3 chambres", date: "12 juin", count: "5 annonces" },
];

export default function LogiscopeHomeRefined() {
  const [prompt, setPrompt] = useState(
    "Je recherche à Quimper un logement entre 400 € et 800 € par mois avec une place de parking et entre 30 et 50 m².",
  );
  const [notice, setNotice] = useState("");
  const [activeSearch, setActiveSearch] = useState("");

  const startSearch = () => {
    if (prompt.trim().length < 10) {
      setNotice("Ajoutez quelques détails pour lancer une recherche pertinente.");
      return;
    }
    setNotice("Votre recherche est prête à être affinée. Les critères sont conservés ici.");
  };

  return (
    <main className="lr-page">
      <header className="lr-nav">
        <a href="#home" className="lr-brand" aria-label="Logiscope accueil">
          <span className="lr-brand-mark"><Compass size={20} strokeWidth={1.7} /></span>
          <span>logiscope<span className="lr-period">.</span></span>
        </a>
        <nav className="lr-nav-links" aria-label="Navigation principale">
          <a className="lr-nav-current" href="#home">Nouvelle recherche</a>
          <a href="#history">Mes recherches <span className="lr-nav-count">03</span></a>
          <span className="lr-nav-rule" />
          <span className="lr-nav-promise"><Check size={14} /> Des annonces, pas des promesses</span>
        </nav>
      </header>

      <section className="lr-hero" id="home">
        <div className="lr-hero-grid" />
        <div className="lr-orbit lr-orbit-one" />
        <div className="lr-orbit lr-orbit-two" />
        <div className="lr-orbit lr-orbit-three" />
        <div className="lr-hero-inner">
          <div className="lr-kicker"><span /> Le bon lieu commence par les bonnes questions</div>
          <div className="lr-hero-heading">
            <div>
              <h1>Décrivez une vie.<br /><em>Trouvez son adresse.</em></h1>
              <p className="lr-intro">Votre prochain chez-vous ne tient pas dans un filtre. Racontez-nous ce qui compte — on s’occupe de traduire.</p>
            </div>
            <aside className="lr-method">
              <span className="lr-mono">NOTRE MÉTHODE&nbsp; / &nbsp;01—03</span>
              <p>Vos envies d’abord.<br /><em>Les faits ensuite.</em></p>
              <span className="lr-method-note">Chaque annonce garde ses sources et ses preuves à portée de regard.</span>
            </aside>
          </div>

          <div className="lr-search-wrap">
            <div className="lr-search-topline">
              <span><Sparkles size={14} /> Votre recherche, en langage naturel</span>
              <span className="lr-char-count">{prompt.length} / 1 000</span>
            </div>
            <div className="lr-composer">
              <textarea
                aria-label="Décrivez le logement recherché"
                maxLength={1000}
                value={prompt}
                onChange={(event) => { setPrompt(event.target.value); setNotice(""); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    startSearch();
                  }
                }}
                placeholder="Ex. Un appartement lumineux à Bordeaux, près du tram, deux chambres…"
              />
              <button className="lr-launch" type="button" onClick={startSearch}>
                <span>Lancer la recherche</span><ArrowRight size={17} />
              </button>
            </div>
            <div className="lr-composer-foot">
              <span><kbd>↵</kbd> Rechercher <span className="lr-foot-sep">·</span> <kbd>⇧ ↵</kbd> Nouvelle ligne</span>
              <span>5 nouvelles annonces maximum par appel</span>
            </div>
            {notice && <div className="lr-feedback" role="status">{notice}</div>}
          </div>

          <div className="lr-try-row">
            <span className="lr-mono">BESOIN D’UN DÉPART&nbsp;?</span>
            {examples.map((example, index) => (
              <button key={example} type="button" onClick={() => { setPrompt(example); setNotice(""); }}>
                <span className="lr-example-number">0{index + 1}</span>{example}<ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="lr-history" id="history">
        <div className="lr-history-head">
          <div>
            <div className="lr-section-label"><span>01</span> Votre carnet de recherche</div>
            <h2>Reprendre le fil<em>.</em></h2>
          </div>
          <button className="lr-view-all" type="button" onClick={() => setActiveSearch(activeSearch ? "" : "Toutes vos recherches sont affichées")}>
            Tout l’historique <ArrowRight size={15} />
          </button>
        </div>
        <div className="lr-history-list">
          {searches.map((search, index) => (
            <button
              className={`lr-history-item ${activeSearch === search.location ? "is-selected" : ""}`}
              key={search.location}
              type="button"
              onClick={() => setActiveSearch(activeSearch === search.location ? "" : search.location)}
            >
              <span className="lr-search-index">0{index + 1}</span>
              <span className="lr-history-main">
                <strong>{search.location}</strong>
                <span>{search.detail}</span>
              </span>
              <span className="lr-history-date">{search.date}</span>
              <span className="lr-history-status"><i />{search.count}</span>
              <ChevronRight className="lr-history-chevron" size={18} />
            </button>
          ))}
        </div>
        {activeSearch && <div className="lr-selected-note" role="status"><MapPin size={15} /> {activeSearch}</div>}
        <div className="lr-history-end">
          <span>Une sélection pensée pour vous, pas une avalanche.</span>
          <button type="button" onClick={() => { document.getElementById("home")?.scrollIntoView({ behavior: "smooth" }); setPrompt(""); }}>
            <Plus size={15} /> Nouvelle recherche
          </button>
        </div>
      </section>

      <section className="lr-principle">
        <div className="lr-principle-icon"><SlidersHorizontal size={19} /></div>
        <div className="lr-principle-copy">
          <span className="lr-mono">MOINS DE BRUIT. PLUS DE CONTEXTE.</span>
          <p>Les annonces restent vérifiables.<br /><em>Les déductions restent signalées.</em></p>
        </div>
        <div className="lr-principle-detail">
          <span><Home size={15} /> Jusqu’à 5 nouvelles annonces par recherche</span>
          <span><Search size={15} /> Sources et extraits visibles, sans raccourci</span>
        </div>
      </section>

      <footer className="lr-footer">
        <a href="#home" className="lr-footer-brand"><Compass size={16} /> logiscope<span>.</span></a>
        <span>La recherche immobilière, les yeux ouverts.</span>
        <span className="lr-footer-right">Les informations viennent des annonces. Vérifiez auprès de la source. <ArrowUpRight size={12} /></span>
      </footer>
    </main>
  );
}