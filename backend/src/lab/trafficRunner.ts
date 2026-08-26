// The Lab's real traffic generator (KUBEVERSE_MASTER_SPEC.md Phase 2, "Real
// traffic lab"). Sends genuine HTTP requests over a real Kubernetes API
// server port-forward to real, currently-Ready backing Pods - never
// animated/fabricated request "particles" on their own.
//
// Deliberate simplification, honestly disclosed rather than hidden: this
// forwards directly to specific backing Pods (chosen the same way kube-proxy
// would - the Service's selector matched against currently-Ready Pods, see
// routes/lab.ts) and round-robins requests across them client-side, instead
// of forwarding to the Service and letting a single kubectl-style tunnel
// stick to one Pod for its whole duration. This exercises the real
// application over a real network path through a real Pod, and does
// distribute load across every currently-Ready replica - it does not
// exercise kube-proxy's own iptables/IPVS load-balancing implementation
// (§15, FUTURE - "kube-proxy deep visualization" is explicitly out of scope
// for this milestone).
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { TrafficStats } from '@kubeverse/shared';
import { openPodPortForward } from '../execution/kubernetesRunner.js';

export interface TrafficTarget { namespace: string; podName: string; }

export interface TrafficOptions {
  totalRequests: number;
  requestsPerSecond: number;
  path: string;
  remotePort: number;
  targets: TrafficTarget[];
  signal: AbortSignal;
  onProgress: (stats: TrafficStats) => void;
  // Optional: re-resolves the currently-Ready target Pods for the Service
  // (routes/lab.ts's resolveReadyTargets). Polled periodically so a Pod that
  // fails mid-run stops receiving traffic, and a replacement that becomes
  // Ready starts receiving it, without restarting the experiment - the same
  // real observed-endpoint signal the initial target list was built from,
  // just re-checked. Omitting it keeps the original fixed-target behavior.
  refreshTargets?: () => Promise<TrafficTarget[]>;
}

const PROGRESS_INTERVAL_MS = 300;
const MAX_CONCURRENT_TARGETS = 5;
const REQUEST_TIMEOUT_MS = 5000;
const TARGET_REFRESH_INTERVAL_MS = 2000;

function fetchOnce(localPort: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: localPort, path, method: 'GET', timeout: REQUEST_TIMEOUT_MS }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

type ForwardHandle = { localPort: number; close: () => void };
type ForwardEntry = { target: TrafficTarget; forward: ForwardHandle };

export async function runTrafficExperiment(options: TrafficOptions): Promise<TrafficStats> {
  const { totalRequests, requestsPerSecond, path, remotePort, signal, onProgress, refreshTargets } = options;
  const initialTargets = options.targets.slice(0, MAX_CONCURRENT_TARGETS);
  if (initialTargets.length === 0) throw new Error('Service has no reachable (Ready) endpoint.');

  // Keyed by Pod name (unique within a namespace) so refreshing targets mid-run
  // can cheaply diff "still Ready" / "no longer Ready" / "newly Ready" against
  // what's currently open, opening/closing only what actually changed.
  const forwards = new Map<string, ForwardEntry>();
  for (const target of initialTargets) {
    forwards.set(target.podName, { target, forward: await openPodPortForward(target.namespace, target.podName, remotePort) });
  }

  async function applyTargets(nextTargets: TrafficTarget[]): Promise<void> {
    const capped = nextTargets.slice(0, MAX_CONCURRENT_TARGETS);
    const nextNames = new Set(capped.map((target) => target.podName));
    for (const [podName, entry] of forwards) {
      if (!nextNames.has(podName)) { entry.forward.close(); forwards.delete(podName); }
    }
    for (const target of capped) {
      if (forwards.has(target.podName)) continue;
      try {
        const forward = await openPodPortForward(target.namespace, target.podName, remotePort);
        forwards.set(target.podName, { target, forward });
      } catch {
        // A newly-eligible Pod whose port-forward isn't actually establishable
        // yet (e.g. the API server proxy hasn't caught up) - skip it this
        // cycle; the next refresh tries again rather than failing the run.
      }
    }
  }

  try {
    let sent = 0, succeeded = 0, failed = 0, latencySum = 0, cursor = 0;
    let lastHitPod: string | undefined;
    const recentTimestamps: number[] = [];
    let lastEmit = Date.now();
    let lastRefresh = Date.now();

    const currentStats = (): TrafficStats => {
      const now = Date.now();
      while (recentTimestamps.length && now - recentTimestamps[0] > 1000) recentTimestamps.shift();
      return {
        sent, succeeded, failed, currentRps: recentTimestamps.length,
        avgLatencyMs: sent ? Math.round(latencySum / sent) : 0, errorRate: sent ? failed / sent : 0,
        targetPods: [...forwards.keys()], lastHitPod,
      };
    };

    const intervalMs = 1000 / Math.max(1, requestsPerSecond);

    for (let i = 0; i < totalRequests; i += 1) {
      if (signal.aborted) break;

      if (refreshTargets && Date.now() - lastRefresh >= TARGET_REFRESH_INTERVAL_MS) {
        lastRefresh = Date.now();
        try { await applyTargets(await refreshTargets()); } catch { /* transient resolution error - keep current targets */ }
      }

      if (forwards.size === 0) {
        // Every previously-Ready endpoint is currently gone (e.g. mid Pod
        // failure, before a replacement becomes Ready) - an honest "nothing
        // to send to right now" pause, not a fabricated success/failure, and
        // not a reason to abandon the run: the next refresh may recover it.
        onProgress(currentStats());
        await delay(Math.min(500, TARGET_REFRESH_INTERVAL_MS));
        continue;
      }

      const entries = [...forwards.values()];
      const { target, forward } = entries[cursor % entries.length];
      cursor += 1;
      const startedAt = Date.now();
      try {
        const status = await fetchOnce(forward.localPort, path);
        sent += 1;
        latencySum += Date.now() - startedAt;
        recentTimestamps.push(Date.now());
        lastHitPod = target.podName;
        if (status > 0 && status < 500) succeeded += 1; else failed += 1;
      } catch {
        sent += 1; failed += 1; latencySum += Date.now() - startedAt; recentTimestamps.push(Date.now());
      }
      if (Date.now() - lastEmit >= PROGRESS_INTERVAL_MS) { onProgress(currentStats()); lastEmit = Date.now(); }
      const remaining = intervalMs - (Date.now() - startedAt);
      if (remaining > 0) await delay(remaining);
    }
    const finalStats = currentStats();
    onProgress(finalStats);
    return finalStats;
  } finally {
    for (const { forward } of forwards.values()) forward.close();
  }
}
