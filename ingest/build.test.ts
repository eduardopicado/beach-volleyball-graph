import { describe, expect, it } from 'vitest';
import {
  aggregatePartnerships,
  normalisePlayers,
  normaliseTournaments,
  pairKey,
  sliceByCountryAndGender,
} from './build.js';
import type { VisRow } from './vis.js';

const tournament = (no: string, season: number): VisRow => ({
  No: no,
  Season: String(season),
  Type: '52', // Beach Pro Tour Elite16
  OrganizerType: '1', // FIVB
  Version: '1',
});

const player = (no: number, gender: '0' | '1', fed: string): VisRow => ({
  No: String(no),
  FirstName: `First${no}`,
  LastName: `Last${no}`,
  Gender: gender,
  FederationCode: fed,
});

const entry = (tour: string, a: number, b: number): VisRow => ({
  NoTournament: tour,
  NoPlayer1: String(a),
  NoPlayer2: String(b),
});

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey(7, 3)).toBe(pairKey(3, 7));
    expect(pairKey(3, 7)).toBe('3:7');
  });

  it('orders numerically, not lexically', () => {
    // "10" < "9" as strings; the key must not depend on that.
    expect(pairKey(9, 10)).toBe('9:10');
  });
});

describe('normaliseTournaments', () => {
  it('keeps FIVB-organized events on the allowlist', () => {
    const kept = normaliseTournaments([tournament('1', 2024)]);
    expect([...kept.keys()]).toEqual(['1']);
    expect(kept.get('1')!.tier).toBe('beach-pro-tour');
  });

  it('drops confederation and national events', () => {
    const rows: VisRow[] = [
      { ...tournament('2', 2024), OrganizerType: '2' }, // CEV etc.
      { ...tournament('3', 2024), OrganizerType: '5' }, // national federation
      { ...tournament('4', 2024), OrganizerType: '1', Type: '15' }, // FIVB 1-star: kept
      { ...tournament('5', 2024), OrganizerType: '5', Type: '15' }, // national tour: dropped
    ];
    expect([...normaliseTournaments(rows).keys()]).toEqual(['4']);
  });

  it('drops snow volleyball, seminars and multi-sport games', () => {
    const rows = ['36', '35', '44', '50'].map((t, i) => ({
      ...tournament(String(100 + i), 2024),
      Type: t,
    }));
    expect(normaliseTournaments(rows).size).toBe(0);
  });
});

describe('normalisePlayers', () => {
  it('converts VIS units and rejects impossible values', () => {
    const map = normalisePlayers([
      { ...player(1, '0', 'BRA'), Height: '1980000', Weight: '85000000', Birthdate: '1990-05-04' },
      { ...player(2, '1', 'USA'), Height: '', Weight: '', Birthdate: '' },
      { ...player(3, '1', 'GER'), Height: '0', Birthdate: '0001-01-01' },
    ]);
    expect(map.get(1)).toMatchObject({ height: 198, weight: 85, dob: '1990-05-04', gender: 'M' });
    expect(map.get(2)).toMatchObject({ height: null, weight: null, dob: null, gender: 'W' });
    expect(map.get(3)).toMatchObject({ height: null, dob: null });
  });

  it('drops players with no usable gender', () => {
    expect(normalisePlayers([{ ...player(9, '0', 'BRA'), Gender: '' }]).size).toBe(0);
  });
});

describe('aggregatePartnerships', () => {
  const tournaments = normaliseTournaments([
    tournament('t1', 2023),
    tournament('t2', 2024),
    tournament('t3', 2025),
  ]);
  const players = normalisePlayers([
    player(1, '0', 'BRA'),
    player(2, '0', 'BRA'),
    player(3, '0', 'NOR'),
  ]);

  it('weights an edge by distinct tournaments and tracks the season span', () => {
    const { partnerships } = aggregatePartnerships(
      [entry('t1', 1, 2), entry('t2', 2, 1), entry('t3', 1, 2)],
      tournaments,
      players,
    );
    const pair = partnerships.get('1:2')!;
    expect(pair.tournaments.size).toBe(3);
    expect(pair.firstSeason).toBe(2023);
    expect(pair.lastSeason).toBe(2025);
  });

  it('counts a pair once when it appears in both qualification and main draw', () => {
    const { partnerships, rejects } = aggregatePartnerships(
      [entry('t1', 1, 2), entry('t1', 1, 2)],
      tournaments,
      players,
    );
    expect(partnerships.get('1:2')!.tournaments.size).toBe(1);
    expect(rejects.duplicateEntry).toBe(1);
  });

  it('rejects self-pairs, blank sides and out-of-scope tournaments', () => {
    const { partnerships, rejects } = aggregatePartnerships(
      [
        entry('t1', 1, 1),
        { NoTournament: 't1', NoPlayer1: '1', NoPlayer2: '' },
        { NoTournament: 't1', NoPlayer1: '1', NoPlayer2: '0' },
        entry('unknown-tournament', 1, 2),
        entry('t1', 1, 999), // player not in VIS
      ],
      tournaments,
      players,
    );
    expect(partnerships.size).toBe(0);
    expect(rejects).toMatchObject({
      selfPair: 1,
      missingPlayer: 2,
      outOfScopeTournament: 1,
      unknownPlayer: 1,
    });
  });

  it('counts an appearance for every player of a valid entry', () => {
    const { appearances } = aggregatePartnerships(
      [entry('t1', 1, 2), entry('t2', 1, 3)],
      tournaments,
      players,
    );
    expect(appearances.get(1)!.size).toBe(2);
    expect(appearances.get(2)!.size).toBe(1);
  });
});

describe('sliceByCountryAndGender', () => {
  const tournaments = normaliseTournaments([tournament('t1', 2023), tournament('t2', 2024)]);
  const players = normalisePlayers([
    player(1, '0', 'BRA'),
    player(2, '0', 'BRA'),
    player(3, '1', 'BRA'), // same country, different gender
    player(4, '0', 'NOR'),
    player(5, '1', 'BRA'),
  ]);

  const run = (rows: VisRow[], minNodes = 2) => {
    const { partnerships, appearances } = aggregatePartnerships(rows, tournaments, players);
    return sliceByCountryAndGender(partnerships, appearances, players, tournaments, minNodes);
  };

  it('separates men and women of the same country', () => {
    const slices = run([entry('t1', 1, 2), entry('t1', 3, 5)]);
    expect(slices.map((s) => `${s.country}-${s.gender}`).sort()).toEqual(['BRA-M', 'BRA-W']);
  });

  it('drops an edge whose endpoints are in different countries', () => {
    const slices = run([entry('t1', 1, 2), entry('t2', 2, 4)]);
    const bra = slices.find((s) => s.country === 'BRA' && s.gender === 'M')!;
    // Both players remain as nodes; only the cross-national edge is dropped.
    expect(bra.nodes.map((n) => n.id).sort()).toEqual([1, 2]);
    expect(bra.edges).toHaveLength(1);
    expect(bra.edges[0]).toMatchObject({ a: 1, b: 2 });
    // Norway has a single player, below the minimum, so no slice is emitted.
    expect(slices.some((s) => s.country === 'NOR')).toBe(false);
  });

  it('derives node tournament counts and season span from appearances', () => {
    const slices = run([entry('t1', 1, 2), entry('t2', 1, 2)]);
    const node = slices[0]!.nodes.find((n) => n.id === 1)!;
    expect(node).toMatchObject({ tournaments: 2, first: 2023, last: 2024 });
  });

  it('honours the minimum node count', () => {
    expect(run([entry('t1', 1, 2)], 3)).toHaveLength(0);
    expect(run([entry('t1', 1, 2)], 2)).toHaveLength(1);
  });
});
