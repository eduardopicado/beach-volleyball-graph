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

  const map = new Map<string, Federation>();
  for (const row of rows) {
    const code = (row.Code ?? '').trim();
    if (!code) continue;
    const iso2 = (row.CountryCode ?? '').trim().toUpperCase() || null;
    let name: string | undefined;
    if (iso2 && /^[A-Z]{2}$/.test(iso2)) {
      try {
        name = regionNames.of(iso2) ?? undefined;
      } catch {
        name = undefined;
      }
    }
    map.set(code, { code, name: name ?? tidy(row.Name ?? code), iso2 });
  }
  return map;
}

/** Falls back to the raw code so an unknown federation still renders sensibly. */
export function countryName(federations: Map<string, Federation>, code: string): string {
  return federations.get(code)?.name ?? code;
}
