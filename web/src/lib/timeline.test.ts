import { describe, it, expect } from 'vitest';
import { buildTimeline, type TimelinePartner } from './timeline';
import type { GraphNode } from '../schema';

const node = (id: number, name: string): GraphNode => ({
  id,
  name,
  short: name,
  tournaments: 0,
  first: 0,
  last: 0,
});

const partner = (id: number, name: string, s: [number, number][]): TimelinePartner => ({
  node: node(id, name),
  s,
});

describe('buildTimeline', () => {
  it('groups partnerships by season, newest first', () => {
    const rows = buildTimeline([
      partner(1, 'Early', [
        [2018, 3],
        [2019, 1],
      ]),
      partner(2, 'Late', [[2021, 2]]),
    ]);
    expect(rows.map((r) => r.season)).toEqual([2021, 2019, 2018]);
  });

  it('puts two partners from the same season in one group', () => {
    // The whole point of the view: the partner list renders these as two
    // separate rows with overlapping ranges and no way to see the overlap.
    const rows = buildTimeline([
      partner(1, 'Doherty', [
        [2013, 2],
        [2014, 8],
      ]),
      partner(2, 'Hyden', [[2013, 5]]),
    ]);
    const y2013 = rows.find((r) => r.season === 2013)!;
    expect(y2013.partners.map((p) => p.node.name)).toEqual(['Hyden', 'Doherty']);
    expect(y2013.total).toBe(7);
  });

  it('merges a partner split across one season into a single row', () => {
    // A plays with A, switches to B, then goes back to A — all in 2013. The
    // year gets two rows, not three: the edge is keyed by the pair, so both
    // spells with A are already one number by the time this sees them.
    //
    // Not a rendering choice. Separating the spells would mean claiming A
    // came before *and* after B, and this data cannot order two partners
    // inside a season at all — VIS dates tournaments only to the year here.
    const rows = buildTimeline([
      partner(1, 'A', [[2013, 3]]), // 1 tournament, then 2 more after the switch
      partner(2, 'B', [[2013, 2]]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partners.map((p) => [p.node.name, p.t])).toEqual([
      ['A', 3],
      ['B', 2],
    ]);
    expect(rows[0]!.total).toBe(5);
  });

  it('orders partners within a season by tournaments, then name', () => {
    const rows = buildTimeline([
      partner(1, 'Zed', [[2020, 1]]),
      partner(2, 'Abe', [[2020, 1]]),
      partner(3, 'Most', [[2020, 9]]),
    ]);
    expect(rows[0]!.partners.map((p) => p.node.name)).toEqual(['Most', 'Abe', 'Zed']);
  });

  it('sums a season total across every partner in it', () => {
    const rows = buildTimeline([partner(1, 'A', [[2020, 4]]), partner(2, 'B', [[2020, 3]])]);
    expect(rows[0]!.total).toBe(7);
  });

  it('leaves gap years out entirely', () => {
    // A player who competed in 2015 and again in 2019 has two rows, not five.
    const rows = buildTimeline([
      partner(1, 'A', [
        [2015, 1],
        [2019, 1],
      ]),
    ]);
    expect(rows.map((r) => r.season)).toEqual([2019, 2015]);
  });

  it('returns nothing when no partner carries season data', () => {
    // Slices published before the field existed. The card reads an empty
    // result as "no timeline to offer" and hides the switch rather than
    // rendering a blank panel.
    expect(buildTimeline([{ node: node(1, 'A') }, { node: node(2, 'B') }])).toEqual([]);
  });

  it('handles a player with no partners at all', () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it('keeps partners that have season data when others do not', () => {
    const rows = buildTimeline([{ node: node(1, 'NoData') }, partner(2, 'HasData', [[2022, 1]])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partners.map((p) => p.node.name)).toEqual(['HasData']);
  });
});
