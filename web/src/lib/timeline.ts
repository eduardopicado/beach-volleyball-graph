/**
 * Regroup a player's partnerships by season.
 *
 * The partner list answers "who did they play with most". This answers "what
 * did each year look like" — the question the aggregate cannot reach. A
 * partner list shows Doherty 2013–2014 and Hyden 2013 as separate rows and
 * gives no way to see that 2013 was shared between them. A quarter of players
 * in the archive have at least one season like that; among those with 20 or
 * more tournaments it is over three quarters.
 */

import type { GraphNode, SeasonTally } from '../schema';

/** The part of a partner row this needs. `PartnerRow` satisfies it structurally. */
export interface TimelinePartner {
  node: GraphNode;
  s?: SeasonTally[];
}

export interface TimelineSeason {
  season: number;
  partners: { node: GraphNode; t: number }[];
  /** Tournaments across every partner that season. */
  total: number;
}

/** Sorts before every real offset, so a dateless partner lands last. */
const NO_DATE = Number.POSITIVE_INFINITY;

/**
 * Newest season first — a career is usually read from "what are they doing
 * now" backwards, and the players with the longest timelines are exactly the
 * ones still active.
 *
 * Within a season, partners are ordered by when the pair first played that
 * year, falling back to tournaments together when a season carries no date.
 * Ordering by volume instead — which is all this could do before the ingest
 * fetched `StartDateMainDraw` — put a different name first in 38% of the
 * archive's 5,891 shared seasons, routinely ranking a one-off fill-in above
 * the partner somebody actually switched to.
 *
 * The trade is that the *biggest* partner of a season is no longer
 * necessarily at the top of it. For a view called a timeline that is the
 * right way round: sequence is the premise, and each row carries its own
 * tally anyway.
 *
 * What dates do not fix is what a row means. A player who partners A,
 * switches to B, then returns to A inside one season still gets two rows, not
 * three: the edge is keyed by the pair, so both spells with A arrive here as
 * one number. Splitting them needs per-tournament data, not just an ordering.
 */
export function buildTimeline(partners: readonly TimelinePartner[]): TimelineSeason[] {
  const bySeason = new Map<number, (TimelineSeason & { starts: number[] })>();

  for (const partner of partners) {
    // Absent on slices published before the per-season field existed. Callers
    // treat an empty result as "no timeline to offer" rather than "no seasons".
    for (const [season, t, startOffset] of partner.s ?? []) {
      let row = bySeason.get(season);
      if (!row) bySeason.set(season, (row = { season, partners: [], total: 0, starts: [] }));
      row.partners.push({ node: partner.node, t });
      row.starts.push(startOffset ?? NO_DATE);
      row.total += t;
    }
  }

  const seasons = [...bySeason.values()].sort((a, b) => b.season - a.season);
  return seasons.map(({ starts, ...row }) => {
    // Sort the two arrays together: `starts` is the key, `partners` the value.
    const order = row.partners.map((partner, i) => ({ partner, start: starts[i]! }));
    order.sort(
      (x, y) =>
        x.start - y.start ||
        y.partner.t - x.partner.t ||
        x.partner.node.name.localeCompare(y.partner.node.name),
    );
    return { ...row, partners: order.map((o) => o.partner) };
  });
}
