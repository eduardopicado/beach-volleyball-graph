/**
 * The graph canvas.
 *
 * React owns the SVG structure (one <line> per partnership, one <g> per player)
 * and never re-renders it during simulation. The force ticks write x/y straight
 * to the DOM through refs — re-rendering ~1,500 elements at 60fps through React
 * would drop frames on the larger countries.
 *
 * Selection and hover only toggle CSS classes, which is cheap enough to go
 * through React normally.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge, GraphNode } from '../schema';
import {
  buildLayout,
  fitToView,
  pickLabels,
  settle,
  type LayoutLink,
  type LayoutNode,
} from '../graph/layout';
import { seasonSpan, plural } from '../lib/format';
import './PartnershipGraph.css';

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Bumped by the parent to re-run the layout (e.g. "re-tangle" button). */
  layoutKey: number;
}

interface Hover {
  node: LayoutNode;
  x: number;
  y: number;
}

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Upper bound on automatically placed labels; collision thins it further. */
const MAX_LABELS = 16;

export function PartnershipGraph({ nodes, edges, selectedId, onSelect, layoutKey }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SVGGElement>(null);
  const nodeEls = useRef(new Map<number, SVGGElement>());
  const linkEls = useRef<(SVGLineElement | null)[]>([]);
  const [size, setSize] = useState({ width: 900, height: 620 });
  // The simulation callbacks outlive any single render, so they read the
  // container size through a ref — otherwise a resize mid-simulation fits the
  // graph to whatever the size was when the layout was built.
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [hover, setHover] = useState<Hover | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // --- responsive sizing ---------------------------------------------------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The layout has its own coordinate space, so it does not depend on viewport
  // size and a resize never restarts the simulation.
  const layout = useMemo(() => buildLayout(nodes, edges), [nodes, edges, layoutKey]);

  const { neighbours } = layout;
  const [labelled, setLabelled] = useState<Set<number>>(() => new Set());

  // Once the reader pans or zooms, stop auto-framing and leave the view alone.
  const userAdjusted = useRef(false);
  useEffect(() => {
    userAdjusted.current = false;
  }, [layout]);

  // --- run the simulation --------------------------------------------------
  useEffect(() => {
    const { simulation } = layout;
    let frame = 0;

    const applyView = (view: { x: number; y: number; k: number }) => {
      viewRef.current?.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    };

    const paint = () => {
      for (let i = 0; i < layout.links.length; i++) {
        const el = linkEls.current[i];
        const link = layout.links[i];
        if (!el || !link) continue;
        const s = link.source as LayoutNode;
        const t = link.target as LayoutNode;
        el.setAttribute('x1', String(s.x ?? 0));
        el.setAttribute('y1', String(s.y ?? 0));
        el.setAttribute('x2', String(t.x ?? 0));
        el.setAttribute('y2', String(t.y ?? 0));
      }
      for (const node of layout.nodes) {
        const el = nodeEls.current.get(node.id);
        if (el) el.setAttribute('transform', `translate(${node.x ?? 0},${node.y ?? 0})`);
      }
      // Keep the whole graph framed while it expands, or the reader spends the
      // animation looking at a zoomed-in corner of it.
      if (!userAdjusted.current && frame++ % 5 === 0) {
        const { width, height } = sizeRef.current;
        applyView(fitToView(layout.nodes, width, height));
      }
    };

    // Once the graph stops moving, frame it and decide which labels fit.
    const finish = () => {
      const { width, height } = sizeRef.current;
      const view = userAdjusted.current
        ? transformRef.current
        : fitToView(layout.nodes, width, height);
      if (!userAdjusted.current) {
        setTransform(view);
        applyView(view);
      }
      setLabelled(pickLabels(layout.nodes, view, width, height, MAX_LABELS));
    };

    // Warm the layout up off-screen so the first painted frame is already
    // structured, rather than an exploding ball of nodes at the centre.
    simulation.stop();
    for (let i = 0; i < 130; i++) simulation.tick();
    paint();

    if (prefersReducedMotion()) {
      settle(simulation, 200);
      paint();
      finish();
      return () => simulation.stop();
    }
    simulation.on('tick', paint);
    simulation.on('end', finish);
    simulation.alpha(0.6).restart();
    return () => {
      simulation.on('tick', null);
      simulation.on('end', null);
      simulation.stop();
    };
    // `size` is read only when the simulation ends; re-fitting on resize is
    // handled separately so a drag of the window doesn't restart the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Re-frame (but never re-simulate) when the container resizes.
  useEffect(() => {
    if (userAdjusted.current) return;
    if (layout.simulation.alpha() > layout.simulation.alphaMin()) return;
    const view = fitToView(layout.nodes, size.width, size.height);
    setTransform(view);
    setLabelled(pickLabels(layout.nodes, view, size.width, size.height, MAX_LABELS));
  }, [layout, size]);

  // --- pan & zoom ----------------------------------------------------------
  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('[data-node]')) return; // let node clicks through
    userAdjusted.current = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = transformRef.current;
    const svg = event.currentTarget;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-panning');

    const move = (e: PointerEvent) => {
      setTransform({ ...start, x: start.x + (e.clientX - startX), y: start.y + (e.clientY - startY) });
    };
    const up = () => {
      svg.classList.remove('is-panning');
      svg.releasePointerCapture(event.pointerId);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    userAdjusted.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    setTransform((prev) => {
      const k = Math.min(4, Math.max(0.25, prev.k * Math.exp(-event.deltaY * 0.0015)));
      // Keep the point under the cursor fixed while scaling.
      return { k, x: px - ((px - prev.x) / prev.k) * k, y: py - ((py - prev.y) / prev.k) * k };
    });
  }, []);

  const zoomBy = (factor: number) => {
    userAdjusted.current = true;
    setTransform((prev) => {
      const k = Math.min(4, Math.max(0.25, prev.k * factor));
      const cx = size.width / 2;
      const cy = size.height / 2;
      return { k, x: cx - ((cx - prev.x) / prev.k) * k, y: cy - ((cy - prev.y) / prev.k) * k };
    });
  };

  // --- highlight state -----------------------------------------------------
  const activeId = hover?.node.id ?? selectedId;
  const activeNeighbours = activeId === null ? null : (neighbours.get(activeId) ?? new Set<number>());

  const nodeClass = (node: LayoutNode) => {
    if (activeId === null) return 'node';
    if (node.id === activeId) return 'node is-active';
    if (activeNeighbours?.has(node.id)) return 'node is-partner';
    return 'node is-dimmed';
  };

  const linkClass = (link: LayoutLink) => {
    if (activeId === null) return 'link';
    const s = (link.source as LayoutNode).id;
    const t = (link.target as LayoutNode).id;
    return s === activeId || t === activeId ? 'link is-active' : 'link is-dimmed';
  };

  const showLabel = (node: LayoutNode) =>
    labelled.has(node.id) ||
    node.id === activeId ||
    (activeNeighbours?.has(node.id) ?? false);

  // Position the tooltip from the node's simulation coordinates rather than the
  // pointer, so it stays anchored to the mark on keyboard focus too.
  const handleHover = (node: LayoutNode) => () => {
    const t = transformRef.current;
    setHover({ node, x: (node.x ?? 0) * t.k + t.x, y: (node.y ?? 0) * t.k + t.y });
  };

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <svg
        className="graph"
        width={size.width}
        height={size.height}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
        role="group"
        aria-label={`Partnership graph: ${plural(nodes.length, 'player')}, ${plural(edges.length, 'partnership')}. Use the table view below for a screen-reader friendly listing.`}
      >
        <g ref={viewRef} transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          <g className="links">
            {layout.links.map((link, i) => (
              <line
                key={`${(link.source as LayoutNode).id}-${(link.target as LayoutNode).id}`}
                ref={(el) => {
                  linkEls.current[i] = el;
                }}
                className={linkClass(link)}
                strokeWidth={link.width}
              />
            ))}
          </g>
          <g className="nodes">
            {layout.nodes.map((node) => (
              <g
                key={node.id}
                data-node={node.id}
                className={nodeClass(node)}
                ref={(el) => {
                  if (el) nodeEls.current.set(node.id, el);
                  else nodeEls.current.delete(node.id);
                }}
                tabIndex={0}
                role="button"
                aria-label={`${node.name}, ${plural(node.tournaments, 'tournament')}, ${plural(node.degree, 'partner')}`}
                onClick={() => onSelect(node.id === selectedId ? null : node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(node.id === selectedId ? null : node.id);
                  }
                }}
                onPointerEnter={handleHover(node)}
                onPointerLeave={() => setHover(null)}
                onFocus={handleHover(node)}
                onBlur={() => setHover(null)}
              >
                {/* Transparent hit area — the painted dot is far too small to aim at. */}
                <circle className="hit" r={Math.max(node.radius + 8, 14)} />
                <circle className="dot" r={node.radius} />
                {showLabel(node) && (
                  // Counter-scale so label text keeps a constant on-screen size
                  // however far the view is zoomed out. Inside this transform
                  // one unit is one screen pixel.
                  <text
                    className="label"
                    transform={`scale(${1 / transform.k})`}
                    y={-(node.radius * transform.k + 7)}
                  >
                    {node.short}
                  </text>
                )}
              </g>
            ))}
          </g>
        </g>
      </svg>

      <div className="graph-controls">
        <button type="button" onClick={() => zoomBy(1.35)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.35)} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            userAdjusted.current = false;
            const view = fitToView(layout.nodes, size.width, size.height);
            setTransform(view);
            setLabelled(pickLabels(layout.nodes, view, size.width, size.height, MAX_LABELS));
          }}
          aria-label="Fit graph to view"
          className="reset"
        >
          Fit
        </button>
      </div>

      {hover && (
        <div
          className="graph-tooltip"
          style={{
            left: Math.min(Math.max(hover.x, 12), size.width - 12),
            top: Math.max(hover.y - hover.node.radius - 14, 12),
          }}
          role="status"
        >
          <strong>{hover.node.name}</strong>
          <dl>
            <div>
              <dt>Tournaments</dt>
              <dd>{hover.node.tournaments}</dd>
            </div>
            <div>
              <dt>Partners</dt>
              <dd>{hover.node.degree}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{seasonSpan(hover.node.first, hover.node.last)}</dd>
            </div>
          </dl>
          <span className="hint">Click for profile</span>
        </div>
      )}
    </div>
  );
}
