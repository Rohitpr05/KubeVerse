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
}

const PROGRESS_INTERVAL_MS = 300;
const MAX_CONCURRENT_TARGETS = 5;
const REQUEST_TIMEOUT_MS = 5000;

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

export async function runTrafficExperiment(options: TrafficOptions): Promise<TrafficStats> {
  const { totalRequests, requestsPerSecond, path, remotePort, signal, onProgress } = options;
  const targets = options.targets.slice(0, MAX_CONCURRENT_TARGETS);
  if (targets.length === 0) throw new Error('Service has no reachable (Ready) endpoint.');

  const forwards = await Promise.all(
    targets.map(async (target) => ({ target, forward: await openPodPortForward(target.namespace, target.podName, remotePort) })),
  );

  try {
    let sent = 0, succeeded = 0, failed = 0, latencySum = 0, cursor = 0;
    let lastHitPod: string | undefined;
    const recentTimestamps: number[] = [];
    let lastEmit = Date.now();

    const currentStats = (): TrafficStats => {
      const now = Date.now();
      while (recentTimestamps.length && now - recentTimestamps[0] > 1000) recentTimestamps.shift();
      return {
        sent, succeeded, failed, currentRps: recentTimestamps.length,
        avgLatencyMs: sent ? Math.round(latencySum / sent) : 0, errorRate: sent ? failed / sent : 0,
        targetPods: targets.map((target) => target.podName), lastHitPod,
      };
    };

    const intervalMs = 1000 / Math.max(1, requestsPerSecond);

    for (let i = 0; i < totalRequests; i += 1) {
      if (signal.aborted) break;
      const { target, forward } = forwards[cursor % forwards.length];
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
    for (const { forward } of forwards) forward.close();
  }
}
