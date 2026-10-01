/** Annonce au format de l'acteur Le Bon Coin `fatihtahta` (record « property_listing »), pour les faux serveurs Apify. */
export function fatihRecord(ad: {
  url: string; title: string; description: string; price: number; area?: number; rooms?: number;
  realEstateType?: "1" | "2" | "4" | "5"; city?: string; zipcode?: string; lat?: number; lng?: number; type?: string; dealType?: string; images?: string[];
  /** Dates telles que Le Bon Coin les donne : heure de Paris étiquetée « Z » (« 2026-10-01T20:49:09.000Z »). */
  postedAt?: string; updatedAt?: string;
}) {
  const labels = { "1": "Maison", "2": "Appartement", "4": "Parking", "5": "Autre" } as const;
  const type = ad.realEstateType ?? "2";
  return {
    record_type: "property_listing", id: ad.url.split("/").pop(), url: ad.url, title: ad.title, description: ad.description,
    listing: JSON.stringify({ deal_type: ad.dealType ?? "rent", listing_type: "apartment", posted_at: ad.postedAt, updated_at: ad.updatedAt ?? ad.postedAt }),
    property: JSON.stringify({ surface_m2: ad.area ?? null, rooms: ad.rooms ?? null }),
    pricing: { amount_eur: ad.price, billing_period: "month" },
    media: JSON.stringify({ images: { count: ad.images?.length ?? 0, urls: ad.images ?? [] } }),
    source_data: JSON.stringify({
      attributes: [{ key: "real_estate_type", value: type, value_label: labels[type] }, ...(ad.rooms != null ? [{ key: "rooms", value: String(ad.rooms) }] : [])],
      location: { city: ad.city ?? "Lille", zipcode: ad.zipcode ?? null, lat: ad.lat ?? null, lng: ad.lng ?? null, type: ad.type ?? "city" },
    }),
  };
}

/** Instant (ms) écrit comme Le Bon Coin l'écrit : heure de Paris suivie d'un « Z » trompeur. */
export function leboncoinLabel(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ms)).reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`;
}
