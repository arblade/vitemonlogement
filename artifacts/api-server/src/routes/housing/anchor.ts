import { geocodeLandmark, locatePlaces } from "../../lib/geocode";
import { hasDistanceLimit } from "../../lib/distance";
import { canonicalLocation, normalize } from "../../lib/places";
import { withPlaceChecks } from "./criteria";
import type { Criteria, Place } from "./store";

const isLandmark = (place: Place) => place.centered === true || hasDistanceLimit(place);
const has = (text: string, phrase: string) => phrase.length > 0 && ` ${text} `.includes(` ${phrase} `);
const LANDMARK_WORDS = "aeroports?|aerogares?|gares?|chu|hopitals?|universites?|campus";

/**
 * La ville recherchée n'est-elle citée que DANS le nom du lieu repère ? « une maison à moins de 30 min de l'aéroport de
 * Rennes » : « Rennes » nomme l'aéroport, ce n'est pas une contrainte de plus (le LLM met pourtant location = Rennes, et
 * la recherche restait alors dans les 5 km autour de Rennes, sans Bruz ni Chavagne). « À Rennes, à moins de 30 min de
 * l'aéroport (de Rennes) » cite la ville à part : on n'y touche pas.
 */
export function cityOnlyNamesPlace(prompt: string, city: string, place: Pick<Place, "address">): boolean {
  const town = normalize(city);
  if (!town || !has(normalize(place.address), town)) return false;
  const rest = normalize(prompt).replace(normalize(place.address), " ")
    .replace(new RegExp(`\\b(?:${LANDMARK_WORDS})(?: (?:de|du|d|la|l))* ${town}\\b`, "g"), " ");
  return !has(rest, town);
}

/**
 * Lieux cités, une fois la demande interprétée : géocodage, puis ville et centre de la recherche. Deux cas où le lieu
 * repère devient le centre de la recherche (`centered`) :
 *  - aucune ville comprise (2 interprétations sur 3 de « …de l'aéroport de Rennes » le 05/10) : la ville du lieu la
 *    remplace, au lieu d'un échec « Indiquez une ville » ;
 *  - la ville n'est citée que dans le nom du lieu (voir cityOnlyNamesPlace).
 * Une demande avec sa propre ville garde la double contrainte (ville ET lieu). Rien de trouvé : critères inchangés.
 */
export async function placeCriteria(prompt: string, criteria: Criteria, fetcher: typeof fetch = fetch): Promise<Criteria> {
  let places = criteria.places ?? [];
  if (!places.length) return criteria;
  let location = criteria.location.trim();
  if (!location) {
    for (const place of places.filter(isLandmark)) {
      const found = await geocodeLandmark(place.address, "", fetcher);
      const city = found?.searchCity ? canonicalLocation(found.searchCity) : "";
      if (!found || !city) continue;
      location = city;
      places = places.map(item => item.id === place.id ? { ...item, centered: true, lat: found.lat, lng: found.lng, resolved: found.label } : { ...item, centered: false });
      break;
    }
    if (!location) return criteria;
  } else if (!places.some(place => place.centered)) {
    const named = places.find(place => isLandmark(place) && cityOnlyNamesPlace(prompt, location, place));
    if (named) places = places.map(place => place.id === named.id ? { ...place, centered: true } : place);
  }
  const pending = places.filter(place => place.lat == null || place.lng == null);
  const located = pending.length ? await locatePlaces(pending, location, fetcher) : [];
  places = places.map(place => located.find(item => item.id === place.id) ?? place);
  return withPlaceChecks({ ...criteria, location, places });
}
