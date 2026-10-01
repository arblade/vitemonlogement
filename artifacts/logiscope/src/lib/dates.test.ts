import { describe, expect, it } from 'vitest';
import { ago, at, hoursLabel, nextPass } from '@/lib/dates';

const now = Date.parse('2026-10-01T16:00:00Z'); // 18 h à Paris

describe('Dates lisibles', () => {
  it('« il y a… » puis la date', () => {
    expect(ago('2026-10-01T15:56:00Z', now)).toBe('il y a 4 min');
    expect(ago('2026-10-01T13:00:00Z', now)).toBe('il y a 3 h');
    expect(ago('2026-09-30T19:00:00Z', now)).toBe('hier');
    expect(ago('2026-09-28T10:00:00Z', now)).toBe('il y a 3 jours');
    expect(ago('2026-09-14T10:00:00Z', now)).toBe('le 14 sept.');
    expect(ago(null, now)).toBeNull();
  });
  it('prochain passage, à l’heure de Paris', () => {
    expect(nextPass('2026-10-01T16:30:00Z', now)).toBe('aujourd’hui à 18:30');
    expect(nextPass('2026-10-02T06:00:00Z', now)).toBe('demain à 08:00');
  });
  it('créneaux en mots', () => {
    expect(hoursLabel(['08:00', '18:00'])).toBe('8 h et 18 h');
    expect(hoursLabel(['07:30'])).toBe('7 h 30');
  });
  it('moment passé de la relève', () => {
    expect(at('2026-10-01T06:00:00Z', now)).toBe('aujourd’hui à 08:00');
    expect(at('2026-09-30T16:00:00Z', now)).toBe('hier à 18:00');
    expect(at('2026-09-14T06:00:00Z', now)).toBe('le 14 sept. à 08:00');
  });
});
