/** Small display helpers, kept pure so they can be unit-tested. */

/** ISO-3166 alpha-2 -> flag emoji via regional indicator symbols. */
export function flagEmoji(iso2: string | null | undefined): string {
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return '';
  return String.fromCodePoint(
    ...iso2
      .toUpperCase()
      .split('')
      .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/** Whole years from an ISO date to `now`. Null when the date is unusable. */
export function age(dob: string | null, now = new Date()): number | null {
  if (!dob) return null;
  const born = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) years--;
  return years >= 0 && years < 120 ? years : null;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "2014" for a single season, "2014–2019" for a span. */
export function seasonSpan(first: number, last: number): string {
  return first === last ? String(first) : `${first}–${last}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
