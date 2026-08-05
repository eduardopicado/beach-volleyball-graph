/**
 * Guards against publishing a rebuild that lost most of its data to a broken
 * fetch rather than a real change.
 *
 * A little week-to-week shrinkage is normal: a data correction, a retired
 * player's record pruned, a federation code newly excluded (see
 * `EXCLUDED_FEDERATIONS` in `countries.ts`). None of that looks different,
 * from a pure numbers standpoint, from an upstream response that silently came
 * back empty, truncated, or wrapped in an error page VIS returned as if it
 * were data — the FIVB endpoints have no obligation to fail loudly, and this
 * project has no control over that. The one thing distinguishing "a real
 * correction" from "a broken fetch" here is scale: real corrections move the
 * totals by a little; a broken fetch tends to lose most of them at once.
 */

export interface DatasetTotals {
  tournaments: number;
  players: number;
  partnerships: number;
}

/**
 * Compares `next` against `previous`, returning one human-readable line per
 * metric that shrank by more than `maxShrink` (default 5%). An empty array
 * means it's safe to publish. `previous: null` (no prior data to compare
 * against — the very first run) always passes; the caller's own absolute
 * floor is what protects a cold start.
 *
 * Growth is never flagged — there is no upper bound. More data is not
 * garbage.
 */
export function checkForRegression(
  previous: DatasetTotals | null,
  next: DatasetTotals,
  maxShrink = 0.05,
): string[] {
  if (!previous) return [];
  const problems: string[] = [];
  for (const key of ['tournaments', 'players', 'partnerships'] as const) {
    const before = previous[key];
    const after = next[key];
    // A zero baseline has nothing to shrink from — and dividing by it would
    // be nonsensical anyway.
    if (before > 0 && after < before * (1 - maxShrink)) {
      const pct = (100 * (1 - after / before)).toFixed(1);
      problems.push(`${key}: ${before.toLocaleString()} -> ${after.toLocaleString()} (down ${pct}%)`);
    }
  }
  return problems;
}
