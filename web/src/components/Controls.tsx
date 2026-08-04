/**
 * The filter row: one left-aligned row above everything it scopes. Country and
 * gender re-render the graph, the stats and the table against the same slice,
 * so the numbers on screen always agree.
 */

import { useEffect, useRef, useState } from 'react';
import type { Gender, Manifest } from '../schema';
import { GENDER_LABEL, GENDERS } from '../schema';
import { flagEmoji, plural } from '../lib/format';
import './Controls.css';

/**
 * A help affordance that works on both input modes: `title` still gives
 * desktop mouse users the free native hover tooltip, but a `title` attribute
 * alone is invisible on touch — there is no hover state to trigger it. So the
 * trigger is a real button that also opens a rendered bubble on tap/click,
 * closed by an outside tap, Escape, or blur.
 */
function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="help-tip" ref={rootRef}>
      <button
        type="button"
        className="help-tip-trigger"
        title={text}
        aria-label={text}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <span className="help-tip-bubble" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

/** Presets for the partnership-strength threshold. */
export const MIN_TOGETHER_OPTIONS = [1, 2, 3, 5, 10] as const;

interface Props {
  manifest: Manifest;
  country: string;
  gender: Gender;
  onCountry: (code: string) => void;
  onGender: (gender: Gender) => void;
  search: string;
  onSearch: (value: string) => void;
  minTogether: number;
  onMinTogether: (value: number) => void;
}

export function Controls({
  manifest,
  country,
  gender,
  onCountry,
  onGender,
  search,
  onSearch,
  minTogether,
  onMinTogether,
}: Props) {
  const selected = manifest.countries.find((c) => c.code === country);

  return (
    <div className="controls" role="group" aria-label="Filters">
      <label className="field">
        <span>Country</span>
        <select value={country} onChange={(e) => onCountry(e.target.value)}>
          {manifest.countries.map((c) => {
            const total = GENDERS.reduce((sum, g) => sum + (c.genders[g]?.nodes ?? 0), 0);
            const flag = flagEmoji(c.iso2, c.code);
            return (
              <option key={c.code} value={c.code}>
                {flag ? `${flag} ` : ''}
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

      <div className="field">
        <span id="min-together-label">
          Min. events together
          <HelpTip text="Partnerships below this many shared tournaments are hidden — use it to strip one-off pairings." />
        </span>
        <div className="segmented" role="group" aria-labelledby="min-together-label">
          {MIN_TOGETHER_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={n === minTogether ? 'is-selected' : ''}
              aria-pressed={n === minTogether}
              onClick={() => onMinTogether(n)}
            >
              {n === 1 ? 'All' : `${n}+`}
            </button>
          ))}
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
