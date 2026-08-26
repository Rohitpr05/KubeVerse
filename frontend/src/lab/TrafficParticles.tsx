import type { CSSProperties } from 'react';
import { ViewportPortal } from '@xyflow/react';

export interface Particle { id: string; fromX: number; fromY: number; toX: number; toY: number; ok: boolean; }

// Visualizes traffic as a handful of moving "beads" - explicitly NOT a
// one-to-one rendering of every real HTTP request (KUBEVERSE_MASTER_SPEC.md
// Phase 2, Part 3: "1000 real requests could be represented visually as
// 10-30 aggregated traffic particles"). One particle is spawned per traffic
// *progress* tick from the backend (lab/trafficRunner.ts emits those in
// ~300ms batches, never per-request), animated toward whichever Pod that
// batch's last real request actually reached - so what's drawn always
// points at a real, currently-Ready endpoint, never an invented one. The
// true cumulative counts (sent/succeeded/failed/RPS/latency/error rate) are
// shown numerically elsewhere (ActivityStrip's traffic-stats table), which
// is the actual source of truth - this layer is illustrative only.
//
// Rendered via React Flow's own ViewportPortal so particle positions stay in
// flow-space and automatically track pan/zoom/lock state exactly like real
// nodes do, with no manual screen-coordinate math.
export function TrafficParticles({ particles }: { particles: Particle[] }) {
  return (
    <ViewportPortal>
      {particles.map((particle) => (
        <div
          key={particle.id}
          className={`traffic-particle ${particle.ok ? 'ok' : 'failed'}`}
          style={{ '--from-x': `${particle.fromX}px`, '--from-y': `${particle.fromY}px`, '--to-x': `${particle.toX}px`, '--to-y': `${particle.toY}px` } as CSSProperties}
        />
      ))}
    </ViewportPortal>
  );
}
