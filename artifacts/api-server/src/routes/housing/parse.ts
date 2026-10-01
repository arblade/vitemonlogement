// Lecture tolérante des données renvoyées par les acteurs Apify (champs absents, types variables).

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function first(item: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key];
  }
  return null;
}

export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function number(value: unknown): number | null {
  if (Array.isArray(value)) return number(value[0]);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (value && typeof value === "object") return number(first(object(value), ["value", "amount"]));
  return null;
}

export function getImages(value: unknown): string[] {
  const image = object(value);
  // clearpath/leboncoin-api supplies images as an object containing urls_large
  // and urls, not as an array. Prefer full-size photos over thumbnails.
  const candidates = [
    image.urls_large, image.urls, image.urls_thumb, image.classifications,
    image.small_url, image.thumb_url, value,
  ];
  for (const source of candidates) {
    const values = Array.isArray(source) ? source : [source];
    const urls = values.map(item => typeof item === "string" ? item
      : text(first(object(item), ["url", "imageUrl", "large", "medium", "thumb_url"])))
      .filter(url => {
        try { return new URL(url).protocol === "https:"; } catch { return false; }
      });
    if (urls.length) return [...new Set(urls)].slice(0, 12);
  }
  return [];
}
