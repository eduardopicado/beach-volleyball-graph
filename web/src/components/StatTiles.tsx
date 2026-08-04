/**
 * Headline numbers for the current slice. These are stat tiles, not charts —
 * a bar chart of four unrelated totals would be four one-bar charts.
 */

import './StatTiles.css';

export interface Stat {
  label: string;
  value: string | number;
  detail?: string;
}

export function StatTiles({ stats, hero }: { stats: Stat[]; hero?: Stat }) {
  return (
    <div className="stat-tiles">
      {hero && (
        <div className="tile is-hero">
          <span className="label">{hero.label}</span>
          <span className="value">{hero.value}</span>
          {hero.detail && <span className="detail">{hero.detail}</span>}
        </div>
      )}
      {stats.map((stat) => (
        <div className="tile" key={stat.label}>
          <span className="label">{stat.label}</span>
          <span className="value">{stat.value}</span>
          {stat.detail && <span className="detail">{stat.detail}</span>}
        </div>
      ))}
    </div>
  );
}
