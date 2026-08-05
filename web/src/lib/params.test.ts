import { describe, expect, it } from 'vitest';
import { parseMinTogether } from './params';

const ALLOWED = [1, 2, 3, 5, 10];

describe('parseMinTogether', () => {
  it('accepts a value that matches a preset', () => {
    for (const n of ALLOWED) expect(parseMinTogether(String(n), ALLOWED)).toBe(n);
  });

  it('rejects a number with no matching preset', () => {
    // The control is a segmented group; 7 has no button, so honouring it would
    // filter the graph with nothing on screen showing that it had happened.
    expect(parseMinTogether('7', ALLOWED)).toBeNull();
    expect(parseMinTogether('4', ALLOWED)).toBeNull();
    expect(parseMinTogether('999', ALLOWED)).toBeNull();
  });

  it('rejects zero and negatives, which would mean "no threshold at all"', () => {
    expect(parseMinTogether('0', ALLOWED)).toBeNull();
    expect(parseMinTogether('-3', ALLOWED)).toBeNull();
  });

  it('rejects a missing or blank parameter', () => {
    expect(parseMinTogether(null, ALLOWED)).toBeNull();
    expect(parseMinTogether('', ALLOWED)).toBeNull();
    expect(parseMinTogether('   ', ALLOWED)).toBeNull();
  });

  it('rejects junk rather than coercing it', () => {
    for (const bad of ['abc', '2abc', 'NaN', 'Infinity', '[]', 'null']) {
      expect(parseMinTogether(bad, ALLOWED)).toBeNull();
    }
  });

  it('rejects a non-integer that sits between presets', () => {
    expect(parseMinTogether('2.5', ALLOWED)).toBeNull();
    // Number('2.0') === 2, which is a real preset — accepting it is correct.
    expect(parseMinTogether('2.0', ALLOWED)).toBe(2);
  });
});
