/** Annonce au format de l'acteur Le Bon Coin `fatihtahta` (record « property_listing »), pour les faux serveurs Apify. */
export function fatihRecord(ad: {
  url: string; title: string; description: string; price: number; area?: number; rooms?: number;
  realEstateType?: "1" | "2" | "4" | "5"; city?: string; lat?: number; lng?: number; type?: string; dealType?: string; images?: string[];
}) {
  const labels = { "1": "Maison", "2": "Appartement", "4": "Parking", "5": "Autre" } as const;
  const type = ad.realEstateType ?? "2";
  return {
    record_type: "property_listing", id: ad.url.split("/").pop(), url: ad.url, title: ad.title, description: ad.description,
    listing: JSON.stringify({ deal_type: ad.dealType ?? "rent", listing_type: "apartment" }),
    property: JSON.stringify({ surface_m2: ad.area ?? null, rooms: ad.rooms ?? null }),
    pricing: { amount_eur: ad.price, billing_period: "month" },
    media: JSON.stringify({ images: { count: ad.images?.length ?? 0, urls: ad.images ?? [] } }),
    source_data: JSON.stringify({
      attributes: [{ key: "real_estate_type", value: type, value_label: labels[type] }, ...(ad.rooms != null ? [{ key: "rooms", value: String(ad.rooms) }] : [])],
      location: { city: ad.city ?? "Lille", lat: ad.lat ?? null, lng: ad.lng ?? null, type: ad.type ?? "city" },
    }),
  };
}
