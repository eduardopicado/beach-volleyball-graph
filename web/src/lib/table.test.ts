import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, nextSort, sortRows, type TableRow } from './table';

const row = (
  name: string,
  tournaments: number,
  partners: number,
  first = 2000,
  last = 2010,
): TableRow => ({
  id: name.charCodeAt(0),
  name,
  short: name,
  tournaments,
  first,
  last,
  partners,
  topPartner: null,
});

const ROWS: TableRow[] = [
  row('Carla', 30, 4, 1998, 2012),
  row('Ana', 30, 9, 2005, 2020),
  row('Bruno', 7, 4, 2010, 2011),
];

const names = (rows: TableRow[]) => rows.map((r) => r.name);

describe('sortRows', () => {
  it('opens on the busiest careers', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'tournaments', desc: true });
    expect(names(sortRows(ROWS, DEFAULT_SORT))[0]).toBe('Ana');
  });

  it('sorts by name in both directions', () => {
    expect(names(sortRows(ROWS, { key: 'name', desc: false }))).toEqual(['Ana', 'Bruno', 'Carla']);
    expect(names(sortRows(ROWS, { key: 'name', desc: true }))).toEqual(['Carla', 'Bruno', 'Ana']);
  });

  it('sorts numeric columns in both directions', () => {
    expect(names(sortRows(ROWS, { key: 'tournaments', desc: true }))).toEqual([
      'Ana',
      'Carla',
      'Bruno',
    ]);
    expect(names(sortRows(ROWS, { key: 'tournaments', desc: false }))).toEqual([
      'Bruno',
      'Ana',
      'Carla',
    ]);
    expect(names(sortRows(ROWS, { key: 'partners', desc: true }))).toEqual([
      'Ana',
      'Bruno',
      'Carla',
    ]);
  });

  it('breaks numeric ties alphabetically, in both directions', () => {
    // Ana and Carla both have 30 tournaments. Tournament counts repeat
    // heavily, so without this the tied block comes out in ingest order and
    // reorders itself for no visible reason between builds.
    expect(names(sortRows(ROWS, { key: 'tournaments', desc: true })).slice(0, 2)).toEqual([
      'Ana',
      'Carla',
    ]);
    expect(names(sortRows(ROWS, { key: 'tournaments', desc: false })).slice(1)).toEqual([
      'Ana',
      'Carla',
    ]);
  });

  it('sorts seasons on the last season, then the first', () => {
    // Two players last seen in 2020: the one who started earlier had the
    // longer career and ranks above the shorter one inside it.
    const rows = [row('Late', 5, 1, 2015, 2020), row('Early', 5, 1, 1999, 2020)];
    expect(names(sortRows(rows, { key: 'last', desc: false }))).toEqual(['Early', 'Late']);
    expect(names(sortRows(rows, { key: 'last', desc: true }))).toEqual(['Late', 'Early']);
  });

  it('does not sort the caller’s array in place', () => {
    // The row list is a useMemo upstream and is also what the graph reads;
    // sorting it in place would reorder the graph as a side effect of a click.
    const rows = [...ROWS];
    sortRows(rows, { key: 'name', desc: false });
    expect(names(rows)).toEqual(['Carla', 'Ana', 'Bruno']);
  });

  it('handles an empty table', () => {
    expect(sortRows([], DEFAULT_SORT)).toEqual([]);
  });
});

describe('nextSort', () => {
  it('flips direction when the same column is clicked again', () => {
    expect(nextSort({ key: 'tournaments', desc: true }, 'tournaments')).toEqual({
      key: 'tournaments',
      desc: false,
    });
    expect(nextSort({ key: 'tournaments', desc: false }, 'tournaments')).toEqual({
      key: 'tournaments',
      desc: true,
    });
  });

  it('starts a numeric column at its largest value', () => {
    expect(nextSort({ key: 'name', desc: false }, 'partners')).toEqual({
      key: 'partners',
      desc: true,
    });
  });

  it('starts the name column at A', () => {
    // The one column where "biggest first" would be Z–A, which nobody wants
    // as a first click.
    expect(nextSort({ key: 'tournaments', desc: true }, 'name')).toEqual({
      key: 'name',
      desc: false,
    });
  });
});
