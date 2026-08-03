/**
 * Which tournaments count as "FIVB international".
 *
 * VIS classifies every beach tournament with two fields:
 *   OrganizerType — 1 = FIVB, 2 = confederation (CEV/AVC/NORCECA/CSV/CAVB),
 *                   3/4 = multi-sport games bodies, 5 = national federation
 *   Type          — the competition format within that organizer
 *
 * `OrganizerType === 1` alone is not sufficient: FIVB is recorded as the
 * organizer for a number of continental events (CAVB/NORCECA championships,
 * zonal tours), snow volleyball, seminars and test events. So we require
 * OrganizerType 1 *and* an explicit Type allowlist.
 *
 * The result is auditable: every kept tournament carries its tier into the
 * manifest, so `manifest.tiers` shows exactly what the filter admitted.
 */

import type { Tier } from '../web/src/schema.js';

/** FIVB is the organizer. */
export const FIVB_ORGANIZER_TYPE = '1';

/**
 * VIS `Type` -> tier. Anything absent is excluded.
 *
 * Deliberately excluded, for the record:
 *   7, 8, 11, 12, 34, 47, 48, 55  continental championships / cups / zonal tours
 *   9, 35                          seminars, VIS clinics, test events
 *   19, 36, 45                     snow volleyball
 *   44                             multi-sport games (Commonwealth, Pan Am, FISU)
 *   50                             King of the Court (outside the FIVB tour structure)
 */
export const TIER_BY_TYPE: Record<number, Tier> = {
  // --- Olympic ---
  5: 'olympics', // Olympic Games
  43: 'olympics', // Youth Olympic Games
  49: 'olympics', // Olympic Qualification Tournament

  // --- World Championships ---
  4: 'world-champs', // FIVB World Championships

  // --- Age-group World Championships ---
  13: 'age-group-wch', // Junior (U21) World Championships
  14: 'age-group-wch', // Youth (U19) World Championships
  25: 'age-group-wch', // U23 World Championships
  26: 'age-group-wch', // U21 World Championships
  27: 'age-group-wch', // U19 / U17 World Championships
  31: 'age-group-wch', // U17 World Championships

  // --- World Tour (1987-2021) ---
  0: 'world-tour', // Grand Slam / early World Tour
  1: 'world-tour', // Open
  2: 'world-tour', // Challenger
  3: 'world-tour', // World Series (1996)
  6: 'world-tour', // Satellite
  15: 'world-tour', // 1-star (FIVB-organized only; Type 15 under a national
  //                  federation is a domestic tour and is filtered out by
  //                  the OrganizerType check)
  32: 'world-tour', // Major Series
  33: 'world-tour', // World Tour Finals
  38: 'world-tour', // Major
  39: 'world-tour', // 4-star
  40: 'world-tour', // 3-star
  41: 'world-tour', // 2-star
  42: 'world-tour', // 1-star

  // --- Beach Pro Tour (2022-) ---
  51: 'beach-pro-tour', // Challenge
  52: 'beach-pro-tour', // Elite16
  53: 'beach-pro-tour', // Futures
  54: 'beach-pro-tour', // Finals
};

/**
 * Age-group world championships are FIVB world-level events but not senior
 * competition. Set `INCLUDE_AGE_GROUP=false` to restrict the graph to the
 * senior international game.
 */
export const INCLUDE_AGE_GROUP = process.env.INCLUDE_AGE_GROUP !== 'false';

export function tierFor(organizerType: string | undefined, type: string | undefined): Tier | null {
  if (organizerType !== FIVB_ORGANIZER_TYPE) return null;
  const tier = TIER_BY_TYPE[Number(type)];
  if (!tier) return null;
  if (tier === 'age-group-wch' && !INCLUDE_AGE_GROUP) return null;
  return tier;
}

export const TIER_LABEL: Record<Tier, string> = {
  olympics: 'Olympic Games',
  'world-champs': 'World Championships',
  'age-group-wch': 'Age-group World Championships',
  'world-tour': 'FIVB World Tour',
  'beach-pro-tour': 'Beach Pro Tour',
};
