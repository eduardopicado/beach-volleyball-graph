/** Pure matching/ranking logic for the jump-to-player search, kept separate so it can be unit-tested without React. */

import type { Gender } from '../schema';

export interface SearchablePlayer {
  id: number;
  name: string;
  tournaments: number;
  /**
   * The slice this player belongs to, set only for players outside the one
   * being viewed. Present means "picking this changes country and gender".
   */
  slice?: { country: string; gender: Gender };
}

/** A player with their name pre-folded, so a keystroke does not refold 12,000 of them. */
export interface IndexedPlayer extends SearchablePlayer {
  folded: string;
}

/**
 * Strip diacritics and case, so "Joao" finds "João" and "Ozols" finds "Ozols"
 * however either is typed.
 *
 * Beach volleyball is played almost everywhere, and this archive is full of
 * names a reader cannot reasonably be expected to reproduce exactly:
 * "Bárbara Seixas de Freitas", "Márton Szabó", "Kristīne Puriņa". Typing the
 * plain-ASCII form is the normal case, not the degraded one — before this,
 * searching "Barbara" found nothing at all, which is indistinguishable from
 * "she isn't in the data".
 *
 * NFD splits a precomposed letter into its base plus a combining mark, which
 * `\p{Diacritic}` then removes. Deliberately *not* symmetric with a locale
 * collator: `localeCompare` with sensitivity options can only compare whole
 * strings, and this needs substring matching.
 */
export function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Fold a list of players once, ready to be searched by every keystroke. */
export function indexPlayers(players: readonly SearchablePlayer[]): IndexedPlayer[] {
  return players.map((player) => ({ ...player, folded: foldAccents(player.name) }));
}

/**
 * Rank matches for a "jump to this player" search: names starting with the
 * query first, then names merely containing it. Within each group, players in
 * the slice on screen come before players from elsewhere — a reader on the
 * Brazil page typing "Ana" almost certainly means a Brazilian one — and then
 * by tournament count, since the more prominent player is more likely who was
 * meant, with the name as a stable tie-break.
 *
 * Case- and accent-insensitive. An empty or whitespace-only query matches
 * nothing: there is no "everyone" result to jump to.
 */
export function searchPlayers(
  players: readonly IndexedPlayer[],
  query: string,
  limit = 8,
): IndexedPlayer[] {
  const q = foldAccents(query.trim());
  if (!q) return [];

  const starts: IndexedPlayer[] = [];
  const contains: IndexedPlayer[] = [];
  for (const player of players) {
    if (player.folded.startsWith(q)) starts.push(player);
    else if (player.folded.includes(q)) contains.push(player);
  }

  const byProminence = (a: IndexedPlayer, b: IndexedPlayer) =>
    Number(Boolean(a.slice)) - Number(Boolean(b.slice)) ||
    b.tournaments - a.tournaments ||
    a.name.localeCompare(b.name);
  starts.sort(byProminence);
  contains.sort(byProminence);

  return [...starts, ...contains].slice(0, limit);
}
