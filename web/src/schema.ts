/**
 * The published data contract (`/v1/`). Shared verbatim by the ingest pipeline
 * and the web app so the two can never drift.
 *
 * Keys on `edges` are deliberately short (`a`/`b`/`t`) — edges dominate file
 * size and terse keys are a ~30% saving for free.
 */

export const DATA_VERSION = 'v1';

export type Gender = 'M' | 'W';

/** Competition tiers we consider "FIVB international". See ingest/tiers.ts. */
export type Tier = 'olympics' | 'world-champs' | 'world-tour' | 'beach-pro-tour' | 'age-group-wch';

export interface GraphNode {
  /** FIVB player number — the stable identity across the whole dataset. */
  id: number;
  /** Display name, "First Last". */
  name: string;
  /**
   * Competition name — what the player is actually known as in the sport
   * ("Emanuel", "Alison"). Used for graph labels, where full names of the
   * "Paulo Roberto Moreira da Costa" sort would bury the graph.
   */
  short: string;
  /** Count of qualifying tournaments entered. Drives node size. */
  tournaments: number;
  /** Season of first qualifying entry. */
  first: number;
  /** Season of most recent qualifying entry. */
  last: number;
}

/**
 * One season of a partnership: `[season, tournaments together, startOffset?]`.
 *
 * A tuple rather than an object because these are the most numerous values in
 * the published data — there are more of them than there are partnerships.
 *
 * `startOffset` is days from 1 January of that season to the first event the
 * pair played in it, and exists only to order two partners *within* one year.
 * An offset rather than a calendar date so it stays two or three digits, and
 * signed so a December event opening a southern season still sorts before the
 * following January's. Absent when the tournament carried no usable date.
 */
export type SeasonTally =
  | [season: number, tournaments: number]
  | [season: number, tournaments: number, startOffset: number];

export interface GraphEdge {
  a: number;
  b: number;
  /** Number of qualifying tournaments this pair entered together. */
  t: number;
  /** First and last season the pair played together. */
  f: number;
  l: number;
  /**
   * Per-season breakdown, ascending by season. `t`, `f` and `l` are all
   * derivable from it (sum, first, last) and are kept anyway: they are what
   * the graph and the partner list read on every render, and recomputing them
   * per edge per frame to save a few bytes is the wrong trade.
   *
   * Optional because data published before this field existed does not carry
   * it — the timeline view hides itself rather than rendering empty when a
   * slice predates it.
   */
  s?: SeasonTally[];
}

export interface GraphFile {
  country: string;
  countryName: string;
  gender: Gender;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MedalCounts {
  gold: number;
  silver: number;
  bronze: number;
}

/**
 * A partner who competed for a different federation, so the partnership sits
 * outside this slice and has no edge in the graph.
 *
 * Only ~0.8% of partnerships, but they are not evenly spread: a player who
 * transferred can lose every partner at once and render as a lone dot with an
 * empty card. Carrying them on the player rather than the graph shows the
 * career without inventing a cross-country edge the slicing deliberately
 * excludes.
 */
export interface AwayPartner {
  id: number;
  name: string;
  /** Federation code — the slice this partner actually lives in. */
  fed: string;
  gender: Gender;
  /** Tournaments together, and the first and last season of them. */
  t: number;
  f: number;
  l: number;
}

/** Lazy-loaded detail for every player in one country x gender slice. */
export interface PlayerDetail {
  id: number;
  name: string;
  /** ISO date, `null` when FIVB has no date on file. */
  dob: string | null;
  /** Centimetres, `null` when unknown (~60% of the archive has no height). */
  height: number | null;
  /** Kilograms, `null` when unknown. */
  weight: number | null;
  /**
   * Present only when the player won at least one medal at a real, senior
   * Olympic Games. Omitted (not zeroed) for the vast majority of players who
   * never medalled, to keep the common case free.
   */
  olympics?: MedalCounts;
  /** Present only when the player won at least one FIVB World Championships medal. */
  worldChamps?: MedalCounts;
  /**
   * Partnerships with players from another federation, which the graph drops.
   * Omitted entirely for the ~98% of players who have none.
   */
  away?: AwayPartner[];
}

/**
 * Portrait for a player. May 404 — plenty of players have no photo on file, so
 * callers must handle failure (the UI falls back to initials).
 *
 * `width` matters: without it FIVB serves the original, which runs to 2-3MB per
 * portrait. With it, the image service returns a resized WebP of about 10KB.
 */
export const playerPhotoUrl = (id: number, width = 200) =>
  `https://sharp.fivb.com/Legacy/GetImage?Type=Player&No=${id}&Style=Portrait&width=${width}`;

/** Public FIVB athlete page. */
export const playerProfileUrl = (id: number) =>
  `https://www.fivb.com/players/players-database/player/${id}`;

export interface PlayersFile {
  country: string;
  gender: Gender;
  players: PlayerDetail[];
}

export interface ManifestCountry {
  /** FIVB federation code, e.g. "BRA". */
  code: string;
  name: string;
  /** ISO-3166-1 alpha-2, for the flag glyph. Null when FIVB has no usable code. */
  iso2: string | null;
  genders: Partial<Record<Gender, { nodes: number; edges: number }>>;
}

export interface Manifest {
  generatedAt: string;
  /** Highest tournament `Version` seen upstream — changes when FIVB edits data. */
  sourceVersion: string;
  /** Seasons covered by the qualifying tournament set. */
  seasons: { from: number; to: number };
  totals: {
    tournaments: number;
    players: number;
    partnerships: number;
  };
  /** Qualifying tournament count per tier, so the filter is inspectable. */
  tiers: Record<string, number>;
  countries: ManifestCountry[];
}

export const GENDERS: Gender[] = ['M', 'W'];

export const GENDER_LABEL: Record<Gender, string> = {
  M: "Men",
  W: "Women",
};

export const graphPath = (base: string, country: string, gender: Gender) =>
  `${base}${DATA_VERSION}/graphs/${country}-${gender}.json`;

export const playersPath = (base: string, country: string, gender: Gender) =>
  `${base}${DATA_VERSION}/players/${country}-${gender}.json`;

export const manifestPath = (base: string) => `${base}${DATA_VERSION}/manifest.json`;
