// Metrics are an abstraction so the explorer can adopt metrics.k8s.io without coupling graph state to one provider.
import type { MetricsSnapshot } from '@simulator/shared/platform-contract';

export interface MetricsProvider { snapshot(namespace?: string): Promise<MetricsSnapshot>; }

export class UnavailableMetricsProvider implements MetricsProvider {
  async snapshot(_namespace?: string): Promise<MetricsSnapshot> {
    return { source: 'unavailable', available: false, collectedAt: new Date().toISOString(), podMetrics: [], message: 'Metrics API integration is ready, but no metrics provider is configured in Phase 1.' };
  }
}
