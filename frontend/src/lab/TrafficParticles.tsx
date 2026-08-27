import { useEffect, useRef, type RefObject } from 'react';
import { ViewportPortal } from '@xyflow/react';
import { DOT_TRAVEL_MS, type TrafficDot } from './trafficDots';

// Visualizes traffic as a handful of dots travelling along the ACTUAL
// rendered React Flow edge between the traffic's source Service and each
// target Pod (Phase 3A) - never a straight line guessed between node
// centers. Each dot is aggregated (1 dot = 10 real requests, see
// trafficDots.ts) and illustrative only; the true cumulative counts
// (sent/succeeded/failed/RPS/latency/error rate) are shown numerically
// elsewhere (ActivityStrip's traffic-stats table), which remains the actual
// source of truth.
//
// How a dot follows the edge: every edge React Flow renders is a real SVG
// <path class="react-flow__edge-path"> inside a <g data-id="<edgeId}">
// (@xyflow/react's own DOM structure) living in the same flow-space
// coordinate system ViewportPortal already places this component's own
// children in. Rather than recomputing bezier/smooth-step geometry
// ourselves (which would have to track React Flow's edge type, handle
// positions, and node dimensions independently and could drift from what's
// actually drawn), a dot's position is sampled directly off that live path
// element via the browser's native SVGPathElement API
// (getTotalLength/getPointAtLength) - the same geometry the user sees,
// automatically correct through bends, node drags, Auto Layout, and
// whatever edge type (bezier/smoothstep/straight/custom) is configured.
//
// Positions are written directly to each dot's DOM node's `transform` style
// inside one shared requestAnimationFrame loop - never through React state -
// so a topology with many concurrent dots never triggers a React re-render
// on every animation frame (Part 19). React only re-renders when a dot is
// actually added or removed (PlaygroundView's setState), which happens at
// most a few times per backend progress tick, not every frame.
export function TrafficParticles({ dots, containerRef }: { dots: TrafficDot[]; containerRef: RefObject<HTMLElement | null> }) {
  const elementsRef = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    let frame: number;
    const tick = () => {
      const now = performance.now();
      const container = containerRef.current;
      // Re-read the live edge paths every frame (not cached across frames):
      // dragging a node or running Auto Layout re-renders the edge's `d`
      // attribute in place, and a dot mid-flight must pick that up on the
      // very next frame, never keep following a stale, no-longer-rendered
      // shape (Part 13). Queried once per frame for ALL edges (not once per
      // dot) so a burst of dots sharing one edge stays cheap.
      const pathsByEdgeId = new Map<string, SVGPathElement>();
      if (container && dots.length > 0) {
        for (const group of container.querySelectorAll<SVGGElement>('.react-flow__edge[data-id]')) {
          const edgeId = group.getAttribute('data-id');
          const path = group.querySelector<SVGPathElement>('path.react-flow__edge-path');
          if (edgeId && path) pathsByEdgeId.set(edgeId, path);
        }
      }

      for (const dot of dots) {
        const element = elementsRef.current.get(dot.id);
        if (!element) continue;
        const path = pathsByEdgeId.get(dot.edgeId);
        const elapsed = now - dot.startedAt;
        if (!path || elapsed < 0) { element.style.opacity = '0'; continue; }
        const t = Math.min(1, elapsed / DOT_TRAVEL_MS);
        const length = path.getTotalLength();
        const point = path.getPointAtLength(t * length);
        element.style.transform = `translate(${point.x}px, ${point.y}px)`;
        // Fade in on spawn and out on arrival; fully opaque while travelling.
        const fadeIn = Math.min(1, elapsed / 120);
        const fadeOut = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
        element.style.opacity = String(Math.min(fadeIn, fadeOut));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dots, containerRef]);

  return (
    <ViewportPortal>
      {dots.map((dot) => (
        <div
          key={dot.id}
          ref={(element) => {
            if (element) elementsRef.current.set(dot.id, element);
            else elementsRef.current.delete(dot.id);
          }}
          className={`traffic-particle ${dot.ok ? 'ok' : 'failed'}`}
        />
      ))}
    </ViewportPortal>
  );
}
