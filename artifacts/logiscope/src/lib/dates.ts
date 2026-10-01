// Dates lisibles d'un coup d'œil : « il y a 3 h », « hier à 18:42 », « le 14 sept. ».
const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });

/** Écart en jours calendaires (heure de Paris) entre deux instants. */
function daysBetween(from: number, to: number) {
  return Math.round((Date.parse(dayKey.format(to)) - Date.parse(dayKey.format(from))) / 86_400_000);
}

/** « il y a 5 min », « il y a 3 h », « hier », « il y a 3 jours », puis « le 14 sept. ». */
export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const days = daysBetween(at, now);
  if (days === 0) return `il y a ${Math.round(minutes / 60)} h`;
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return `le ${day.format(at)}`;
}

/** Prochain passage : « aujourd’hui à 18:00 », « demain à 08:00 ». */
export function nextPass(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const days = daysBetween(now, at);
  const when = days <= 0 ? 'aujourd’hui' : days === 1 ? 'demain' : `le ${day.format(at)}`;
  return `${when} à ${time.format(at)}`;
}

/** « 8 h et 18 h » à partir de [« 08:00 », « 18:00 »]. */
export function hoursLabel(times: string[]) {
  const label = (value: string) => { const [h, m] = value.split(':').map(Number); return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`; };
  return times.map(label).join(' et ');
}
