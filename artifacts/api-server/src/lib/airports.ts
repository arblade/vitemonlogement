import { normalize } from "./places";

/**
 * Grands aéroports commerciaux, quand la base des lieux de l'IGN se trompe ou se tait (relevé du 05/10/2026) :
 *  - « aéroport de Lyon » → Lyon-Bron (aviation d'affaires), alors que tout le monde entend Saint-Exupéry, à ~17 km ;
 *    Saint-Exupéry n'y existe d'ailleurs que comme « lieu-dit habité », catégorie écartée par la recherche de lieux ;
 *  - « aéroport de Paris » → Le Bourget en premier, à égalité de score avec Roissy et Orly ;
 *  - « aéroport Nantes » (sans « de ») → rien, l'aéroport s'appelant « Nantes-Atlantique ».
 * Coordonnées et communes : celles de l'IGN (index « poi »), sauf Saint-Exupéry (lieu-dit de l'aéroport).
 * Un aéroport absent de la table passe par la recherche générale des lieux repères (geocode.ts).
 */
export type Airport = {
  name: string;
  lat: number;
  lng: number;
  /** Commune où se trouve l'aéroport, avec son département (sert à lever les homonymes de la base des communes). */
  commune: string;
  department: string;
  /** Villes desservies : « aéroport de Lyon », ou « à Lyon, près de l'aéroport ». Une ville desservie par deux aéroports est ambiguë. */
  serves: string[];
  /** Noms propres à cet aéroport seul : « Roissy », « Orly », « Saint-Exupéry », « Mérignac »… */
  aliases: string[];
};

export const AIRPORTS: Airport[] = [
  { name: "Aéroport de Paris-Charles de Gaulle", lat: 49.005212, lng: 2.566804, commune: "Roissy-en-France", department: "95", serves: ["paris"], aliases: ["charles de gaulle", "cdg", "roissy"] },
  { name: "Aéroport de Paris-Orly", lat: 48.728917, lng: 2.366476, commune: "Paray-Vieille-Poste", department: "91", serves: ["paris"], aliases: ["orly"] },
  { name: "Aéroport de Paris-Beauvais-Tillé", lat: 49.457835, lng: 2.11451, commune: "Tillé", department: "60", serves: ["beauvais"], aliases: ["beauvais"] },
  { name: "Aéroport de Lyon-Saint-Exupéry", lat: 45.741353, lng: 5.077953, commune: "Colombier-Saugnieu", department: "69", serves: ["lyon"], aliases: ["saint exupery"] },
  { name: "Aéroport de Lyon-Bron", lat: 45.725832, lng: 4.943002, commune: "Chassieu", department: "69", serves: [], aliases: ["bron"] },
  { name: "Aéroport de Marseille-Provence", lat: 43.437747, lng: 5.213574, commune: "Marignane", department: "13", serves: ["marseille", "aix en provence"], aliases: ["marignane", "marseille provence"] },
  { name: "Aéroport de Nice-Côte d'Azur", lat: 43.659292, lng: 7.215885, commune: "Nice", department: "06", serves: ["nice"], aliases: ["nice cote d azur"] },
  { name: "Aéroport de Toulouse-Blagnac", lat: 43.630741, lng: 1.366813, commune: "Blagnac", department: "31", serves: ["toulouse"], aliases: ["blagnac"] },
  { name: "Aéroport de Bordeaux-Mérignac", lat: 44.832241, lng: -0.709382, commune: "Mérignac", department: "33", serves: ["bordeaux"], aliases: ["merignac"] },
  { name: "Aéroport de Nantes-Atlantique", lat: 47.150734, lng: -1.611136, commune: "Bouguenais", department: "44", serves: ["nantes"], aliases: ["nantes atlantique"] },
  { name: "Aéroport de Rennes-Saint-Jacques", lat: 48.070897, lng: -1.733001, commune: "Saint-Jacques-de-la-Lande", department: "35", serves: ["rennes"], aliases: ["saint jacques de la lande"] },
  { name: "Aéroport de Lille-Lesquin", lat: 50.566266, lng: 3.102332, commune: "Fretin", department: "59", serves: ["lille"], aliases: ["lesquin"] },
  { name: "Aéroport de Strasbourg-Entzheim", lat: 48.540122, lng: 7.627887, commune: "Entzheim", department: "67", serves: ["strasbourg"], aliases: ["entzheim"] },
  { name: "Aéroport de Montpellier-Méditerranée", lat: 43.579739, lng: 3.966039, commune: "Mauguio", department: "34", serves: ["montpellier"], aliases: ["montpellier mediterranee"] },
  { name: "Aéroport de Bâle-Mulhouse", lat: 47.603414, lng: 7.521876, commune: "Saint-Louis", department: "68", serves: ["mulhouse"], aliases: ["bale", "bale mulhouse", "euroairport"] },
  { name: "Aéroport de Brest-Bretagne", lat: 48.448321, lng: -4.419415, commune: "Guipavas", department: "29", serves: ["brest"], aliases: ["guipavas"] },
];

const AIRPORT_WORD = /\b(?:aeroports?|aerogares?|aerodromes?)\b/;
const AIRPORT_WORDS_ALL = /\b(?:aeroports?|aerogares?|aerodromes?)\b/g;
const BARE_WORDS = new Set(["l", "le", "la", "de", "du", "d", "a", "au", "un", "une", "international", "proche", "ville"]);
const STANDALONE =new Set(["charles de gaulle", "cdg", "roissy", "orly", "euroairport"]);
/** Mot entier dans un texte normalisé (« bron » n'est pas dans « brongniart »). */
const has = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

export type AirportMatch = { status: "found"; airport: Airport } | { status: "ambiguous"; candidates: Airport[] } | { status: "none" };

/**
 * Aéroport désigné par `address` (« aéroport de Lyon », « Roissy », « aéroport Saint-Exupéry »), sinon par la ville
 * recherchée quand l'adresse dit seulement « l'aéroport ». Un nom propre à un aéroport l'emporte toujours ; une ville
 * desservie par deux aéroports (Paris : Roissy et Orly) est ambiguë : mieux vaut ne rien placer que se tromper.
 */
export function matchAirport(address: string, city = ""): AirportMatch {
  const text = normalize(address);
  const airportWord = AIRPORT_WORD.test(text);
  // Sans le mot « aéroport », seuls les noms qui ne désignent rien d'autre comptent : « gare de Lyon », « rue
  // Saint-Exupéry » ou « Bron » ne sont pas des aéroports, « Roissy-CDG » si.
  const byAlias = AIRPORTS.filter(airport => airport.aliases.some(alias => has(text, alias) && (airportWord || STANDALONE.has(alias))));
  if (byAlias.length === 1) return { status: "found", airport: byAlias[0] };
  if (!airportWord) return { status: "none" };
  const served = (place: string) => AIRPORTS.filter(airport => airport.serves.some(name => has(place, name)));
  let candidates = served(text);
  // « l'aéroport » tout court, et seulement lui : celui de la ville recherchée (« aéroport de Quimper » à Rennes n'est pas Rennes).
  const bare = text.replace(AIRPORT_WORDS_ALL, " ").split(" ").every(word => !word || BARE_WORDS.has(word));
  if (!candidates.length && city && bare) candidates = served(normalize(city));
  if (candidates.length === 1) return { status: "found", airport: candidates[0] };
  return candidates.length ? { status: "ambiguous", candidates } : { status: "none" };
}
