// Banc d'essai de la pipeline « demande → critères → requête Le Bon Coin → lecture → analyse ». Voir README.md.
import type { PropertyType, EnergyClass } from "../../routes/housing/property-type";

/** Annonce du banc, au format de `fatihRecord` (src/test/fatih.ts), plus sa place dans les résultats Le Bon Coin. */
export type BenchAd = {
  id: string;
  /** Pourquoi cette annonce est là (ce qu'elle teste). */
  note: string;
  title: string;
  description: string;
  price: number;
  area?: number;
  rooms?: number;
  /** 1 Maison, 2 Appartement, 4 Parking, 5 Autre (Le Bon Coin). */
  realEstateType?: "1" | "2" | "4" | "5";
  city?: string;
  zipcode?: string;
  lat: number;
  lng: number;
  bedrooms?: number;
  energyRate?: string;
  /** Champs Le Bon Coin en plus (attributs « nb_parkings », « furnished »…), comme `source_data.attributes`. */
  attributes?: Record<string, string>;
  /**
   * Position estimée dans la liste Le Bon Coin de la requête (1 = la plus récemment mise à jour). La recherche ponctuelle
   * ne lit que les 15 premières ; la veille quotidienne remonte 4 jours (105 annonces au plus).
   */
  rank?: number;
  /** Jours depuis la dernière mise à jour de l'annonce (veille : 4 jours remontés). */
  ageDays?: number;
  /** Réponse simulée de l'IA d'analyse pour cette annonce (défaut : logement entier, aucun critère tranché). */
  analysis?: Record<string, unknown>;
  /** Ce qu'une bonne application devrait faire : la montrer, ou l'écarter. */
  expected: "visible" | "écartée";
};

/** Ce que l'interprétation doit produire. Une clé absente n'est pas contrôlée ; `null` exige l'absence. */
export type InterpretationExpectations = {
  location?: string;
  /** La ville est reconnue sans ambiguïté (recherche par URL, avec type, pièces, surface et pages). */
  resolved?: boolean;
  propertyType?: PropertyType | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  minRooms?: number | null;
  maxRooms?: number | null;
  minBedrooms?: number | null;
  minEnergyClass?: EnergyClass | null;
  /** Rayon de recherche minimal (km). */
  radiusAtLeast?: number;
  /** Mot cherché dans le texte des annonces par Le Bon Coin (`text=`) ; null : aucun. */
  searchText?: string | null;
  /** Souhaits attendus (expressions régulières, insensibles à la casse). */
  wishes?: string[];
  /** Souhaits qui ne doivent PAS apparaître. */
  noWishes?: string[];
};

export type BenchCase = {
  id: string;
  theme: string;
  title: string;
  /** Demande telle que la personne l'écrit. */
  prompt: string;
  /**
   * Réponse brute du LLM d'interprétation. `origin` : « simulée » (écrite pour le banc, au plus près de ce que fait
   * gpt-5-mini), « robustesse » (sortie volontairement imparfaite, pour tester le code qui la reçoit) ou un relevé réel.
   * Un relevé réel (--live) la remplace quand il existe (enregistrements.json).
   */
  llm: { origin: "simulée" | "robustesse" | string; raw: Record<string, unknown> };
  expect?: InterpretationExpectations;
  ads: BenchAd[];
  /**
   * Faux géocodeur (IGN) : un lieu cité dont la requête contient `match` est trouvé à ce point, dans cette commune.
   * Les autres lieux ne sont pas trouvés.
   */
  geocoding?: { match: string; lat: number; lng: number; city: string; depcode: string }[];
  /** Ce que le cas cherche à montrer (affiché dans le rapport). */
  why?: string;
};

export type Stage = "interprétation" | "recherche Le Bon Coin" | "profondeur de lecture" | "lecture sans IA" | "analyse IA" | "visible";
export type CheckStatus = "ok" | "échec" | "incertain";
export type Check = { id: string; label: string; status: CheckStatus; detail: string };

export type AdOutcome = {
  id: string;
  note: string;
  expected: BenchAd["expected"];
  /** Étape où l'annonce est perdue (recherche ponctuelle), ou « visible ». */
  stage: Stage;
  reason: string;
  /** Même chose pour la veille quotidienne (4 jours, 105 annonces au plus). */
  watchStage: Stage;
  /** Distance au centre de la recherche (km), si connue. */
  distanceKm: number | null;
  uncertain: boolean;
};

export type CaseResult = {
  id: string;
  theme: string;
  title: string;
  prompt: string;
  why?: string;
  llmOrigin: string;
  criteria: Record<string, unknown>;
  query: {
    actor: string;
    url: string | null;
    params: Record<string, string>;
    center: { name: string; lat: number; lon: number } | null;
    radiusKm: number;
    communes: { count: number; names: string[] };
  };
  checks: Check[];
  ads: AdOutcome[];
};
