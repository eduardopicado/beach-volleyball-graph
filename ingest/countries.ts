/**
 * FIVB federation code (RUS, GER, ENG...) -> display country name.
 *
 * VIS gives us each federation's ISO-3166-1 alpha-2 country code, so the
 * display name comes from `Intl.DisplayNames` rather than a hand-maintained
 * table that would rot. Federations whose ISO code no longer resolves (historic
 * entities such as Netherlands Antilles) fall back to a tidied federation name.
 */

import { fetchList, type VisRow } from './vis.js';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

export interface Federation {
  /** Three-letter FIVB federation code — the key used everywhere downstream. */
  code: string;
  name: string;
  /** ISO-3166-1 alpha-2, used for the flag glyph in the UI. */
  iso2: string | null;
}

/**
 * Federations whose VIS `CountryCode` does not identify them.
 *
 * The four UK home nations are separate FIVB federations but England, Scotland
 * and Northern Ireland all carry `GB`, so deriving the name from the ISO code
 * alone labels three different federations "United Kingdom". Wales carries the
 * non-ISO value `04`. Their federation names ("VOLLEYBALL ENGLAND") are
 * organisation names, not country names, so neither source works unaided.
 */
const NAME_OVERRIDES: Record<string, string> = {
  ENG: 'England',
  SCO: 'Scotland',
  NIR: 'Northern Ireland',
  WAL: 'Wales',
};

/** Title-cases "ALGERIAN VOLLEY BALL FEDERATION" -> "Algerian Volley Ball Federation". */
function tidy(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b[\p{L}']+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1))
    .trim();
}

export async function fetchFederations(): Promise<Map<string, Federation>> {
  const rows: VisRow[] = await fetchList({
    type: 'GetFederationList',
    fields: ['Code', 'Name', 'CountryCode'],
    itemTag: 'Federation',
  });
  return buildFederations(rows);
}

/** Pure half of {@link fetchFederations}, so the naming rules are testable. */
export function buildFederations(rows: VisRow[]): Map<string, Federation> {
  const map = new Map<string, Federation>();
  for (const row of rows) {
    const code = (row.Code ?? '').trim();
    if (!code) continue;
    const rawIso = (row.CountryCode ?? '').trim().toUpperCase();
    const iso2 = /^[A-Z]{2}$/.test(rawIso) ? rawIso : null;

    let name = NAME_OVERRIDES[code];
    if (!name && iso2) {
      try {
        const resolved = regionNames.of(iso2);
        // `ZZ` is the assigned code for "unknown region", so Intl resolves it
        // to a name that is worse than no name at all.
        name = resolved && resolved !== 'Unknown Region' ? resolved : undefined;
      } catch {
        name = undefined; // not a assigned region code
      }
    }
    map.set(code, { code, name: name ?? tidy(row.Name ?? code), iso2 });
  }

  // Two federations sharing a display name would produce one URL slug and
  // silently hide a country. Disambiguate rather than lose a page, and say so
  // loudly enough that a proper override gets added.
  const byName = new Map<string, Federation[]>();
  for (const fed of map.values()) {
    const list = byName.get(fed.name) ?? [];
    list.push(fed);
    byName.set(fed.name, list);
  }
  for (const [name, feds] of byName) {
    if (feds.length < 2) continue;
    console.warn(
      `  ! ${feds.length} federations share the name "${name}" (${feds
        .map((f) => f.code)
        .join(', ')}); disambiguating with the federation code.`,
    );
    for (const fed of feds) map.set(fed.code, { ...fed, name: `${name} (${fed.code})` });
  }

  return map;
}

/** Falls back to the raw code so an unknown federation still renders sensibly. */
export function countryName(federations: Map<string, Federation>, code: string): string {
  return federations.get(code)?.name ?? code;
}
