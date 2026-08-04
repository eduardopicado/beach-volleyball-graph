import { describe, expect, it } from 'vitest';
import { searchPlayers, type SearchablePlayer } from './search';

const p = (id: number, name: string, tournaments = 10): SearchablePlayer => ({ id, name, tournaments });

describe('searchPlayers', () => {
  const players = [
    p(1, 'Emanuel Rego', 291),
    p(2, 'Ricardo Alex Costa Santos', 281),
    p(3, 'Pedro Solberg', 263),
    p(4, 'Renato Andrew Lima de Carvalho', 12),
    p(5, 'Rego Junior', 3), // deliberately shares "Rego" with player 1
  ];

  it('matches an empty or whitespace query to nothing', () => {
    expect(searchPlayers(players, '')).toEqual([]);
    expect(searchPlayers(players, '   ')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(searchPlayers(players, 'emanuel').map((m) => m.id)).toEqual([1]);
    expect(searchPlayers(players, 'EMANUEL').map((m) => m.id)).toEqual([1]);
  });

  it('ranks a name starting with the query above one that merely contains it', () => {
    // "Rego" starts player 1's surname-first... actually starts neither full
    // name, so use a query that distinguishes prefix vs substring directly.
    const result = searchPlayers(players, 'Rego');
    // Player 5 "Rego Junior" starts with "Rego"; player 1 "Emanuel Rego" only
    // contains it partway through.
    expect(result.map((m) => m.id)).toEqual([5, 1]);
  });

  it('breaks ties within a rank group by tournament count', () => {
    // Ricardo, Renato and "Rego Junior" all start with "r" case-insensitively;
    // within that group, the more prominent player sorts first.
    const result = searchPlayers(players, 'R');
    const starts = result.filter((m) => m.name.toLowerCase().startsWith('r'));
    expect(starts.map((m) => m.id)).toEqual([2, 4, 5]); // 281, 12, 3 tournaments
  });

  it('caps results at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => p(i, `Test Player ${i}`, i));
    expect(searchPlayers(many, 'Test')).toHaveLength(8);
    expect(searchPlayers(many, 'Test', 3)).toHaveLength(3);
  });

  it('finds a mid-name substring, not just a prefix', () => {
    expect(searchPlayers(players, 'Costa').map((m) => m.id)).toEqual([2]);
  });

  it('returns nothing for a query that matches no one', () => {
    expect(searchPlayers(players, 'Zzyzx')).toEqual([]);
  });
});
