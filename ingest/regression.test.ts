import { describe, expect, it } from 'vitest';
import { checkForRegression } from './regression';

const totals = (tournaments: number, players: number, partnerships: number) => ({
  tournaments,
  players,
  partnerships,
});

describe('checkForRegression', () => {
  it('passes with nothing to compare against — the first ever run', () => {
    expect(checkForRegression(null, totals(2000, 15000, 18000))).toEqual([]);
  });

  it('passes when nothing shrank', () => {
    const previous = totals(2000, 15000, 18000);
    const next = totals(2050, 15200, 18300);
    expect(checkForRegression(previous, next)).toEqual([]);
  });

  it('passes a small, expected shrink within tolerance', () => {
    // Default tolerance is 5%; 2% down on every metric is a normal week.
    const previous = totals(2000, 15000, 18000);
    const next = totals(1960, 14700, 17640);
    expect(checkForRegression(previous, next)).toEqual([]);
  });

  it('flags a metric that shrank past the tolerance', () => {
    const previous = totals(2000, 15000, 18000);
    // Partnerships collapse to a third — a broken fetch, not a correction.
    const next = totals(2000, 15000, 6000);
    const problems = checkForRegression(previous, next);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('partnerships');
    expect(problems[0]).toContain('18,000');
    expect(problems[0]).toContain('6,000');
  });

  it('flags every metric that shrank past the tolerance, not just the first', () => {
    const previous = totals(2000, 15000, 18000);
    const next = totals(100, 500, 600);
    const problems = checkForRegression(previous, next);
    expect(problems).toHaveLength(3);
  });

  it('never flags growth, however large', () => {
    const previous = totals(2000, 15000, 18000);
    const next = totals(4000, 30000, 40000);
    expect(checkForRegression(previous, next)).toEqual([]);
  });

  it('does not divide by a zero baseline', () => {
    const previous = totals(0, 15000, 18000);
    const next = totals(0, 15000, 18000);
    expect(checkForRegression(previous, next)).toEqual([]);
  });

  it('respects a custom tolerance', () => {
    const previous = totals(2000, 15000, 18000);
    const next = totals(2000, 15000, 17500); // ~2.8% down
    expect(checkForRegression(previous, next, 0.05)).toEqual([]);
    expect(checkForRegression(previous, next, 0.01)).toHaveLength(1);
  });
});
