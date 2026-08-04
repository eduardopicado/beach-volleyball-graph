/** Pure matching/ranking logic for the jump-to-player search, kept separate so it can be unit-tested without React. */

export interface SearchablePlayer {
  id: number;
  name: string;
  tournaments: number;
}

/**
 * Rank matches for a "jump to this player" search: names starting with the
 * query first, then names merely containing it, each group ordered by
 * tournament count (the more prominent player is more likely who you meant)
 * and then name for a stable tie-break. Case-insensitive. An empty or
 * whitespace-only query matches nothing — there is no "everyone" result to
 * jump to.
 */
export function searchPlayers(
  players: SearchablePlayer[],
  query: string,
  limit = 8,
): SearchablePlayer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const starts: SearchablePlayer[] = [];
  const contains: SearchablePlayer[] = [];
  for (const p of players) {
    const name = p.name.toLowerCase();
    if (name.startsWith(q)) starts.push(p);
    else if (name.includes(q)) contains.push(p);
  }

  const byProminence = (a: SearchablePlayer, b: SearchablePlayer) =>
    b.tournaments - a.tournaments || a.name.localeCompare(b.name);
  starts.sort(byProminence);
  contains.sort(byProminence);

  return [...starts, ...contains].slice(0, limit);
}
