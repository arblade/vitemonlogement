// Heure de Paris, été comme hiver, sans dépendance : Le Bon Coin donne ses dates à l'heure de Paris (étiquetées « Z »
// à tort, mesuré le 01/10/2026) et la recherche suivie passe à 8 h et 18 h, heure de Paris.

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Heure de Paris d'un instant. */
export function parisClock(ms: number) {
  const values = Object.fromEntries(parts.formatToParts(new Date(ms)).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

/** Instant (ms UTC) d'une heure de Paris donnée ; gère le passage à l'heure d'été et d'hiver. */
export function fromParis(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wanted;
  for (let i = 0; i < 2; i++) { // deux passes suffisent, y compris autour du changement d'heure
    const seen = parisClock(guess);
    guess += wanted - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  }
  return guess;
}

/**
 * Date Le Bon Coin (« 2026-10-01T20:49:09.000Z » ou « 2026-10-01 20:49:09 ») lue comme une heure de Paris.
 * null si absente ou illisible.
 */
export function leboncoinDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return fromParis(y, mo, d, h, mi, s || 0);
}

/** Créneau « HH:MM » valide. */
export const isClockTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Prochain passage strictement après `after`, parmi des heures de Paris (« 08:00 », « 18:00 »). */
export function nextParisTime(times: readonly string[], after: number): number | null {
  const valid = times.filter(isClockTime);
  if (!valid.length) return null;
  const today = parisClock(after);
  let best: number | null = null;
  for (let dayOffset = 0; dayOffset <= 1 && best === null; dayOffset++) {
    // Jour de Paris suivant : midi du jour + 24 h, relu à l'heure de Paris (évite les décalages au changement d'heure).
    const noon = fromParis(today.year, today.month, today.day, 12) + dayOffset * 86_400_000;
    const day = parisClock(noon);
    for (const time of valid) {
      const [hour, minute] = time.split(":").map(Number);
      const at = fromParis(day.year, day.month, day.day, hour, minute);
      if (at > after && (best === null || at < best)) best = at;
    }
  }
  return best;
}
