import type { Criteria } from "./store";

// The app only searches rentals. The actor's documented category 10 is locations;
// category 11 (colocations) is also a rental in older saved searches.
export function isHousingListingUrl(value: string) {
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

export function housingActorInput(criteria: Criteria) {
  // Wishes (parking, balcony, garden...) are checked AFTER collecting homes,
  // never used as free-text search terms across all of Leboncoin.
  const housingTerm = criteria.keywords.match(/\b(appartement|maison|studio|duplex|loft|chambre)\b/i)?.[0];
  return {
    ...(housingTerm ? { searchQuery: housingTerm.toLocaleLowerCase("fr") } : {}),
    category: "10",
    location: criteria.location,
    radius: Math.max(0, Math.min(200, criteria.radius ?? 5)),
    ...(criteria.minPrice != null ? { price_min_filter: criteria.minPrice } : {}),
    ...(criteria.maxPrice != null ? { price_max_filter: criteria.maxPrice } : {}),
    adLimit: 10,
    mode: "standard",
    includeSeller: false,
    includePhone: false,
    shippable: false,
  };
}