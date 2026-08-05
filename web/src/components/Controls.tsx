/**
 * The filter row: one left-aligned row above everything it scopes. Country and
 * gender re-render the graph, the stats and the table against the same slice,
 * so the numbers on screen always agree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Gender, Manifest } from '../schema';
import { GENDER_LABEL, GENDERS } from '../schema';
import { flagEmoji, plural } from '../lib/format';
import { searchPlayers, type SearchablePlayer } from '../lib/search';
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

/**
 * Jump-to-player search. Deliberately not a filter on the table below it —
 * that pairing (type up top, watch a list scroll far down the page) was the
 * actual complaint. This is a self-contained combobox instead: matches render
 * in a dropdown right under the input, and picking one (click, or arrow keys
 * + Enter) opens that player's profile and pans the graph to them, same as
 * clicking their node or their row in the table directly.
 */
function PlayerSearch({
  players,
  onSelectPlayer,
}: {
  players: SearchablePlayer[];
  onSelectPlayer: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchPlayers(players, query), [players, query]);

  // A new query invalidates whatever was highlighted; default to the top hit.
  useEffect(() => {
    setActiveIndex(matches.length > 0 ? 0 : -1);
  }, [matches]);

  // Keep the highlighted option in view as arrow keys move it. Currently a
  // no-op in practice — the default result limit and the dropdown's max-height
  // happen to agree, so every option is always on screen at once — but that is
  // a coincidence of two unrelated constants, not a guarantee; raise the limit,
  // shrink the dropdown, or add a second line per row and this starts mattering
  // with no other code change. `block: 'nearest'` only moves the list, never
  // the page, and is a no-op when the option is already visible.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`player-search-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  const select = (id: number) => {
    onSelectPlayer(id);
    // Clears rather than keeps the match text: this is "jump to", a completed
    // action, not an ongoing filter the reader would want to keep visible.
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      if (matches.length > 0) setActiveIndex((i) => (i + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (matches.length > 0) setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      const match = matches[activeIndex];
      if (match) {
        event.preventDefault();
        select(match.id);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const showResults = open && matches.length > 0;
  const showEmpty = open && !showResults && query.trim().length > 0;

  return (
    <div className="player-search field grow" ref={rootRef}>
      <span id="player-search-label">Find a player</span>
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-labelledby="player-search-label"
        aria-expanded={showResults}
        aria-controls="player-search-listbox"
        aria-activedescendant={activeIndex >= 0 ? `player-search-option-${activeIndex}` : undefined}
        value={query}
        placeholder="Start typing a name…"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showResults && (
        <ul className="player-search-results" role="listbox" id="player-search-listbox">
          {matches.map((m, i) => (
            // Not a <button>: in the combobox pattern real focus stays in the
            // input and `aria-activedescendant` points at the active option, so
            // a focusable control per row would put 8 extra stops in the tab
            // order between the search box and the next control. `option` also
            // takes presentational children, so a nested button's semantics are
            // stripped from the accessibility tree anyway — it would be
            // tabbable but announce as nothing. Pointer users still click the
            // row; keyboard users arrow and press Enter.
            <li
              key={m.id}
              role="option"
              id={`player-search-option-${i}`}
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'is-active' : ''}
              onPointerEnter={() => setActiveIndex(i)}
              // Selection happens on pointerdown rather than click so it beats
              // the outside-pointerdown handler that closes the dropdown.
              onPointerDown={(e) => {
                e.preventDefault(); // keep focus in the input
                select(m.id);
              }}
            >
              <span className="name">{m.name}</span>
              <span className="meta">{plural(m.tournaments, 'tournament')}</span>
            </li>
          ))}
        </ul>
      )}
      {showEmpty && (
        <p className="player-search-empty" role="status">
          No players match "{query.trim()}".
        </p>
      )}
    </div>
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
  minTogether: number;
  onMinTogether: (value: number) => void;
  players: SearchablePlayer[];
  onSelectPlayer: (id: number) => void;
}

export function Controls({
  manifest,
  country,
  gender,
  onCountry,
  onGender,
  minTogether,
  onMinTogether,
  players,
  onSelectPlayer,
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

      <PlayerSearch players={players} onSelectPlayer={onSelectPlayer} />

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
