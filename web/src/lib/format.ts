/** Small display helpers, kept pure so they can be unit-tested. */

/**
 * Builds a Unicode "emoji tag sequence" subdivision flag: the black flag base
 * followed by invisible tag characters spelling out the subdivision code,
 * terminated by the cancel tag. This is the mechanism behind England,
 * Scotland and Wales's flags — none of which have an ISO-3166-1 country code
 * of their own, since they aren't countries; FIVB still fields them as
 * separate federations.
 *
 * Support is real but narrower than regional-indicator flags: renders
 * correctly on Apple platforms and recent Android/Chrome, but on a font
 * without the sequence (older Windows, some Linux setups) the invisible tag
 * characters just vanish, leaving a plain black flag rather than a broken
 * glyph — a graceful, not broken, fallback.
 */
function subdivisionFlag(code: string): string {
  const TAG_BASE = 0xe0000;
  const CANCEL_TAG = 0xe007f;
  const BLACK_FLAG = 0x1f3f4;
  const tags = [...code.toLowerCase()].map((c) => String.fromCodePoint(TAG_BASE + c.charCodeAt(0)));
  return String.fromCodePoint(BLACK_FLAG) + tags.join('') + String.fromCodePoint(CANCEL_TAG);
}

/**
 * FIVB federation code -> subdivision code, for federations with no ISO
 * country code (see `subdivisionFlag`). Northern Ireland has no equivalent:
 * Unicode has never standardised a "gbnir" sequence, unlike gbeng/gbsct/gbwls
 * — its federation stays without a flag.
 */
const SUBDIVISION_CODES: Record<string, string> = {
  ENG: 'gbeng',
  SCO: 'gbsct',
  WAL: 'gbwls',
};

/**
 * Withdrawn ISO-3166-1 codes that FIVB federation records still carry,
 * mapped to the current code of whichever country now covers that
 * territory. `Intl.DisplayNames` resolves a *name* for these via CLDR's own
 * alias data (`AN` -> "Curaçao"), but building a flag is a raw, unvalidated
 * regional-indicator pair with no equivalent fallback — an unassigned pair
 * like AN commonly renders as two separate boxed letters instead of
 * collapsing into one flag glyph, which is what actually prompted this (it
 * reads as the country appearing twice). Confirmed AN/Curaçao is the only
 * federation in the published dataset carrying a withdrawn code.
 */
const WITHDRAWN_ISO2: Record<string, string> = {
  AN: 'CW', // Netherlands Antilles, dissolved 2010 -> Curaçao
};

/**
 * ISO-3166 alpha-2 -> flag emoji via regional indicator symbols, with a
 * federation-code fallback for the UK home nations (see `SUBDIVISION_CODES`),
 * none of which carry their own ISO code.
 */
export function flagEmoji(iso2: string | null | undefined, federationCode?: string): string {
  const subdivision = federationCode && SUBDIVISION_CODES[federationCode];
  if (subdivision) return subdivisionFlag(subdivision);
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return '';
  const code = WITHDRAWN_ISO2[iso2.toUpperCase()] ?? iso2;
  return String.fromCodePoint(
    ...code
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
