/**
 * Stage 3-4: normalise VIS rows into players + weighted partnership edges, then
 * slice by country x gender.
 *
 * Pure functions over plain rows — no network, no filesystem — so the awkward
 * parts (pair canonicalisation, dedupe, slicing) are unit-testable.
 */

import type { Gender, GraphEdge, GraphNode, MedalCounts, Tier } from '../web/src/schema.js';
import { toCentimetres, toKilograms, type VisRow } from './vis.js';
import { tierFor, FIVB_ORGANIZER_TYPE } from './tiers.js';
import { EXCLUDED_FEDERATIONS, FEDERATION_ALIASES } from './countries.js';

export interface Tournament {
  no: string;
  tier: Tier;
  season: number;
  version: string;
}

export interface Player {
  id: number;
  name: string;
  /** Short competition name, e.g. "Emanuel". */
  short: string;
  gender: Gender;
  /** FIVB federation code. A player's *current* federation — no history kept. */
  federation: string;
  dob: string | null;
  height: number | null;
  weight: number | null;
}

/** A canonical unordered pair key: always "smaller:larger" by numeric id. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export interface Partnership {
  a: number;
  b: number;
  tournaments: Set<string>;
  firstSeason: number;
  lastSeason: number;
}

export interface RejectCounts {
  missingPlayer: number;
  selfPair: number;
  unknownPlayer: number;
  outOfScopeTournament: number;
  duplicateEntry: number;
  didNotPlay: number;
}

// --- Stage 1 normalisation -------------------------------------------------

/**
 * Season is usually a plain year, but the earliest World Tour records use a
 * range ("1987-91"). Take the leading year so those events are not silently
 * dropped by a `Number()` that yields NaN.
 */
export function parseSeason(raw: string | undefined): number | null {
  const match = /^\s*(\d{4})/.exec(raw ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1985 && year <= 2100 ? year : null;
}

/**
 * Was this tournament called off?
 *
 * VIS records it in the display name rather than a status field —
 * "Hamburg (canceled)", "Mangaung(Cancelled)", "CEV Lille Masters - canceled",
 * or sometimes just "Cancelled". Spelling, spacing and punctuation all vary,
 * and Spanish-language records use "cancelado"/"cancelada", so the test is a
 * substring rather than an exact marker.
 *
 * Deliberately does *not* match "postponed". A postponed event may still be
 * played, and 7 of them are sitting in the qualifying set; dropping those
 * would be asserting they never happen. They contribute no players either way
 * — no results, no rank — so leaving them counted costs nothing and stays
 * correct if one is eventually held.
 */
export function isCancelled(row: VisRow): boolean {
  return /cancel/i.test(row.Name ?? '');
}

export function normaliseTournaments(rows: VisRow[]): Map<string, Tournament> {
  const out = new Map<string, Tournament>();
  for (const row of rows) {
    const tier = tierFor(row.OrganizerType, row.Type);
    if (!tier) continue;
    // A tournament that was called off is not a tournament. It never had
    // results, so `Rank` already kept its entrants out of the graph — but it
    // was still counted in `manifest.totals.tournaments`, which is the one
    // published number that claimed otherwise. 131 of them, mostly 2020.
    if (isCancelled(row)) continue;
    const season = parseSeason(row.Season);
    if (season === null) continue;
    const no = (row.No ?? '').trim();
    if (!no) continue;
    out.set(no, { no, tier, season, version: (row.Version ?? '').trim() });
  }
  return out;
}

export type MedalCategory = 'olympics' | 'world-champs';

/**
 * Tournament number -> which medal event it is, restricted to the actual
 * senior Olympic Games (VIS Type 5) and FIVB World Championships (Type 4).
 *
 * The broader `olympics` *tier* used elsewhere also covers the Youth Olympic
 * Games (Type 43) and the Olympic Qualification Tournament (Type 49) — real
 * FIVB events, but neither is a medal event, so both are deliberately left
 * out here even though `tierFor` accepts them.
 */
export function medalTournaments(rows: VisRow[]): Map<string, MedalCategory> {
  const out = new Map<string, MedalCategory>();
  for (const row of rows) {
    if (row.OrganizerType !== FIVB_ORGANIZER_TYPE) continue;
    const no = (row.No ?? '').trim();
    if (!no) continue;
    if (row.Type === '5') out.set(no, 'olympics');
    else if (row.Type === '4') out.set(no, 'world-champs');
  }
  return out;
}

const RANK_TO_MEDAL: Record<number, keyof MedalCounts> = { 1: 'gold', 2: 'silver', 3: 'bronze' };

/**
 * Per-player medal counts from `Rank` at real Olympic Games / World
 * Championships matches. A handful of the earliest World Championships
 * (1997) had no bronze-medal match and awarded two bronzes — both semifinal
 * losers carry `Rank: 3`, and both are credited here.
 */
export function aggregateMedals(
  teamRows: VisRow[],
  medals: Map<string, MedalCategory>,
): Map<number, Record<MedalCategory, MedalCounts>> {
  const out = new Map<number, Record<MedalCategory, MedalCounts>>();

  const credit = (id: number, category: MedalCategory, medal: keyof MedalCounts) => {
    let entry = out.get(id);
    if (!entry) {
      out.set(
        id,
        (entry = {
          olympics: { gold: 0, silver: 0, bronze: 0 },
          'world-champs': { gold: 0, silver: 0, bronze: 0 },
        }),
      );
    }
    entry[category][medal]++;
  };

  for (const row of teamRows) {
    const category = medals.get((row.NoTournament ?? '').trim());
    if (!category) continue;
    const medal = RANK_TO_MEDAL[Number(row.Rank)];
    if (!medal) continue;
    const a = Number(row.NoPlayer1);
    const b = Number(row.NoPlayer2);
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0 || a === b) continue;
    credit(a, category, medal);
    credit(b, category, medal);
  }
  return out;
}

function fullName(row: VisRow): string {
  const first = (row.FirstName ?? '').trim();
  const last = (row.LastName ?? '').trim();
  const joined = `${first} ${last}`.trim();
  return joined || (row.TeamName ?? '').trim() || `Player ${row.No}`;
}

/**
 * The name a player competes under. VIS `TeamName` holds it ("Emanuel"), but it
 * is not always populated — fall back to the surname, then the full name.
 */
function shortName(row: VisRow, full: string): string {
  const team = (row.TeamName ?? '').trim();
  if (team) return team;
  const last = (row.LastName ?? '').trim();
  return last || full;
}

export function normalisePlayers(rows: VisRow[]): Map<number, Player> {
  const out = new Map<number, Player>();
  for (const row of rows) {
    const id = Number(row.No);
    if (!Number.isFinite(id) || id <= 0) continue;
    // VIS encodes gender as 0 = men, 1 = women. Anything else is unusable for a
    // gendered graph, so those players are dropped at slice time.
    const gender: Gender | null = row.Gender === '0' ? 'M' : row.Gender === '1' ? 'W' : null;
    if (!gender) continue;
    const rawFederation = (row.FederationCode ?? '').trim().toUpperCase();
    if (EXCLUDED_FEDERATIONS.has(rawFederation)) continue;
    const dob = (row.Birthdate ?? '').trim();
    const name = fullName(row);
    out.set(id, {
      id,
      name,
      short: shortName(row, name),
      gender,
      federation: FEDERATION_ALIASES[rawFederation] ?? rawFederation,
      dob: /^\d{4}-\d{2}-\d{2}$/.test(dob) && !dob.startsWith('0001') ? dob : null,
      height: toCentimetres(row.Height),
      weight: toKilograms(row.Weight),
      // VIS also has an `IsActive` flag, deliberately not carried through: it is
      // not beach-specific (it tracks a player's overall FIVB registration
      // across beach/indoor/snow) and is not reliably updated for retired
      // athletes. Cross-checked against this dataset: 66% of players it flags
      // active have no qualifying beach tournament in the last 5+ seasons.
    });
  }
  return out;
}

// --- Stage 3 aggregation ---------------------------------------------------

export interface AggregateResult {
  partnerships: Map<string, Partnership>;
  /** player id -> set of qualifying tournament numbers entered. */
  appearances: Map<number, Set<string>>;
  rejects: RejectCounts;
}

/**
 * Collapse team entries into weighted partnership edges.
 *
 * One entry row = +1 tournament for the pair, except that a pair entering both
 * the qualification and the main draw of the same tournament produces two rows
 * and must count once — hence the tournament *set* rather than a counter.
 */
export function aggregatePartnerships(
  teamRows: VisRow[],
  tournaments: Map<string, Tournament>,
  players: Map<number, Player>,
): AggregateResult {
  const partnerships = new Map<string, Partnership>();
  const appearances = new Map<number, Set<string>>();
  const rejects: RejectCounts = {
    missingPlayer: 0,
    selfPair: 0,
    unknownPlayer: 0,
    outOfScopeTournament: 0,
    duplicateEntry: 0,
    didNotPlay: 0,
  };

  const noteAppearance = (id: number, tournamentNo: string) => {
    let set = appearances.get(id);
    if (!set) appearances.set(id, (set = new Set()));
    set.add(tournamentNo);
  };

  for (const row of teamRows) {
    const tournamentNo = (row.NoTournament ?? '').trim();
    const tournament = tournaments.get(tournamentNo);
    if (!tournament) {
      rejects.outOfScopeTournament++;
      continue;
    }

    const a = Number(row.NoPlayer1);
    const b = Number(row.NoPlayer2);
    // Withdrawals and placeholder entries show up with one side missing or zero.
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      rejects.missingPlayer++;
      continue;
    }
    if (a === b) {
      rejects.selfPair++;
      continue;
    }
    if (!players.has(a) || !players.has(b)) {
      rejects.unknownPlayer++;
      continue;
    }

    // VIS keeps a team's registration row even after it's superseded: a pair
    // registers, one side pulls out before the event and re-registers with a
    // different partner, and the original row is never deleted — just marked
    // Rank 0 ("has not played the tournament", per FIVB's own field
    // description). Filtering on that, not on Status, is what actually tells
    // "never competed" apart from "competed and has a real result": a team
    // that plays into the tournament and can't finish (an injury retirement,
    // even in the very last match) still keeps its bracket placement and a
    // real Rank — Status alone doesn't distinguish these, Rank does. Negative
    // Rank values (qualification/quota eliminations) are real participation
    // and are kept; `Number('')` also happens to be 0, which is exactly right
    // for a blank Rank on a row that was never played.
    if (Number(row.Rank) === 0) {
      rejects.didNotPlay++;
      continue;
    }

    noteAppearance(a, tournamentNo);
    noteAppearance(b, tournamentNo);

    const key = pairKey(a, b);
    let pair = partnerships.get(key);
    if (!pair) {
      partnerships.set(
        key,
        (pair = {
          a: Math.min(a, b),
          b: Math.max(a, b),
          tournaments: new Set(),
          firstSeason: tournament.season,
          lastSeason: tournament.season,
        }),
      );
    }
    if (pair.tournaments.has(tournamentNo)) rejects.duplicateEntry++;
    pair.tournaments.add(tournamentNo);
    pair.firstSeason = Math.min(pair.firstSeason, tournament.season);
    pair.lastSeason = Math.max(pair.lastSeason, tournament.season);
  }

  return { partnerships, appearances, rejects };
}

// --- Stage 4 slicing -------------------------------------------------------

export interface Slice {
  country: string;
  gender: Gender;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Group players into country x gender slices and keep only edges whose *both*
 * endpoints fall inside the slice.
 *
 * Strict slicing drops cross-national partnerships entirely. Measured against
 * the live FIVB archive that is ~1% of all partnerships, which is why it is a
 * reasonable simplification rather than a silent hole.
 */
export function sliceByCountryAndGender(
  partnerships: Map<string, Partnership>,
  appearances: Map<number, Set<string>>,
  players: Map<number, Player>,
  tournaments: Map<string, Tournament>,
  minNodes = 2,
): Slice[] {
  const seasonOf = (t: string) => tournaments.get(t)?.season ?? 0;

  // Bucket every player that actually entered a qualifying tournament.
  const buckets = new Map<string, GraphNode[]>();
  const bucketOf = new Map<number, string>();

  for (const [id, entered] of appearances) {
    const player = players.get(id);
    if (!player || !player.federation) continue;
    const key = `${player.federation}-${player.gender}`;
    const seasons = [...entered].map(seasonOf).filter((s) => s > 0);
    if (seasons.length === 0) continue;

    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push({
      id,
      name: player.name,
      short: player.short,
      tournaments: entered.size,
      first: Math.min(...seasons),
      last: Math.max(...seasons),
    });
    bucketOf.set(id, key);
  }

  const edgesByBucket = new Map<string, GraphEdge[]>();
  for (const pair of partnerships.values()) {
    const ka = bucketOf.get(pair.a);
    const kb = bucketOf.get(pair.b);
    if (!ka || ka !== kb) continue; // cross-country or cross-gender: dropped
    let list = edgesByBucket.get(ka);
    if (!list) edgesByBucket.set(ka, (list = []));
    list.push({
      a: pair.a,
      b: pair.b,
      t: pair.tournaments.size,
      f: pair.firstSeason,
      l: pair.lastSeason,
    });
  }

  const slices: Slice[] = [];
  for (const [key, nodes] of buckets) {
    if (nodes.length < minNodes) continue;
    const split = key.lastIndexOf('-');
    const country = key.slice(0, split);
    const gender = key.slice(split + 1) as Gender;
    // Sorted by id — an immutable key — rather than tournament count: this is
    // the order written to disk, and every consumer (the app's table, the
    // graph's label picker, the prerendered page) already re-sorts by
    // whatever it actually needs. Sorting by a mutable field here instead
    // would mean a single player entering one more tournament reorders the
    // whole array, turning a one-line data change into a full-file diff.
    nodes.sort((x, y) => x.id - y.id);
    const edges = (edgesByBucket.get(key) ?? []).sort((x, y) => x.a - y.a || x.b - y.b);
    slices.push({ country, gender, nodes, edges });
  }
  slices.sort((x, y) => x.country.localeCompare(y.country) || x.gender.localeCompare(y.gender));
  return slices;
}
