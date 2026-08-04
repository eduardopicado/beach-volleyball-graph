import { describe, expect, it } from 'vitest';
import {
  buildLayout,
  edgeWidth,
  fitToView,
  MAX_RADIUS,
  MIN_RADIUS,
  pickLabels,
  radiusScale,
  settle,
  type LayoutNode,
} from './layout';
import type { GraphEdge, GraphNode } from '../schema';

const node = (id: number, tournaments = 10): GraphNode => ({
  id,
  name: `Player ${id}`,
  short: `P${id}`,
  tournaments,
  first: 2010,
  last: 2020,
});

const edge = (a: number, b: number, t = 1): GraphEdge => ({ a, b, t, f: 2010, l: 2020 });

describe('radiusScale', () => {
  it('is area-proportional: a quarter of the tournaments is half the radius offset', () => {
    const r = radiusScale(100);
    const offset = (t: number) => r(t) - MIN_RADIUS;
    expect(offset(25) / offset(100)).toBeCloseTo(0.5, 5);
  });

  it('clamps between the minimum and maximum radius', () => {
    const r = radiusScale(200);
    expect(r(0)).toBeCloseTo(r(1), 5); // zero is floored to one
    expect(r(200)).toBeGreaterThan(r(1));
    expect(r(200)).toBeCloseTo(MAX_RADIUS, 5);
    expect(r(1)).toBeGreaterThanOrEqual(MIN_RADIUS);
  });

  it('does not inflate a node whose count exceeds the stated maximum', () => {
    expect(radiusScale(200)(10_000)).toBeLessThanOrEqual(MAX_RADIUS);
  });

  it('never divides by zero when nobody has played a tournament', () => {
    expect(Number.isFinite(radiusScale(0)(0))).toBe(true);
  });
});

describe('edgeWidth', () => {
  it('grows with shared tournaments and stays bounded', () => {
    expect(edgeWidth(1, 100)).toBeLessThan(edgeWidth(50, 100));
    expect(edgeWidth(100, 100)).toBeCloseTo(6, 5);
    expect(edgeWidth(1, 1)).toBeCloseTo(6, 5);
  });
});

describe('buildLayout', () => {
  it('derives degree from distinct partners', () => {
    const { nodes } = buildLayout([node(1), node(2), node(3)], [edge(1, 2), edge(1, 3)]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get(1)!.degree).toBe(2);
    expect(byId.get(2)!.degree).toBe(1);
  });

  it('records neighbours in both directions', () => {
    const { neighbours } = buildLayout([node(1), node(2)], [edge(1, 2)]);
    expect([...neighbours.get(1)!]).toEqual([2]);
    expect([...neighbours.get(2)!]).toEqual([1]);
  });

  it('drops an edge that references a node outside the slice', () => {
    // Guards against a filtered slice leaving a dangling endpoint.
    const { links } = buildLayout([node(1), node(2)], [edge(1, 2), edge(1, 99)]);
    expect(links).toHaveLength(1);
  });

  it('gives isolated players a degree of zero rather than undefined', () => {
    const { nodes } = buildLayout([node(1), node(2)], []);
    expect(nodes.every((n) => n.degree === 0)).toBe(true);
  });
});

/** Place nodes at known coordinates without running the simulation. */
const placed = (coords: [number, number][], radius = 5): LayoutNode[] =>
  coords.map(([x, y], i) => ({
    ...node(i + 1),
    x,
    y,
    degree: 0,
    radius,
  }));

describe('fitToView', () => {
  it('centres and scales the graph down to fit', () => {
    const nodes = placed([
      [0, 0],
      [1000, 1000],
    ]);
    const view = fitToView(nodes, 400, 400, 20);
    for (const n of nodes) {
      const sx = n.x! * view.k + view.x;
      const sy = n.y! * view.k + view.y;
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(400);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(400);
    }
  });

  it('never magnifies a small graph past natural size', () => {
    const view = fitToView(placed([[0, 0], [10, 10]]), 1000, 1000);
    expect(view.k).toBeLessThanOrEqual(1);
  });

  it('accounts for node radius so edge circles are not clipped', () => {
    const nodes = placed([[0, 0], [100, 0]], 40);
    const view = fitToView(nodes, 300, 300, 0);
    const left = nodes[0]!.x! * view.k + view.x - 40 * view.k;
    expect(left).toBeGreaterThanOrEqual(-0.001);
  });

  it('returns an identity transform for degenerate input instead of NaN', () => {
    expect(fitToView([], 400, 400)).toEqual({ x: 0, y: 0, k: 1 });
    expect(fitToView(placed([[0, 0]]), 0, 0)).toEqual({ x: 0, y: 0, k: 1 });
  });

  it('handles every node sharing one position', () => {
    const view = fitToView(placed([[50, 50], [50, 50]]), 400, 400);
    expect(Number.isFinite(view.k)).toBe(true);
    expect(Number.isFinite(view.x)).toBe(true);
  });
});

describe('pickLabels', () => {
  const identity = { x: 0, y: 0, k: 1 };

  it('does not label two nodes whose labels would overlap', () => {
    // Same spot: only one label can be placed.
    const nodes = placed([
      [200, 200],
      [202, 200],
    ]);
    expect(pickLabels(nodes, identity, 400, 400).size).toBe(1);
  });

  it('labels nodes that are comfortably apart', () => {
    const nodes = placed([
      [60, 60],
      [60, 300],
      [300, 60],
    ]);
    expect(pickLabels(nodes, identity, 400, 400).size).toBe(3);
  });

  it('prefers the player with more tournaments when labels collide', () => {
    const nodes = placed([[200, 200], [202, 200]]);
    nodes[0]!.tournaments = 5;
    nodes[1]!.tournaments = 500;
    expect([...pickLabels(nodes, identity, 400, 400)]).toEqual([nodes[1]!.id]);
  });

  it('never exceeds the requested maximum', () => {
    const nodes = placed(Array.from({ length: 60 }, (_, i) => [40 + (i % 10) * 90, 40 + Math.floor(i / 10) * 90]));
    expect(pickLabels(nodes, identity, 1200, 800, 5).size).toBeLessThanOrEqual(5);
  });

  it('skips labels that would fall outside the canvas', () => {
    const nodes = placed([[-500, -500], [5000, 5000]]);
    expect(pickLabels(nodes, identity, 400, 400).size).toBe(0);
  });
});

describe('settle', () => {
  it('produces finite coordinates for every node', () => {
    const layout = buildLayout(
      [node(1), node(2), node(3), node(4)],
      [edge(1, 2, 5), edge(2, 3), edge(3, 4)],
    );
    settle(layout.simulation, 60);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });
});
