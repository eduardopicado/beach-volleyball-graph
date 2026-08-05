/**
 * Detail panel for the selected player.
 *
 * Photos come straight from FIVB's image service and 404 for players with none
 * on file, so the <img> is allowed to fail and an initials avatar takes over.
 */

import { useEffect, useRef, useState } from 'react';
import type { GraphNode, PlayerDetail } from '../schema';
import { playerPhotoUrl, playerProfileUrl } from '../schema';
import { age, formatDate, initials, plural, seasonSpan } from '../lib/format';
import './PlayerCard.css';

export interface PartnerRow {
  node: GraphNode;
  /** Tournaments played together. */
  t: number;
  f: number;
  l: number;
}

interface Props {
  node: GraphNode;
  detail: PlayerDetail | undefined;
  partners: PartnerRow[];
  countryName: string;
  flag: string;
  onSelectPartner: (id: number) => void;
  onClose: () => void;
}

/**
 * `focus`/`blur` reach both HTML and SVG elements through the `HTMLOrSVGElement`
 * mixin, but `Element` — the type of `document.activeElement` — has no shared
 * base TypeScript models cleanly as that mixin. A duck-typed guard is simpler
 * than a cast through `unknown`.
 */
function isFocusable(el: Element): el is Element & Pick<HTMLOrSVGElement, 'focus'> {
  return typeof (el as Partial<HTMLOrSVGElement>).focus === 'function';
}

function Photo({ src, name }: { src: string | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  // A new player means a new URL: reset so a previous 404 doesn't stick.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div className="player-photo is-fallback" aria-hidden="true">
        {initials(name)}
      </div>
    );
  }
  return (
    <img
      className="player-photo"
      src={src}
      alt={`Portrait of ${name}`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function PlayerCard({
  node,
  detail,
  partners,
  countryName,
  flag,
  onSelectPartner,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the card whenever it starts showing a *different* player —
  // on first open, and again if the reader clicks through a partner without
  // closing it — so a keyboard or screen-reader user who just picked someone
  // (from the graph, the table, search, or a partner link) lands where the
  // result actually is, instead of on a control that hasn't moved while a new
  // panel appears elsewhere on the page. Escape already closes the card; this
  // is the entry half of that same contract.
  useEffect(() => {
    // Whatever had focus a moment ago — a graph node, a table row, the search
    // input — so closing the card (Escape, or selecting nobody) can hand focus
    // back rather than dropping it to <body>, which is where the browser sends
    // it once the close button that held it is removed from the DOM.
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (
        previouslyFocused &&
        previouslyFocused !== document.body &&
        document.body.contains(previouslyFocused) &&
        isFocusable(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [node.id]);

  const years = age(detail?.dob ?? null);
  const totalTogether = partners.reduce((sum, p) => sum + p.t, 0);

  return (
    <aside className="player-card" aria-label={`Profile: ${node.name}`}>
      <header>
        <Photo src={playerPhotoUrl(node.id)} name={node.name} />
        <div className="who">
          <h2>{node.name}</h2>
          <p className="country">
            <span aria-hidden="true">{flag}</span> {countryName}
          </p>
        </div>
        <button ref={closeRef} type="button" className="close" onClick={onClose} aria-label="Close profile">
          ×
        </button>
      </header>

      <dl className="vitals">
        <div>
          <dt>Height</dt>
          <dd>{detail?.height ? `${detail.height} cm` : '—'}</dd>
        </div>
        <div>
          <dt>Born</dt>
          <dd>{formatDate(detail?.dob ?? null)}</dd>
        </div>
        <div>
          <dt>Age</dt>
          <dd>{years ?? '—'}</dd>
        </div>
        <div>
          <dt>Tournaments</dt>
          <dd>{node.tournaments}</dd>
        </div>
        <div>
          <dt>Partners</dt>
          <dd>{partners.length}</dd>
        </div>
        <div>
          <dt>Seasons</dt>
          <dd>{seasonSpan(node.first, node.last)}</dd>
        </div>
      </dl>

      <section className="partners">
        <h3>
          Partners <span className="count">{plural(totalTogether, 'entry', 'entries')}</span>
        </h3>
        {partners.length === 0 ? (
          <p className="empty">
            No partnerships with another {countryName} player in this dataset — partnerships with
            players from other countries are not included.
          </p>
        ) : (
          <ul>
            {partners.map((p) => (
              <li key={p.node.id}>
                <button type="button" onClick={() => onSelectPartner(p.node.id)}>
                  <span className="name">{p.node.name}</span>
                  <span className="meta">
                    <span className="tally">{p.t}</span>
                    <span className="span">{seasonSpan(p.f, p.l)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <a
        className="profile-link"
        href={playerProfileUrl(node.id)}
        target="_blank"
        rel="noopener noreferrer"
      >
        FIVB profile ↗
      </a>
    </aside>
  );
}
