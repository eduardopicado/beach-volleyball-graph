import { describe, expect, it } from 'vitest';
import { decodeEntities, extractRows, toCentimetres, toKilograms } from './vis.js';

describe('extractRows', () => {
  const body = `<?xml version="1.0"?><Responses><Players NbItems="2" Version="9">` +
    `<Player No="1" FirstName="Anders" LastName="M&#248;l" Height="1930000"/>` +
    `<Player No="2" FirstName="Bar&amp;bara" LastName="Seix&#xE1;s" Height=""/>` +
    `</Players></Responses>`;

  it('reads every attribute of every item', () => {
    const rows = extractRows(body, 'Player');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ No: '1', FirstName: 'Anders', LastName: 'Møl', Height: '1930000' });
  });

  it('decodes named, decimal and hex entities', () => {
    const rows = extractRows(body, 'Player');
    expect(rows[1]!.FirstName).toBe('Bar&bara');
    expect(rows[1]!.LastName).toBe('Seixás');
  });

  it('does not match a tag that merely starts with the item name', () => {
    const mixed = `<PlayerRanking No="9"/><Player No="1"/>`;
    expect(extractRows(mixed, 'Player').map((r) => r.No)).toEqual(['1']);
  });

  it('stops attribute scanning at the end of each element', () => {
    const two = `<Team A="1"/><Other Z="9"/><Team A="2"/>`;
    const rows = extractRows(two, 'Team');
    expect(rows).toEqual([{ A: '1' }, { A: '2' }]);
  });

  it('surfaces a VIS error document instead of returning nothing', () => {
    const err = `<Responses><BadParameter id="1002">Type</BadParameter></Responses>`;
    expect(() => extractRows(err, 'Player')).toThrow(/VIS error/);
  });

  it('returns an empty list for a well-formed but empty response', () => {
    expect(extractRows(`<Responses><Players NbItems="0"/></Responses>`, 'Player')).toEqual([]);
  });
});

describe('decodeEntities', () => {
  it('leaves unknown entities untouched rather than corrupting the value', () => {
    expect(decodeEntities('a &nosuch; b')).toBe('a &nosuch; b');
  });
  it('is a no-op on plain text', () => {
    expect(decodeEntities('Kristoffer Hoidalen')).toBe('Kristoffer Hoidalen');
  });
});

describe('unit conversion', () => {
  it('converts VIS height to centimetres', () => {
    expect(toCentimetres('1930000')).toBe(193);
    expect(toCentimetres('1680000')).toBe(168);
  });
  it('rejects blank, zero and out-of-range heights', () => {
    for (const raw of ['', undefined, '0', '-1', '9990000', '10000']) {
      expect(toCentimetres(raw)).toBeNull();
    }
  });
  it('converts VIS weight to kilograms', () => {
    expect(toKilograms('85000000')).toBe(85);
    expect(toKilograms('')).toBeNull();
    expect(toKilograms('1000000000')).toBeNull();
  });
});
