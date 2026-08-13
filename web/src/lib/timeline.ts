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

/**
 * Newest season first — a career is usually read from "what are they doing
 * now" backwards, and the players with the longest timelines are exactly the
 * ones still active.
 *
 * Within a season, partners are ordered by tournaments together, then by name
 * for stability. Deliberately *not* chronological: the request this data comes
 * from dates tournaments only to the season, so the order two partners came in
 * within one year is genuinely unknown. Ordering by volume is a fact about the
 * data; ordering by guessed date would be a claim it cannot support.
 *
 * The same limit decides what a row means. A player who partners A, switches
 * to B, then returns to A inside one season gets two rows, not three: the edge
 * is keyed by the pair, so both spells with A arrive here as one number. Split
 * rows would have to assert that A came before *and* after B, which is exactly
 * the ordering this data does not carry.
 */
export function buildTimeline(partners: readonly TimelinePartner[]): TimelineSeason[] {
  const bySeason = new Map<number, TimelineSeason>();

  for (const partner of partners) {
    // Absent on slices published before the per-season field existed. Callers
    // treat an empty result as "no timeline to offer" rather than "no seasons".
    for (const [season, t] of partner.s ?? []) {
      let row = bySeason.get(season);
      if (!row) bySeason.set(season, (row = { season, partners: [], total: 0 }));
      row.partners.push({ node: partner.node, t });
      row.total += t;
    }
  }

  const seasons = [...bySeason.values()].sort((a, b) => b.season - a.season);
  for (const row of seasons) {
    row.partners.sort((x, y) => y.t - x.t || x.node.name.localeCompare(y.node.name));
  }
  return seasons;
}
