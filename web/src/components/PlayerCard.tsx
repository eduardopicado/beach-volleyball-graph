/**
 * Detail panel for the selected player.
 *
 * Photos come straight from FIVB's image service and 404 for players with none
 * on file, so the <img> is allowed to fail and an initials avatar takes over.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AwayPartner, Gender, GraphNode, PlayerDetail, SeasonTally } from '../schema';
import { playerPhotoUrl, playerProfileUrl, TIER_BADGE } from '../schema';
import {
  age,
  formatDate,
  formatDayMonth,
  formatFinish,
  formatMedals,
  initials,
  medalAriaLabel,
  plural,
  seasonSpan,
} from '../lib/format';
import { buildTimeline } from '../lib/timeline';
import { seasonEvents } from '../lib/results';
import { useResults } from '../lib/useResults';
import './PlayerCard.css';

export interface PartnerRow {
  node: GraphNode;
  /** Tournaments played together. */
  t: number;
  f: number;
  l: number;
  /** Per-season breakdown, ascending. Absent on data published before it existed. */
  s?: SeasonTally[];
}

/** An away partner, resolved against the manifest so it can be rendered. */
export interface AwayRow {
  partner: AwayPartner;
  countryName: string;
  flag: string;
  /** False when that slice was too small to publish — nothing to link to. */
  linkable: boolean;
}

interface Props {
  node: GraphNode;
  detail: PlayerDetail | undefined;
  partners: PartnerRow[];
  away: AwayRow[];
  /**
   * The slice the card is showing, taken from the loaded graph rather than the
   * app's selection: following an away partner sets the new country a render
   * before the new graph lands, and the results fetch has to follow the data,
   * not the intent.
   */
  country: string;
  gender: Gender;
  countryName: string;
  flag: string;
  /**
   * Every player in the slice, unfiltered — the "min events together" control
   * hides edges, and an expanded season still has to be able to name the
   * partner of an event whose edge is currently hidden.
   */
  names: ReadonlyMap<number, string>;
  onSelectPartner: (id: number) => void;
  onSelectAway: (partner: AwayPartner) => void;
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
  away,
  country,
  gender,
  countryName,
  flag,
  names,
  onSelectPartner,
  onSelectAway,
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
  // Both lists, because both are on the card. Counting only the graph's edges
  // made a player whose partners all competed elsewhere read "0 partners, 0
  // entries" directly above a list of six of them and a career of fifteen
  // tournaments — the vitals describing the graph while the rest of the card
  // described the player.
  const partnerCount = partners.length + away.length;
  const totalTogether =
    partners.reduce((sum, p) => sum + p.t, 0) + away.reduce((sum, a) => sum + a.partner.t, 0);

  const timeline = useMemo(() => buildTimeline(partners), [partners]);
  const [view, setView] = useState<'partners' | 'timeline'>('partners');
  // Slices published before the per-season field existed have nothing to draw,
  // so the switch hides rather than offering an empty view. Deliberately not
  // reset when the selected player changes: someone reading careers year by
  // year should stay in that mode as they click through partners.
  const canShowTimeline = timeline.length > 0;
  const showing = canShowTimeline ? view : 'partners';

  // --- expanding a season into its tournaments ------------------------------
  const [openSeasons, setOpenSeasons] = useState<ReadonlySet<number>>(new Set());
  // Raised by the first expansion and never lowered, which is what keeps the
  // fetched slice around as the reader clicks from player to player.
  const [wantResults, setWantResults] = useState(false);
  const results = useResults(country, gender, wantResults);

  // A different player's seasons are not this player's, so start them closed —
  // but leave `view` alone, so someone reading careers year by year stays in
  // the timeline as they click through.
  useEffect(() => setOpenSeasons(new Set()), [node.id]);

  const toggleSeason = useCallback((season: number) => {
    setWantResults(true);
    setOpenSeasons((open) => {
      const next = new Set(open);
      if (!next.delete(season)) next.add(season);
      return next;
    });
  }, []);

  const nameOf = useCallback(
    (id: number) =>
      names.get(id) ??
      (results.status === 'ready' ? (results.data.results.names[id] ?? null) : null),
    [names, results],
  );

  const entries = results.status === 'ready' ? results.data.results.players[node.id] : undefined;

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
          <dd>{partnerCount}</dd>
        </div>
        <div>
          <dt>Seasons</dt>
          <dd>{seasonSpan(node.first, node.last)}</dd>
        </div>
        {detail?.olympics && (
          <div>
            <dt>Olympics</dt>
            <dd aria-label={medalAriaLabel(detail.olympics)}>{formatMedals(detail.olympics)}</dd>
          </div>
        )}
        {detail?.worldChamps && (
          <div>
            <dt>Worlds</dt>
            <dd aria-label={medalAriaLabel(detail.worldChamps)}>{formatMedals(detail.worldChamps)}</dd>
          </div>
        )}
      </dl>

      <section className="partners">
        {/* Switch shares the heading's row rather than taking one of its own:
            the card is sized to the graph beside it, so on a short window
            every row this header costs comes straight out of the list. */}
        <div className="partners-head">
          <h3>
            {showing === 'timeline' ? 'Timeline' : 'Partners'}{' '}
            <span className="count">{plural(totalTogether, 'entry', 'entries')}</span>
          </h3>

          {canShowTimeline && (
            <div className="view-switch" role="group" aria-label="Partner view">
              <button
                type="button"
                aria-pressed={showing === 'partners'}
                onClick={() => setView('partners')}
              >
                Partners
              </button>
              <button
                type="button"
                aria-pressed={showing === 'timeline'}
                onClick={() => setView('timeline')}
              >
                Timeline
              </button>
            </div>
          )}
        </div>

        {partners.length === 0 ? (
          <p className="empty">
            {/* Says where the partnerships *are*, not just where they are not.
                The previous wording ended on "none of them appear in the
                ${countryName} graph" with a list of them immediately below it,
                which reads as a contradiction rather than an explanation. */}
            {away.length > 0
              ? `None of these partnerships appear in the ${countryName} graph, which only links players from the same federation. See Other federations below.`
              : `No partnerships on record for this player.`}
          </p>
        ) : showing === 'timeline' ? (
          <ol className="timeline">
            {timeline.map((row) => {
              const open = openSeasons.has(row.season);
              // The season's real calendar, not the graph's view of it: the
              // partner rows above are subject to the "min events together"
              // filter, and once a year is open the honest answer to "what
              // happened in it" is every tournament that did.
              const events = open
                ? seasonEvents(entries, results.status === 'ready' ? results.data.tournaments : {}, row.season, nameOf)
                : [];
              const panelId = `season-${node.id}-${row.season}`;
              return (
                <li key={row.season}>
                  {/* The year sits in a gutter beside its partners rather than
                      on a line of its own: one year with two names against it
                      is the shape worth seeing, and it keeps a 20-season career
                      readable without turning into a wall of headings. */}
                  <button
                    type="button"
                    className="season"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => toggleSeason(row.season)}
                  >
                    <span className="year">{row.season}</span>
                    {/* Open, this counts the events listed below; closed, the
                        tournaments behind the partner rows — and then only when
                        it says something those rows don't, since with a single
                        partner it is just their tally again. */}
                    {open ? (
                      <span className="total" aria-label={plural(events.length, 'tournament')}>
                        {events.length}
                      </span>
                    ) : (
                      row.partners.length > 1 && (
                        <span className="total" aria-label={plural(row.total, 'tournament', 'tournaments')}>
                          {row.total}
                        </span>
                      )
                    )}
                  </button>

                  <div id={panelId}>
                    {!open ? (
                      <ul>
                        {row.partners.map((p) => (
                          <li key={p.node.id}>
                            <button type="button" onClick={() => onSelectPartner(p.node.id)}>
                              <span className="name">{p.node.name}</span>
                              <span className="tally">{p.t}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : results.status === 'failed' ? (
                      <p className="events-note">Could not load this season's tournaments.</p>
                    ) : events.length === 0 ? (
                      <p className="events-note">
                        {results.status === 'ready' ? 'No tournament detail for this season.' : 'Loading…'}
                      </p>
                    ) : (
                      <ol className="events">
                        {events.map((event) => {
                          const finish = formatFinish(event.rank);
                          const when = formatDayMonth(event.date);
                          // Only for the tiers that are not the ordinary week
                          // on tour — see TIER_BADGE.
                          const badge = TIER_BADGE[event.tier];
                          return (
                            <li key={`${event.no}-${event.partnerId}`}>
                              <p className="event">
                                <span className="name">{event.name}</span>
                                <span
                                  className={`finish${event.rank >= 1 && event.rank <= 3 ? ' podium' : ''}`}
                                >
                                  <span aria-hidden="true">{finish.text}</span>
                                  <span className="sr-only">{finish.label}</span>
                                </span>
                              </p>
                              <p className="event-meta">
                                {when && <span>{when}</span>}
                                {badge && <span className="badge">{badge}</span>}
                                {event.partner && <span className="with">{event.partner}</span>}
                              </p>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
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

        {away.length > 0 && (
          <div className="away">
            {/* Named rather than hidden: the graph deliberately holds only
                same-federation pairs, and a player who moved keeps their new
                country while every partner stays behind. Without this the card
                reads as though they never had a partner at all. */}
            <h4>Other federations</h4>
            <ul>
              {away.map(({ partner, countryName: partnerCountry, flag: partnerFlag, linkable }) => (
                <li key={partner.id}>
                  {linkable ? (
                    <button type="button" onClick={() => onSelectAway(partner)}>
                      <span className="name">{partner.name}</span>
                      <span className="meta">
                        <span className="fed" title={partnerCountry}>
                          <span aria-hidden="true">{partnerFlag}</span>
                          <span className="sr-only">{partnerCountry}</span>
                        </span>
                        <span className="tally">{partner.t}</span>
                        <span className="span">{seasonSpan(partner.f, partner.l)}</span>
                      </span>
                    </button>
                  ) : (
                    // That slice has fewer than two players, so it was never
                    // published — the partner is real, the page is not.
                    <span className="unlinked">
                      <span className="name">{partner.name}</span>
                      <span className="meta">
                        <span className="fed" title={partnerCountry}>
                          <span aria-hidden="true">{partnerFlag}</span>
                          <span className="sr-only">{partnerCountry}</span>
                        </span>
                        <span className="tally">{partner.t}</span>
                        <span className="span">{seasonSpan(partner.f, partner.l)}</span>
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
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
