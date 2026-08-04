/**
 * The table twin of the graph.
 *
 * Every value the graph encodes visually — size, degree, season span — is
 * readable here without colour, hover or a pointer. Sorting is client-side and
 * the whole slice is present, so nothing is gated behind an interaction.
 */

import { useMemo, useState } from 'react';
import type { GraphNode } from '../schema';
import { seasonSpan } from '../lib/format';
import './TableView.css';

export interface TableRow extends GraphNode {
  partners: number;
  /** Most frequent partner, for context. */
  topPartner: string | null;
}

type SortKey = 'name' | 'tournaments' | 'partners' | 'last';

interface Props {
  rows: TableRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Player', numeric: false },
  { key: 'tournaments', label: 'Tournaments', numeric: true },
  { key: 'partners', label: 'Partners', numeric: true },
  { key: 'last', label: 'Seasons', numeric: true },
];

export function TableView({ rows, selectedId, onSelect }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'tournaments', desc: true });

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sort.key === 'name') return dir * a.name.localeCompare(b.name);
      if (sort.key === 'last') return dir * (a.last - b.last || a.first - b.first);
      return dir * (a[sort.key] - b[sort.key]) || a.name.localeCompare(b.name);
    });
  }, [rows, sort]);

  const toggle = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== 'name' }));

  return (
    <div className="table-view">
      <table>
        <caption className="sr-only">
          Every player in the current selection, with tournaments entered, distinct partners and the
          seasons they were active.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? 'num' : ''}
                aria-sort={sort.key === col.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
              >
                <button type="button" onClick={() => toggle(col.key)}>
                  {col.label}
                  <span className="arrow" aria-hidden="true">
                    {sort.key === col.key ? (sort.desc ? '▾' : '▴') : ''}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col">Most frequent partner</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.id}
              className={row.id === selectedId ? 'is-selected' : ''}
              onClick={() => onSelect(row.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(row.id);
              }}
            >
              <td>{row.name}</td>
              <td className="num">{row.tournaments}</td>
              <td className="num">{row.partners}</td>
              <td className="num">{seasonSpan(row.first, row.last)}</td>
              <td className="muted">{row.topPartner ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <p className="empty">No players match the current filters.</p>}
    </div>
  );
}
