import type { Criteria, Criterion, CriterionResult, Listing } from "./store";

type Basic = Pick<Listing, "price" | "area" | "rooms" | "location">;

function labelForWish(value: string) {
  return value.trim().slice(0, 100);
}

export function classifyWish(label: string): Criterion["apiField"] {
  if (/parking|stationnement|garage/i.test(label)) return "parking";
  if (/meubl[ée]/i.test(label)) return "furnished";
  if (/ascenseur/i.test(label)) return "elevator";
  return null;
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
  for (const [index, wish] of (criteria.wishes ?? []).slice(0, 8).entries()) {
    const label = labelForWish(wish);
    if (!label) continue;
    const apiField = classifyWish(label);
    checks.push({ id: `wish-${index + 1}`, label, availability: apiField ? "hybrid" : "description", apiField });
  }
  return checks;
}

export function matchesKnownBasics(listing: Basic, criteria: Criteria) {
  return !(
    (listing.price != null && ((criteria.minPrice != null && listing.price < criteria.minPrice) || (criteria.maxPrice != null && listing.price > criteria.maxPrice))) ||
    (listing.area != null && ((criteria.minArea != null && listing.area < criteria.minArea) || (criteria.maxArea != null && listing.area > criteria.maxArea))) ||
    (listing.rooms != null && !matchesValue("rooms", listing.rooms, criteria))
  );
}

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
      if (!Number.isFinite(count) || parking == null) return unknown(check);
      return structured(`${count} place(s)`, "nb_parkings", check, count > 0);
    }
    if (check.apiField === "furnished" || check.apiField === "elevator") {
      const key = check.apiField === "furnished" ? "furnished" : "elevator";
      const value = apiValue(raw, key);
      const text = typeof value === "string" ? value.toLocaleLowerCase("fr") : "";
      const positive = value === true || value === 1 || (key === "furnished" ? /^meubl[eé]$|^oui$|^yes$|^true$|^1$/.test(text) : /^oui$|^yes$|^true$|^1$/.test(text));
      const negative = value === false || value === 0 || (key === "furnished" ? /^non[\s-]*meubl[eé]$|^non$|^no$|^false$|^0$/.test(text) : /^non$|^no$|^false$|^0$/.test(text));
      if (!positive && !negative) return unknown(check);
      const wantsNegative = /non[\s-]*meubl[eé]|sans\s+meubl|sans\s+ascenseur/i.test(check.label);
      return structured(positive ? "Oui" : "Non", key, check, wantsNegative ? negative : positive);
    }
    return unknown(check);
  });
}