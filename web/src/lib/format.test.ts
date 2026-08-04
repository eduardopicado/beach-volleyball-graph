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

  it('builds a subdivision flag for the UK home nations, which have no ISO code', () => {
    // FIVB carries these with CountryCode "GB" (England/Scotland/N.Ireland,
    // ambiguous — three federations, one code) or the non-ISO "04" (Wales),
    // so iso2 alone can never distinguish them; the federation code can.
    const wales = flagEmoji(null, 'WAL');
    expect(wales).not.toBe('');
    expect(wales.codePointAt(0)).toBe(0x1f3f4); // waving black flag
    expect([...wales]).toHaveLength(7); // flag + 5 tag chars + cancel tag

    // Each home nation's sequence must be distinct, or they'd render identically.
    const england = flagEmoji('GB', 'ENG');
    const scotland = flagEmoji('GB', 'SCO');
    expect(new Set([wales, england, scotland]).size).toBe(3);
  });

  it('falls back to the plain UK flag for Northern Ireland — no distinct Unicode sequence exists', () => {
    // No override for NIR, so this falls through to the iso2 path. GB is a
    // valid (if ambiguous) code, so this is the UK flag, not nothing.
    expect(flagEmoji('GB', 'NIR')).toBe('🇬🇧');
  });

  it('a plain federation code with a real ISO code is unaffected', () => {
    expect(flagEmoji('BR', 'BRA')).toBe('🇧🇷');
  });

  it('aliases the withdrawn Netherlands Antilles code to Curaçao, lowercase included', () => {
    // FIVB still carries some federation records with the withdrawn "AN" code.
    // A raw regional-indicator pair for it is unassigned and commonly renders
    // as two separate boxed letters rather than one flag glyph — which reads
    // as the country appearing twice in a flag-prefixed list.
    expect(flagEmoji('AN')).toBe(flagEmoji('CW'));
    expect(flagEmoji('an')).toBe(flagEmoji('CW'));
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
