import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Gender, GraphFile, Manifest, PlayersFile } from './schema';
import { GENDERS } from './schema';
import { fetchGraph, fetchManifest, fetchPlayers } from './lib/api';
import { flagEmoji, plural } from './lib/format';
import { Controls } from './components/Controls';
import { PartnershipGraph } from './components/PartnershipGraph';
import { PlayerCard, type PartnerRow } from './components/PlayerCard';
import { StatTiles, type Stat } from './components/StatTiles';
import { TableView, type TableRow } from './components/TableView';
import { ThemeToggle } from './components/ThemeToggle';
import './App.css';

/** Opening view: the country with the most players. */
const DEFAULT_COUNTRY = 'BRA';

/** Read/write the current slice in the URL so a view is linkable. */
function readUrl(): { country: string | null; gender: Gender | null; player: number | null } {
  const params = new URLSearchParams(location.search);
  const gender = params.get('gender');
  const player = Number(params.get('player'));
  return {
    country: params.get('country'),
    gender: gender === 'M' || gender === 'W' ? gender : null,
    player: Number.isFinite(player) && player > 0 ? player : null,
  };
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
  const [search, setSearch] = useState('');
  const [layoutKey, setLayoutKey] = useState(0);

  // --- manifest ------------------------------------------------------------
  useEffect(() => {
    fetchManifest()
      .then((m) => {
        setManifest(m);
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

  // --- URL sync ------------------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('country', country);
    params.set('gender', gender);
    if (selectedId) params.set('player', String(selectedId));
    history.replaceState(null, '', `?${params}`);
  }, [country, gender, selectedId]);

  // --- derived -------------------------------------------------------------
  const nodesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    [graph],
  );

  const partnersByPlayer = useMemo(() => {
    const map = new Map<number, PartnerRow[]>();
    for (const edge of graph?.edges ?? []) {
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
  }, [graph, nodesById]);

  const detailsById = useMemo(
    () => new Map((details?.players ?? []).map((p) => [p.id, p])),
    [details],
  );

  const countryEntry = manifest?.countries.find((c) => c.code === country);
  const flag = flagEmoji(isoFromCountryName(manifest, country));

  const tableRows: TableRow[] = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (graph?.nodes ?? [])
      .filter((n) => !term || n.name.toLowerCase().includes(term))
      .map((n) => {
        const partners = partnersByPlayer.get(n.id) ?? [];
        return { ...n, partners: partners.length, topPartner: partners[0]?.node.name ?? null };
      });
  }, [graph, partnersByPlayer, search]);

  const stats: Stat[] = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];
    if (nodes.length === 0) return [];
    const degrees = nodes.map((n) => (partnersByPlayer.get(n.id)?.length ?? 0));
    const avg = degrees.reduce((a, b) => a + b, 0) / nodes.length;
    const longest = [...edges].sort((a, b) => b.t - a.t)[0];
    const longestNames = longest
      ? `${nodesById.get(longest.a)?.name ?? '?'} & ${nodesById.get(longest.b)?.name ?? '?'}`
      : '—';
    return [
      { label: 'Partnerships', value: edges.length.toLocaleString() },
      { label: 'Avg. partners', value: avg.toFixed(1), detail: 'per player' },
      {
        label: 'Longest pairing',
        value: longest ? `${longest.t}` : '—',
        detail: longest ? `${longestNames} · ${longest.f}–${longest.l}` : undefined,
      },
    ];
  }, [graph, partnersByPlayer, nodesById]);

  const hero: Stat | undefined = graph
    ? { label: 'Players', value: graph.nodes.length.toLocaleString(), detail: `${graph.countryName}` }
    : undefined;

  const selectedNode = selectedId === null ? null : (nodesById.get(selectedId) ?? null);

  const selectPlayer = useCallback((id: number | null) => setSelectedId(id), []);

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
            setSearch('');
          }}
          onGender={(g) => {
            setGender(g);
            setSelectedId(null);
          }}
          search={search}
          onSearch={setSearch}
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
              </p>
            </div>
            <button type="button" className="relayout" onClick={() => setLayoutKey((k) => k + 1)}>
              Re-tangle
            </button>
          </div>

          {graph && graph.nodes.length > 0 ? (
            <PartnershipGraph
              nodes={graph.nodes}
              edges={graph.edges}
              selectedId={selectedId}
              onSelect={selectPlayer}
              layoutKey={layoutKey}
            />
          ) : (
            <div className="graph-empty">No players for this selection.</div>
          )}

          {selectedNode && (
            <div className="card-slot">
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
            <p className="muted">
              {plural(tableRows.length, 'player')}
              {search && ` matching “${search}”`}
            </p>
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

/**
 * The manifest carries display names, not ISO codes, so the flag is derived by
 * matching the display name back to a region code. Cheap, and avoids widening
 * the published contract for one glyph.
 */
const REGION_CODES = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const map = new Map<string, string>();
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      try {
        const name = names.of(code);
        if (name && name !== code) map.set(name.toLowerCase(), code);
      } catch {
        /* not a region */
      }
    }
  }
  return map;
})();

function isoFromCountryName(manifest: Manifest | null, code: string): string | null {
  const name = manifest?.countries.find((c) => c.code === code)?.name;
  return name ? (REGION_CODES.get(name.toLowerCase()) ?? null) : null;
}
