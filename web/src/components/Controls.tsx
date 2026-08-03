/**
 * The filter row: one left-aligned row above everything it scopes. Country and
 * gender re-render the graph, the stats and the table against the same slice,
 * so the numbers on screen always agree.
 */

import type { Gender, Manifest } from '../schema';
import { GENDER_LABEL, GENDERS } from '../schema';
import { plural } from '../lib/format';
import './Controls.css';

interface Props {
  manifest: Manifest;
  country: string;
  gender: Gender;
  onCountry: (code: string) => void;
  onGender: (gender: Gender) => void;
  search: string;
  onSearch: (value: string) => void;
}

export function Controls({ manifest, country, gender, onCountry, onGender, search, onSearch }: Props) {
  const selected = manifest.countries.find((c) => c.code === country);

  return (
    <div className="controls" role="group" aria-label="Filters">
      <label className="field">
        <span>Country</span>
        <select value={country} onChange={(e) => onCountry(e.target.value)}>
          {manifest.countries.map((c) => {
            const total = GENDERS.reduce((sum, g) => sum + (c.genders[g]?.nodes ?? 0), 0);
            return (
              <option key={c.code} value={c.code}>
                {c.name} ({total})
              </option>
            );
          })}
        </select>
      </label>

      <div className="field">
        <span id="gender-label">Gender</span>
        <div className="segmented" role="group" aria-labelledby="gender-label">
          {GENDERS.map((g) => {
            const count = selected?.genders[g]?.nodes ?? 0;
            return (
              <button
                key={g}
                type="button"
                className={g === gender ? 'is-selected' : ''}
                aria-pressed={g === gender}
                disabled={count === 0}
                title={count === 0 ? `No ${GENDER_LABEL[g].toLowerCase()} players for this country` : undefined}
                onClick={() => onGender(g)}
              >
                {GENDER_LABEL[g]}
                <span className="tally">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <label className="field grow">
        <span>Find a player</span>
        <input
          type="search"
          value={search}
          placeholder="Start typing a name…"
          onChange={(e) => onSearch(e.target.value)}
          autoComplete="off"
        />
      </label>

      <p className="as-of">
        Data as of{' '}
        <time dateTime={manifest.generatedAt}>
          {new Date(manifest.generatedAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </time>
        <span className="sep">·</span>
        {plural(manifest.totals.tournaments, 'tournament')}, {manifest.seasons.from}–{manifest.seasons.to}
      </p>
    </div>
  );
}
