import type { CriterionResult, Place, TravelMode } from "../routes/housing/store";

/** Distance à vol d'oiseau en kilomètres (haversine). */
export function airKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Durée estimée sans service de routage : un trajet réel est plus long que la ligne droite (détour) et se fait à une
// vitesse moyenne tous embouteillages et feux compris. Valeurs prudentes ; la clé Google donne la vraie durée.
const DETOUR = 1.3;
const SPEED_KMH: Record<TravelMode, number> = { drive: 45, transit: 25, bike: 15, walk: 4.5 };
const MODE_LABEL: Record<TravelMode, string> = { drive: "en voiture", transit: "en transports", bike: "à vélo", walk: "à pied" };
/** Une position de quartier ou de commune n'est connue qu'à ~2 km près. */
const IMPRECISE_KM = 2;
/** Entre ces deux marges autour de la durée demandée, l'estimation ne tranche pas : « À vérifier ». */
const SURE_BELOW = 0.8;
const SURE_ABOVE = 1.25;

export const placeMode = (place: Pick<Place, "mode">): TravelMode => place.mode ?? "drive";

/** Durée estimée (minutes) d'un trajet dont la ligne droite fait `km`. */
export const estimateMinutes = (km: number, mode: TravelMode) => km * DETOUR / SPEED_KMH[mode] * 60;

/** Rayon à vol d'oiseau (km) qui contient tout ce qui est à moins de `minutes` de trajet : sert à borner la recherche. */
export const reachKm = (minutes: number, mode: TravelMode) => minutes / 60 * SPEED_KMH[mode] / DETOUR;

/** Rayon de recherche (km) autour d'un lieu d'après ses contraintes ; null : le lieu n'en a pas. */
export function placeReachKm(place: Pick<Place, "maxKm" | "maxMinutes" | "mode">): number | null {
  const bounds = [place.maxKm, place.maxMinutes != null ? reachKm(place.maxMinutes, placeMode(place)) : null].filter((value): value is number => value != null && value > 0);
  return bounds.length ? Math.min(...bounds) : null;
}

export const hasDistanceLimit = (place: Pick<Place, "maxKm" | "maxMinutes">) => place.maxKm != null || place.maxMinutes != null;

const minutesLabel = (minutes: number) => `${Math.round(minutes)} min`;
const kmLabel = (km: number) => `${km.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;

/** Libellé du critère : « À moins de 30 min en voiture et 10 km de Aéroport de Rennes ». */
export function placeCheckLabel(place: Pick<Place, "label" | "maxKm" | "maxMinutes" | "mode">): string {
  const limits = [
    place.maxMinutes != null ? `${minutesLabel(place.maxMinutes)} ${MODE_LABEL[placeMode(place)]}` : null,
    place.maxKm != null ? `${kmLabel(place.maxKm)} à vol d'oiseau` : null,
  ].filter(Boolean).join(" et ");
  return `À moins de ${limits} · ${place.label}`;
}

type Position = { lat?: number | null; lng?: number | null; geoPrecision?: string | null };

/**
 * Distance d'une annonce à un lieu cité. Jamais d'invention : sans position, ou quand l'estimation tombe près de la
 * limite, la réponse est « À vérifier ». Distance en km : ligne droite, qui ne peut que sous-estimer le trajet, donc
 * « trop loin » est sûr. Durée : estimée (détour et vitesse moyenne), tranchée seulement loin de la limite.
 */
export function evaluatePlace(id: string, label: string, place: Place, listing: Position): CriterionResult {
  const unknown: CriterionResult = { id, label, status: "unknown", source: "unknown", value: "", evidence: "" };
  if (place.lat == null || place.lng == null || listing.lat == null || listing.lng == null) return unknown;
  const km = airKm({ lat: listing.lat, lng: listing.lng }, { lat: place.lat, lng: place.lng });
  const precise = listing.geoPrecision === "streetNumber" || listing.geoPrecision === "street";
  const slack = precise ? 0 : IMPRECISE_KM;
  const near = Math.max(0, km - slack), far = km + slack;
  const mode = placeMode(place);
  const verdicts: CriterionResult["status"][] = [];
  if (place.maxKm != null) verdicts.push(far <= place.maxKm ? "confirmed" : near > place.maxKm ? "contradicted" : "unknown");
  if (place.maxMinutes != null) {
    verdicts.push(estimateMinutes(far, mode) <= place.maxMinutes * SURE_BELOW ? "confirmed"
      : estimateMinutes(near, mode) > place.maxMinutes * SURE_ABOVE ? "contradicted" : "unknown");
  }
  if (!verdicts.length) return unknown;
  const status = verdicts.includes("contradicted") ? "contradicted" : verdicts.every(verdict => verdict === "confirmed") ? "confirmed" : "unknown";
  const target = place.resolved || place.address;
  const estimate = place.maxMinutes != null ? ` · ≈ ${minutesLabel(estimateMinutes(km, mode))} ${MODE_LABEL[mode]}` : "";
  return {
    id, label, status, source: "api", value: `${kmLabel(km)} à vol d'oiseau${estimate}`,
    evidence: `Distance calculée entre ${precise ? "l'adresse de l'annonce" : "la zone de l'annonce (position approximative)"} et « ${target} » : ${kmLabel(km)} à vol d'oiseau`
      + (place.maxMinutes != null ? `, soit une durée estimée à ≈ ${minutesLabel(estimateMinutes(km, mode))} ${MODE_LABEL[mode]} (estimation, sans trafic réel).` : "."),
  };
}
