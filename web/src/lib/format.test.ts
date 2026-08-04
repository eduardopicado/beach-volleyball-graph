import { describe, expect, it } from 'vitest';
import { age, flagEmoji, formatDate, initials, plural, seasonSpan } from './format';

describe('flagEmoji', () => {
  it('maps an ISO-2 code to regional indicators', () => {
    expect(flagEmoji('BR')).toBe('🇧🇷');
    expect(flagEmoji('no')).toBe('🇳🇴');
  });
  it('returns empty for anything that is not a two-letter code', () => {
    for (const bad of [null, undefined, '', 'BRA', 'B1']) expect(flagEmoji(bad)).toBe('');
  });
});

describe('age', () => {
  const now = new Date('2026-08-03T00:00:00Z');
  it('counts whole years', () => {
    expect(age('1996-08-02', now)).toBe(30);
    expect(age('1996-08-03', now)).toBe(30);
  });
  it('does not count a birthday that has not happened yet', () => {
    expect(age('1996-08-04', now)).toBe(29);
    expect(age('1996-12-31', now)).toBe(29);
  });
  it('returns null for missing or nonsense dates', () => {
    expect(age(null, now)).toBeNull();
    expect(age('not-a-date', now)).toBeNull();
    expect(age('1800-01-01', now)).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats an ISO date without shifting across time zones', () => {
    expect(formatDate('1973-04-15')).toBe('15 Apr 1973');
  });
  it('falls back to an em dash', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('nope')).toBe('—');
  });
});

describe('seasonSpan', () => {
  it('collapses a single season', () => {
    expect(seasonSpan(2019, 2019)).toBe('2019');
  });
  it('renders a range with an en dash', () => {
    expect(seasonSpan(2002, 2016)).toBe('2002–2016');
  });
});

describe('initials', () => {
  it('takes the first and last initial', () => {
    expect(initials('Emanuel Rego')).toBe('ER');
    expect(initials('Anders Berntsen Mol')).toBe('AM');
  });
  it('handles a single name and blank input', () => {
    expect(initials('Karch')).toBe('K');
    expect(initials('   ')).toBe('?');
  });
});

describe('plural', () => {
  it('switches on count', () => {
    expect(plural(1, 'player')).toBe('1 player');
    expect(plural(2, 'player')).toBe('2 players');
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(0, 'entry', 'entries')).toBe('0 entries');
  });
});
