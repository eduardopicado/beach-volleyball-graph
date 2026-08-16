import { describe, expect, it } from 'vitest';
import { seasonEvents } from './results';
import type { ResultEntry, TournamentMeta } from '../schema';

const tournaments: Record<string, TournamentMeta> = {
  '1': ['Doha', 2024, 'beach-pro-tour', 65],
  '2': ['Paris', 2024, 'olympics', 209],
  '3': ['Gstaad', 2023, 'world-tour', 190],
  // No offset: a tournament whose date VIS could not parse.
  '4': ['Undated', 2024, 'beach-pro-tour'],
};

const entries: ResultEntry[] = [
  [2, 20, 1],
  [1, 20, 9],
  [4, 21, -2],
  [3, 20, 5],
];

const nameOf = (id: number) => ({ 20: 'Partner Twenty', 21: 'Partner Ttwenty-one' })[id] ?? null;

describe('seasonEvents', () => {
  it('keeps only the requested season', () => {
    expect(seasonEvents(entries, tournaments, 2023, nameOf).map((e) => e.name)).toEqual(['Gstaad']);
  });

  it('keeps the published order rather than re-sorting', () => {
    // The ingest already ordered these newest first; re-deriving it here would
    // be a second implementation of the same rule, free to disagree.
    expect(seasonEvents(entries, tournaments, 2024, nameOf).map((e) => e.no)).toEqual([2, 1, 4]);
  });

  it('reconstructs the date from the season and the offset', () => {
    const [paris] = seasonEvents(entries, tournaments, 2024, nameOf);
    expect(paris!.date?.toISOString().slice(0, 10)).toBe('2024-07-28');
  });

  it('leaves the date null when the tournament carried none', () => {
    const undated = seasonEvents(entries, tournaments, 2024, nameOf).find((e) => e.no === 4);
    expect(undated!.date).toBeNull();
  });

  it('handles a negative offset, which belongs to the season before its own year', () => {
    const early: Record<string, TournamentMeta> = { '9': ['Sydney', 2024, 'world-tour', -12] };
    const [event] = seasonEvents([[9, 20, 3]], early, 2024, nameOf);
    expect(event!.date?.toISOString().slice(0, 10)).toBe('2023-12-20');
  });

  it('carries the partner id even when nothing can name them', () => {
    const [event] = seasonEvents([[1, 99, 5]], tournaments, 2024, () => null);
    expect(event).toMatchObject({ partnerId: 99, partner: null });
  });

  it('drops an entry whose tournament is missing from the index', () => {
    expect(seasonEvents([[404, 20, 1]], tournaments, 2024, nameOf)).toEqual([]);
  });

  it('is empty for a player with no published results', () => {
    expect(seasonEvents(undefined, tournaments, 2024, nameOf)).toEqual([]);
  });
});
