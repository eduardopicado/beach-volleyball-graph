/** Parsing for the URL query parameters, kept pure so it can be unit-tested. */

/**
 * Read the `min` (partnership-strength threshold) parameter.
 *
 * Validated against the presets rather than merely being a number: the control
 * is a segmented button group, so a value with no matching button — `?min=7`,
 * or a value left over from a build with different presets — renders a group
 * where nothing looks selected while the graph is silently filtered. Falling
 * back to null means the caller uses its default and the UI stays honest about
 * what is applied.
 */
export function parseMinTogether(raw: string | null, allowed: readonly number[]): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return allowed.includes(value) ? value : null;
}
