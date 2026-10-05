import type { Criteria, Criterion, CriterionResult, Listing } from "./store";
import { catalogueFeature, catalogueFor, saysNo, wantsAbsence } from "./catalogue";
import { ENERGY_CLASSES } from "./property-type";

type Basic = Pick<Listing, "price" | "area" | "rooms" | "location">;

function labelForWish(value: string) {
  return value.trim().slice(0, 100);
}

/**
 * Caractéristique du catalogue visée par un souhait (« balcon », « chat accepté »…) : tranchée par Le Bon Coin quand il
 * le dit, sinon par Jev. null : critère « complexe », lu par le LLM.
 */
export function classifyWish(label: string): Criterion["apiField"] {
  return catalogueFor(label)?.id ?? null;
}

const pieces = (count: number) => `${count} pièce${count > 1 ? "s" : ""}`;
function roomsLabel(min: number | null, max: number | null) {
  if (min != null && max != null) return min === max ? pieces(min) : `${min} à ${pieces(max)}`;
  return max != null ? `Au plus ${pieces(max)}` : `Au moins ${pieces(min!)}`;
}

export function checksFor(criteria: Criteria): Criterion[] {
  if (criteria.checks?.length) return criteria.checks;
  const checks: Criterion[] = [];
  if (criteria.location) checks.push({ id: "location", label: `Lieu : ${criteria.location}`, availability: "api", apiField: "location" });
  if (criteria.minPrice != null || criteria.maxPrice != null) checks.push({
    id: "price", label: `Budget : ${criteria.minPrice ?? 0} à ${criteria.maxPrice ?? "sans limite"} €`,
    availability: "api", apiField: "price",
  });
  if (criteria.minArea != null || criteria.maxArea != null) checks.push({
    id: "area", label: `Surface : ${criteria.minArea ?? 0} à ${criteria.maxArea ?? "sans limite"} m²`,
    availability: "api", apiField: "area",
  });
  if (criteria.minRooms != null || criteria.maxRooms != null) checks.push({ id: "rooms", label: roomsLabel(criteria.minRooms ?? null, criteria.maxRooms ?? null), availability: "api", apiField: "rooms" });
  // Chambres et DPE : lus dans les champs du site quand il les donne, sinon dans la description (« hybrid »).
  if (criteria.minBedrooms != null) checks.push({ id: "bedrooms", label: `Au moins ${criteria.minBedrooms} chambre${criteria.minBedrooms > 1 ? "s" : ""}`, availability: "hybrid", apiField: "bedrooms" });
  if (criteria.minEnergyClass != null) checks.push({ id: "energy", label: `DPE ${criteria.minEnergyClass} ou mieux`, availability: "hybrid", apiField: "energy_rate" });
  for (const [index, wish] of (criteria.wishes ?? []).slice(0, 8).entries()) {
    const label = labelForWish(wish);
    if (!label) continue;
    const apiField = classifyWish(label);
    checks.push({ id: `wish-${index + 1}`, label, availability: catalogueFeature(apiField)?.structured ? "hybrid" : "description", apiField });
  }
  return checks;
}

/** Critère du catalogue tranché par un « non » des champs Le Bon Coin : à revérifier dans la description (voir saysNo). */
export const isWeakStructured = (check: CriterionResult) =>
  check.source === "api" && check.id.startsWith("wish-") && Boolean(catalogueFor(check.label)) && saysNo(check.value);

export function matchesKnownBasics(listing: Basic, criteria: Criteria) {
  return !(
    (listing.price != null && ((criteria.minPrice != null && listing.price < criteria.minPrice) || (criteria.maxPrice != null && listing.price > criteria.maxPrice))) ||
    (listing.area != null && ((criteria.minArea != null && listing.area < criteria.minArea) || (criteria.maxArea != null && listing.area > criteria.maxArea))) ||
    (listing.rooms != null && !matchesValue("rooms", listing.rooms, criteria))
  );
}

/**
 * Pièces minimum à demander au site : « 3 chambres » suppose au moins 3 pièces (les chambres en font partie), jamais
 * plus : un filtre à « 4 pièces » perdrait pour toujours une annonce qui compte mal ses pièces. Le vrai tri sur les
 * chambres se fait à la lecture, sur le champ « chambres » de l'annonce.
 */
export const queryMinRooms = (criteria: Pick<Criteria, "minRooms" | "minBedrooms">) => {
  const wanted = Math.max(criteria.minRooms ?? 0, criteria.minBedrooms ?? 0);
  return wanted > 0 ? wanted : null;
};

/** Chambres déclarées par le site : « 3 », « 3 ch. » ; null si absent ou incompréhensible (jamais deviné). */
export function declaredBedrooms(value: unknown): number | null {
  const count = typeof value === "number" ? value : /^\s*(\d{1,2})\s*(?:ch\.?|chambres?)?\s*$/i.exec(String(value ?? ""))?.[1];
  const n = Number(count);
  return count != null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** DPE déclaré : une lettre de A à G ; « N », « vierge », « non communiqué »… → null (on ne sait pas, on garde). */
export function declaredEnergyClass(value: unknown): (typeof ENERGY_CLASSES)[number] | null {
  const letter = String(value ?? "").trim().toUpperCase();
  return (ENERGY_CLASSES as readonly string[]).includes(letter) ? letter as (typeof ENERGY_CLASSES)[number] : null;
}

/**
 * Le site contredit-il une exigence ? Seulement sur ce que l'annonce déclare dans ses champs (chambres, classe DPE) :
 * jamais sur une lecture de texte, jamais quand le champ manque ou n'est pas lisible. Même règle que le prix, la
 * surface et les pièces (voir matchesKnownBasics) : une annonce qui se contredit elle-même sur une exigence est écartée.
 */
export const contradictsDeclared = (listing: { criterionResults: CriterionResult[] }) =>
  listing.criterionResults.some(check => (check.id === "bedrooms" || check.id === "energy") && check.source === "api" && check.status === "contradicted");

export function matchesValue(id: string, value: number, criteria: Criteria): boolean {
  if (id === "price") return (criteria.minPrice == null || value >= criteria.minPrice) && (criteria.maxPrice == null || value <= criteria.maxPrice);
  if (id === "area") return (criteria.minArea == null || value >= criteria.minArea) && (criteria.maxArea == null || value <= criteria.maxArea);
  if (id === "rooms") return (criteria.minRooms == null || value >= criteria.minRooms) && (criteria.maxRooms == null || value <= criteria.maxRooms);
  return false;
}

export function apiValue(raw: Record<string, unknown>, key: string): unknown {
  const direct = raw[key];
  if (direct !== null && direct !== undefined && direct !== "") return direct;
  const attributes = raw.attributes;
  if (!Array.isArray(attributes)) return null;
  const match = attributes.find(attr => attr && typeof attr === "object" && (attr as { key?: unknown }).key === key);
  if (!match) return null;
  const data = match as Record<string, unknown>;
  return data.value ?? data.value_label ?? null;
}

function structured(value: unknown, label: string, check: Criterion, valid: boolean): CriterionResult {
  return {
    id: check.id, label: check.label, status: valid ? "confirmed" : "contradicted",
    source: "api", value: String(value),
    evidence: `Indiqué dans l’annonce : « ${label} ».`,
  };
}

function unknown(check: Criterion): CriterionResult {
  return { id: check.id, label: check.label, status: "unknown", source: "unknown", value: "", evidence: "" };
}

export function evaluateStructured(criteria: Criteria, listing: Basic, raw: Record<string, unknown>): CriterionResult[] {
  return checksFor(criteria).map(check => {
    if (check.id === "price" || check.id === "area" || check.id === "rooms") {
      const value = listing[check.id];
      return value == null ? unknown(check) : structured(value, check.id, check, matchesValue(check.id, value, criteria));
    }
    if (check.id === "bedrooms") {
      const bedrooms = declaredBedrooms(apiValue(raw, "bedrooms") ?? apiValue(raw, "nb_bedrooms"));
      return bedrooms == null ? unknown(check) : structured(`${bedrooms} chambre${bedrooms > 1 ? "s" : ""}`, "chambres", check, bedrooms >= (criteria.minBedrooms ?? 0));
    }
    if (check.id === "energy") {
      const declared = declaredEnergyClass(apiValue(raw, "energy_rate") ?? apiValue(raw, "energy_class"));
      const wanted = criteria.minEnergyClass;
      return declared == null || wanted == null ? unknown(check)
        : structured(`Classe ${declared}`, "classe énergie", check, ENERGY_CLASSES.indexOf(declared) <= ENERGY_CLASSES.indexOf(wanted));
    }
    if (check.id === "location") {
      if (!listing.location) return unknown(check);
      const current = listing.location.toLocaleLowerCase("fr");
      const desired = criteria.location.toLocaleLowerCase("fr");
      return current.includes(desired)
        ? structured(listing.location, "location", check, true)
        : unknown(check); // Nearby towns can be valid inside the requested radius.
    }
    if (check.apiField === "parking") {
      const parking = apiValue(raw, "nb_parkings");
      const count = Number(parking);
      if (Number.isFinite(count) && parking != null) return structured(`${count} place(s)`, "nb_parkings", check, (count > 0) !== wantsAbsence(check.label));
    }
    if (check.apiField === "furnished" || check.apiField === "elevator") {
      const key = check.apiField === "furnished" ? "furnished" : "elevator";
      const value = apiValue(raw, key);
      const text = typeof value === "string" ? value.toLocaleLowerCase("fr") : "";
      const positive = value === true || value === 1 || (key === "furnished" ? /^meubl[eé]$|^oui$|^yes$|^true$|^1$/.test(text) : /^oui$|^yes$|^true$|^1$/.test(text));
      const negative = value === false || value === 0 || (key === "furnished" ? /^non[\s-]*meubl[eé]$|^non$|^no$|^false$|^0$/.test(text) : /^non$|^no$|^false$|^0$/.test(text));
      if (positive || negative) {
        const wantsNegative = /non[\s-]*meubl[eé]|sans\s+meubl|sans\s+ascenseur/i.test(check.label);
        return structured(positive ? "Oui" : "Non", key, check, wantsNegative ? negative : positive);
      }
    }
    // Autres caractéristiques du catalogue : cases « Spécificités », étage, état… seulement quand Le Bon Coin le dit.
    const presence = catalogueFeature(check.apiField)?.structured?.(raw) ?? null;
    if (presence) return structured(presence === "yes" ? "Oui" : "Non", "Spécificités", check, (presence === "yes") !== wantsAbsence(check.label));
    return unknown(check);
  });
}