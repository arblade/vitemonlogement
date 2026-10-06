import type { Criteria } from "./store";
import { nearestCommune, resolvePlace } from "../../lib/places";
import { extraSourceOf } from "./sources";
import { realEstateTypes } from "./property-type";
import { queryMinRooms } from "./criteria";
import { hasDistanceLimit, placeReachKm } from "../../lib/distance";

// « broad » : recherche élargie, supprimée le 01/10/2026 ; reste lisible dans les anciennes recherches.
export type SearchBatch = "focused" | "broad";
export type ActorRequest = { batch: SearchBatch; path: string; input: string; source?: "leboncoin" | "pap" | "seloger" };

// Un seul mot-clé par recherche : le premier équipement explicite, sinon un type de logement. Quand le type est un
// critère à part (maison ou appartement), il passe par le filtre de type, pas par le texte : « maison » en mot-clé
// ferait perdre « pavillon », « villa », « longère ».
export function focusedSearchTerm(criteria: Criteria): string | null {
  for (const wish of criteria.wishes ?? []) {
    const match = wish.match(/\b(parking|stationnement|garage|meubl[ée]|balcon|jardin|terrasse|ascenseur)\b/i);
    if (match) return match[0].toLocaleLowerCase("fr");
  }
  const kinds = criteria.propertyType ? /\b(studio|duplex|loft|chambre)\b/i : /\b(appartement|maison|studio|duplex|loft|chambre)\b/i;
  return criteria.keywords.match(kinds)?.[0]?.toLocaleLowerCase("fr") ?? null;
}

// The app only searches rentals. The actor's documented category 10 is locations;
// category 11 (colocations) is also a rental in older saved searches.
export function isHousingListingUrl(value: string) {
  return isLeboncoinRentalUrl(value) || extraSourceOf(value) !== null;
}

export function isLeboncoinRentalUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)leboncoin\.fr$/i.test(url.hostname)) return false;
    const parts = url.pathname.toLowerCase().split("/").filter(Boolean);
    const category = parts[0] === "ad" ? parts[1] : parts[0];
    return category === "locations" || category === "colocations";
  } catch {
    return false;
  }
}

export type Zone = { lat: number; lon: number; radiusKm: number };

const MAX_RADIUS_KM = 200;
const clampRadius = (km: number) => Math.max(1, Math.min(MAX_RADIUS_KM, km));

/**
 * Zone lue chez Le Bon Coin. Par défaut, la commune et son rayon. Lieu cité retrouvé :
 *  - recherche centrée (« autour de l'aéroport ») : un cercle autour du lieu (sa distance, sinon le rayon demandé) ;
 *  - sinon (« à Rennes, à moins de 30 min de l'aéroport »), la ville ET le lieu sont deux contraintes : un logement
 *    qui les respecte est dans les deux cercles, donc dans le plus petit, lu en entier ; l'autre contrainte est
 *    vérifiée sur chaque annonce.
 */
export function searchZone(criteria: Criteria, commune: { lat: number; lon: number }): Zone {
  const city: Zone = { lat: commune.lat, lon: commune.lon, radiusKm: clampRadius(criteria.radius ?? 5) };
  const located = (criteria.places ?? []).filter(place => place.lat != null && place.lng != null);
  const around = located.find(place => place.centered);
  if (around) return { lat: around.lat!, lon: around.lng!, radiusKm: clampRadius(placeReachKm(around) ?? criteria.radius ?? 5) };
  return located.filter(hasDistanceLimit).reduce<Zone>((best, place) => {
    const radiusKm = clampRadius(placeReachKm(place)!);
    return radiusKm < best.radiusKm ? { lat: place.lat!, lon: place.lng!, radiusKm } : best;
  }, city);
}

const bound = (min: number | null | undefined, max: number | null | undefined) =>
  min == null && max == null ? null : `${min ?? "min"}-${max ?? "max"}`;

/**
 * URL de recherche Le Bon Coin : seule façon de demander « appartement ou maison » et une fourchette de pièces à
 * l'acteur (ses champs manuels n'ont ni l'un ni l'autre). La ville doit être reconnue sans ambiguïté : ses
 * coordonnées et son code postal viennent de la base des communes (sans coordonnées, l'acteur cherche dans toute
 * la France). Sinon null : on garde la requête par champs.
 */
export function leboncoinSearchUrl(criteria: Criteria, term: string | null): string | null {
  const place = resolvePlace(criteria.location);
  if (place.status !== "resolved") return null;
  const { lat, lon, radiusKm } = searchZone(criteria, place.commune);
  // Le site lit d'abord la commune nommée : la zone recentrée ailleurs porte le nom de sa propre commune.
  const { name, postalCodes } = lat === place.commune.lat && lon === place.commune.lon ? place.commune : nearestCommune(lat, lon);
  const radiusMeters = Math.round(radiusKm * 1000);
  const params = new URLSearchParams({
    category: "10",
    // Format du site : Nom_CP__lat_lng_rayonDeLaVille_rayonChoisi. Avec un seul nombre (essai réel du 06/10/2026), le
    // rayon était ignoré (seule la commune ressortait) et les noms à trait d'union (Aix-en-Provence) ne donnaient rien.
    locations: `${name}_${postalCodes[0] ?? ""}__${lat.toFixed(5)}_${lon.toFixed(5)}_${radiusMeters}_${radiusMeters}`,
    real_estate_type: realEstateTypes(criteria.propertyType),
  });
  const ranges = { rooms: bound(queryMinRooms(criteria), criteria.maxRooms), square: bound(criteria.minArea, criteria.maxArea), price: bound(criteria.minPrice, criteria.maxPrice) };
  for (const [key, value] of Object.entries(ranges)) if (value) params.set(key, value);
  if (term) params.set("text", term);
  return `https://www.leboncoin.fr/recherche?${params}`;
}

/** Acteurs Le Bon Coin : `fatihtahta` (0,001 $ l'annonce, sans frais de démarrage) lit une URL de recherche ;
 * `clearpath` (0,009 $ par run + 0,0015 $ l'annonce) sert de secours quand la ville n'est pas reconnue, car il sait
 * chercher un lieu par son nom. */
export const LEBONCOIN_ACTORS = { url: "fatihtahta~leboncoin-fr-scraper", byName: "clearpath~leboncoin-api" } as const;

/**
 * `page` : page de résultats Le Bon Coin (35 annonces, des plus récemment mises à jour aux plus anciennes). L'acteur
 * repart toujours du haut de la page demandée : c'est la seule façon de lire plus loin sans repayer le début.
 * Le secours `clearpath` (ville non reconnue) ne sait pas lire une page précise : une seule lecture.
 */
export function housingActorInput(criteria: Criteria, adLimit = 10, page = 1): { actor: string; input: Record<string, unknown> } {
  // Même sans URL, la recherche reste limitée aux locations, au lieu, au rayon et au budget.
  const term = focusedSearchTerm(criteria);
  const searchUrl = leboncoinSearchUrl(criteria, term);
  if (searchUrl) return { actor: LEBONCOIN_ACTORS.url, input: { startUrls: [page > 1 ? `${searchUrl}&page=${page}` : searchUrl], limit: adLimit } };
  return {
    actor: LEBONCOIN_ACTORS.byName,
    input: {
      ...(term ? { searchQuery: term } : {}),
      category: "10",
      location: criteria.location,
      radius: Math.max(0, Math.min(200, criteria.radius ?? 5)),
      ...(criteria.minPrice != null ? { price_min_filter: criteria.minPrice } : {}),
      ...(criteria.maxPrice != null ? { price_max_filter: criteria.maxPrice } : {}),
      adLimit: Math.max(10, adLimit), // minimum imposé par clearpath
      mode: "standard",
      includeSeller: false,
      includePhone: false,
      shippable: false,
    },
  };
}

/** Une page de résultats peut-elle être demandée (acteur à URL) ? */
export const canReadPages = (criteria: Criteria) => housingActorInput(criteria).actor === LEBONCOIN_ACTORS.url;

export function actorRequest(criteria: Criteria, candidateLimit: number, chargeCap: string, timeout: number, page = 1): ActorRequest {
  const { actor, input } = housingActorInput(criteria, candidateLimit, page);
  return {
    batch: "focused",
    path: `/v2/acts/${actor}/runs?maxItems=${candidateLimit}&maxTotalChargeUsd=${chargeCap}&timeout=${timeout}`,
    input: JSON.stringify(input),
  };
}
