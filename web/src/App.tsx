import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Gender, GraphFile, Manifest, PlayersFile } from './schema';
import { GENDERS } from './schema';
import { fetchGraph, fetchManifest, fetchPlayers } from './lib/api';
import { flagEmoji, formatMedals, plural } from './lib/format';
import { Controls, MIN_TOGETHER_OPTIONS } from './components/Controls';
import { parseMinTogether } from './lib/params';
import type { GraphEdge, GraphNode } from './schema';
import { GENDER_LABEL } from './schema';
import { sliceSlug, slugFromPath } from './lib/slug';
import { PartnershipGraph } from './components/PartnershipGraph';
import { PlayerCard, type PartnerRow } from './components/PlayerCard';
import { StatTiles, type Stat } from './components/StatTiles';
import { TableView, type TableRow } from './components/TableView';
import { ThemeToggle } from './components/ThemeToggle';
import './App.css';

/** Opening view: the country with the most players. */
const DEFAULT_COUNTRY = 'BRA';

/** Read/write the current slice in the URL so a view is linkable. */
function readUrl(): {
  slug: string | null;
  country: string | null;
  gender: Gender | null;
  player: number | null;
  min: number | null;
} {
  const params = new URLSearchParams(location.search);
  const gender = params.get('gender');
  const player = Number(params.get('player'));
  return {
    // The prerendered path ("/brazil-men/") is the canonical form; the query
    // parameters stay supported so older links keep working.
    slug: slugFromPath(location.pathname, import.meta.env.BASE_URL),
    country: params.get('country'),
    gender: gender === 'M' || gender === 'W' ? gender : null,
    player: Number.isFinite(player) && player > 0 ? player : null,
    min: parseMinTogether(params.get('min'), MIN_TOGETHER_OPTIONS),
  };
}

/** Point a <link> or <meta> tag in the document head at a new value. */
function setHeadTag(selector: string, attr: 'href' | 'content', value: string) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

export default function App() {
  const initial = useMemo(readUrl, []);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState(initial.country ?? DEFAULT_COUNTRY);
  const [gender, setGender] = useState<Gender>(initial.gender ?? 'M');
  const [graph, setGraph] = useState<GraphFile | null>(null);
  const [details, setDetails] = useState<PlayersFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(initial.player);
  const [layoutKey, setLayoutKey] = useState(0);
  /** Hide partnerships below this many shared tournaments. 1 = show all. */
  const [minTogether, setMinTogether] = useState(initial.min ?? 1);

  // --- manifest ------------------------------------------------------------
  useEffect(() => {
    fetchManifest()
      .then((m) => {
        setManifest(m);

        // A prerendered path wins over the query string: it is the canonical URL.
        if (initial.slug) {
          for (const c of m.countries) {
            for (const g of GENDERS) {
              if (c.genders[g] && sliceSlug(c.name, g) === initial.slug) {
                setCountry(c.code);
                setGender(g);
                return;
              }
            }
          }
        }
        // Fall back if the requested slice does not exist in this build.
        const known = m.countries.find((c) => c.code === country);
        if (!known) {
          const fallback = m.countries.find((c) => c.code === DEFAULT_COUNTRY) ?? m.countries[0];
          if (fallback) setCountry(fallback.code);
        }
      })
      .catch((e: Error) =>
        setError(
          `Could not load the data index (${e.message}). If you are running locally, generate it first with \`npm run ingest\`.`,
        ),
      );
    // Country is intentionally read once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep gender valid for the chosen country.
  useEffect(() => {
    if (!manifest) return;
    const entry = manifest.countries.find((c) => c.code === country);
    if (entry && !entry.genders[gender]) {
      const other = GENDERS.find((g) => entry.genders[g]);
      if (other) setGender(other);
    }
  }, [manifest, country, gender]);

  // --- slice ---------------------------------------------------------------
  useEffect(() => {
    if (!manifest) return;
    const entry = manifest.countries.find((c) => c.code === country);
    if (!entry?.genders[gender]) return;

    let cancelled = false;
    setLoading(true);
    Promise.all([fetchGraph(country, gender), fetchPlayers(country, gender)])
      .then(([g, p]) => {
        if (cancelled) return;
        setGraph(g);
        setDetails(p);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(`Could not load ${country}-${gender}: ${e.message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [manifest, country, gender]);

  // --- URL and document head sync -----------------------------------------
  useEffect(() => {
    if (!manifest) return;
    const entry = manifest.countries.find((c) => c.code === country);
    if (!entry) return;

    // Keep the address bar on the canonical prerendered path, so a copied link
    // matches the URL that is actually indexed.
    const base = import.meta.env.BASE_URL;
    const params = new URLSearchParams();
    if (minTogether > 1) params.set('min', String(minTogether));
    if (selectedId) params.set('player', String(selectedId));
    const query = params.toString();
    const url = `${base}${sliceSlug(entry.name, gender)}/${query ? `?${query}` : ''}`;
    history.replaceState(null, '', url);

    const label = GENDER_LABEL[gender];
    const counts = entry.genders[gender];
    const title = `${entry.name} ${label} — Beach Volleyball Partnership Graph`;
    const description = `Every ${label.toLowerCase()}'s beach volleyball player from ${entry.name} who has competed on the FIVB World Tour, Beach Pro Tour, World Championships or Olympic Games — ${counts?.nodes ?? 0} players and ${counts?.edges ?? 0} partnerships, ${manifest.seasons.from}–${manifest.seasons.to}.`;

    document.title = title;
    setHeadTag('link[rel="canonical"]', 'href', new URL(url, location.origin).toString());
    setHeadTag('meta[name="description"]', 'content', description);
    setHeadTag('meta[property="og:title"]', 'content', title);
    setHeadTag('meta[property="og:description"]', 'content', description);
    setHeadTag('meta[property="og:url"]', 'content', new URL(url, location.origin).toString());
  }, [manifest, country, gender, selectedId, minTogether]);

  // --- derived -------------------------------------------------------------
  /**
   * The partnership-strength filter. Edges below the threshold are dropped, and
   * players left with no remaining partnership drop out with them — otherwise
   * raising the threshold just leaves a field of unconnected dots.
   *
   * Node size still reflects each player's full career tournament count: that
   * is a property of the player, not of the edges being shown.
   */
  const { nodes: visibleNodes, edges: visibleEdges } = useMemo((): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } => {
    const allNodes = graph?.nodes ?? [];
    const allEdges = graph?.edges ?? [];
    if (minTogether <= 1) return { nodes: allNodes, edges: allEdges };

    const edges = allEdges.filter((e) => e.t >= minTogether);
    const connected = new Set<number>();
    for (const e of edges) {
      connected.add(e.a);
      connected.add(e.b);
    }
    return { nodes: allNodes.filter((n) => connected.has(n.id)), edges };
  }, [graph, minTogether]);

  const nodesById = useMemo(
    () => new Map(visibleNodes.map((n) => [n.id, n])),
    [visibleNodes],
  );

  const partnersByPlayer = useMemo(() => {
    const map = new Map<number, PartnerRow[]>();
    for (const edge of visibleEdges) {
      const a = nodesById.get(edge.a);
      const b = nodesById.get(edge.b);
      if (!a || !b) continue;
      if (!map.has(edge.a)) map.set(edge.a, []);
      if (!map.has(edge.b)) map.set(edge.b, []);
      map.get(edge.a)!.push({ node: b, t: edge.t, f: edge.f, l: edge.l });
      map.get(edge.b)!.push({ node: a, t: edge.t, f: edge.f, l: edge.l });
    }
    for (const list of map.values()) list.sort((x, y) => y.t - x.t || x.node.name.localeCompare(y.node.name));
    return map;
  }, [visibleEdges, nodesById]);

  const detailsById = useMemo(
    () => new Map((details?.players ?? []).map((p) => [p.id, p])),
    [details],
  );

  const countryEntry = manifest?.countries.find((c) => c.code === country);
  const flag = flagEmoji(countryEntry?.iso2, countryEntry?.code);

  const tableRows: TableRow[] = useMemo(
    () =>
      visibleNodes.map((n) => {
        const partners = partnersByPlayer.get(n.id) ?? [];
        return { ...n, partners: partners.length, topPartner: partners[0]?.node.name ?? null };
      }),
    [visibleNodes, partnersByPlayer],
  );

  const stats: Stat[] = useMemo(() => {
    const nodes = visibleNodes;
    const edges = visibleEdges;
    if (nodes.length === 0) return [];

    const result: Stat[] = [];

    // A country-wide bonus fact, not about any specific pairing: every
    // player's medals summed for the whole slice, deliberately unfiltered by
    // the "min events together" slider above -- a medal already won
    // shouldn't disappear because that slider hid a player's current edges.
    // Kept right after the player count (rather than at the end, with the
    // partnership stats) since it describes the country, not the graph.
    // Olympic and World Championships tallies are kept separate, same as on
    // the player card: they are not the same prestige, and merging them
    // would hide which is which.
    const oly = { gold: 0, silver: 0, bronze: 0 };
    const wch = { gold: 0, silver: 0, bronze: 0 };
    for (const p of details?.players ?? []) {
      if (p.olympics) {
        oly.gold += p.olympics.gold;
        oly.silver += p.olympics.silver;
        oly.bronze += p.olympics.bronze;
      }
      if (p.worldChamps) {
        wch.gold += p.worldChamps.gold;
        wch.silver += p.worldChamps.silver;
        wch.bronze += p.worldChamps.bronze;
      }
    }
    if (oly.gold + oly.silver + oly.bronze > 0) {
      result.push({ label: 'Olympic medals', value: formatMedals(oly) });
    }
    if (wch.gold + wch.silver + wch.bronze > 0) {
      result.push({ label: 'World Champs medals', value: formatMedals(wch) });
    }

    const degrees = nodes.map((n) => (partnersByPlayer.get(n.id)?.length ?? 0));
    const avg = degrees.reduce((a, b) => a + b, 0) / nodes.length;
    const longest = [...edges].sort((a, b) => b.t - a.t)[0];
    const longestNames = longest
      ? `${nodesById.get(longest.a)?.name ?? '?'} & ${nodesById.get(longest.b)?.name ?? '?'}`
      : '—';
    result.push(
      { label: 'Partnerships', value: edges.length.toLocaleString() },
      { label: 'Avg. partners', value: avg.toFixed(1), detail: 'per player' },
      {
        label: 'Longest pairing',
        value: longest ? `${longest.t}` : '—',
        detail: longest ? `${longestNames} · ${longest.f}–${longest.l}` : undefined,
      },
    );

    return result;
  }, [visibleNodes, visibleEdges, partnersByPlayer, nodesById, details]);

  const totalNodes = graph?.nodes.length ?? 0;
  const hidden = totalNodes - visibleNodes.length;
  const hero: Stat | undefined = graph
    ? {
        label: 'Players',
        value: visibleNodes.length.toLocaleString(),
        detail: hidden > 0 ? `of ${totalNodes.toLocaleString()} · ${graph.countryName}` : graph.countryName,
      }
    : undefined;

  const selectedNode = selectedId === null ? null : (nodesById.get(selectedId) ?? null);

  const selectPlayer = useCallback((id: number | null) => setSelectedId(id), []);

  /**
   * Selection from the search box, which unlike the graph, the table and the
   * partner list can reach a player the strength filter is currently hiding.
   *
   * Searching the visible set only would answer "no players match" for someone
   * who is in this country's data and merely filtered out — indistinguishable
   * from a typo, and unfixable without first guessing that the threshold is to
   * blame. So the search covers the whole slice and picking a hidden player
   * drops the threshold back to "All" to reveal them. The segmented control
   * moves with it, so the change is visible rather than silent.
   */
  const jumpToPlayer = useCallback(
    (id: number) => {
      if (!nodesById.has(id)) setMinTogether(1);
      setSelectedId(id);
    },
    [nodesById],
  );

  // Matches the player card's height to the graph's actual rendered height
  // (see PartnershipGraph's onSize doc comment for why this can't be plain
  // CSS grid stretch).
  const [graphHeight, setGraphHeight] = useState<number | null>(null);
  const onGraphSize = useCallback((size: { height: number }) => setGraphHeight(size.height), []);

  // Clear a selection that does not exist in the newly loaded slice.
  useEffect(() => {
    if (selectedId !== null && graph && !nodesById.has(selectedId)) setSelectedId(null);
  }, [graph, nodesById, selectedId]);

  if (error && !graph) {
    return (
      <div className="app">
        <div className="error-panel" role="alert">
          <h1>Data unavailable</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>Beach Volleyball Partnership Graph</h1>
          <p>
            Who has played with whom in FIVB international beach volleyball — the World Tour, Beach Pro
            Tour, World Championships and Olympic Games.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {manifest && (
        <Controls
          manifest={manifest}
          country={country}
          gender={gender}
          onCountry={(code) => {
            setCountry(code);
            setSelectedId(null);
          }}
          onGender={(g) => {
            setGender(g);
            setSelectedId(null);
          }}
          minTogether={minTogether}
          onMinTogether={setMinTogether}
          players={graph?.nodes ?? []}
          onSelectPlayer={jumpToPlayer}
        />
      )}

      {/* Refetch keeps the frame: the previous render stays, dimmed. */}
      <main className={loading ? 'is-loading' : ''}>
        <StatTiles stats={stats} hero={hero} />

        <section className="graph-section">
          <div className="section-head">
            <div>
              <h2>
                {countryEntry?.name ?? country} · {gender === 'M' ? 'Men' : 'Women'}
              </h2>
              <p className="legend">
                <span className="key">
                  <svg width="30" height="12" aria-hidden="true">
                    <circle cx="6" cy="6" r="3" className="key-dot" />
                    <circle cx="21" cy="6" r="6" className="key-dot" />
                  </svg>
                  Circle size = tournaments entered
                </span>
                <span className="key">
                  <svg width="22" height="12" aria-hidden="true">
                    <line x1="2" y1="6" x2="20" y2="6" className="key-line" strokeWidth="1.5" />
                  </svg>
                  Line thickness = events played together
                </span>
                {hidden > 0 && (
                  <span className="key filtered">
                    Showing pairs with {minTogether}+ events together · {hidden.toLocaleString()}{' '}
                    {hidden === 1 ? 'player' : 'players'} hidden
                  </span>
                )}
              </p>
            </div>
            <button type="button" className="relayout" onClick={() => setLayoutKey((k) => k + 1)}>
              Re-tangle
            </button>
          </div>

          {visibleNodes.length > 0 ? (
            <PartnershipGraph
              nodes={visibleNodes}
              edges={visibleEdges}
              selectedId={selectedId}
              onSelect={selectPlayer}
              layoutKey={layoutKey}
              onSize={onGraphSize}
            />
          ) : (
            <div className="graph-empty">
              {totalNodes > 0
                ? `No partnership here reaches ${minTogether} shared tournaments.`
                : 'No players for this selection.'}
            </div>
          )}

          {selectedNode && (
            <div className="card-slot" style={graphHeight ? { height: graphHeight } : undefined}>
              <PlayerCard
                node={selectedNode}
                detail={detailsById.get(selectedNode.id)}
                partners={partnersByPlayer.get(selectedNode.id) ?? []}
                countryName={countryEntry?.name ?? country}
                flag={flag}
                onSelectPartner={selectPlayer}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}
        </section>

        <section className="table-section">
          <div className="section-head">
            <h2>All players</h2>
            <p className="muted">{plural(tableRows.length, 'player')}</p>
          </div>
          <TableView rows={tableRows} selectedId={selectedId} onSelect={selectPlayer} />
        </section>
      </main>

      <footer>
        <p>
          Source: <a href="https://www.fivb.org/VisSDK/VisWebService/" target="_blank" rel="noopener noreferrer">FIVB VIS Web Service</a>.
          {manifest && ` Rebuilt weekly · ${manifest.totals.partnerships.toLocaleString()} partnerships across ${manifest.totals.players.toLocaleString()} players.`}
        </p>
        <p className="caveat">
          Partnerships are counted per tournament entry. Only pairs where both players represent the
          same federation appear in a country’s graph.
        </p>
      </footer>
    </div>
  );
}

