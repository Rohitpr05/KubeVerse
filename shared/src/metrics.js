// These simple process-local measurements deliberately model what a metrics collector would scrape.
export function createMetrics({ serviceName, instanceId }) {
  let requestCount = 0;
  let errorCount = 0;
  let activeRequests = 0;
  let totalLatencyMs = 0;
  return {
    begin() { activeRequests += 1; return Date.now(); },
    finish(startedAt, failed = false) {
      activeRequests = Math.max(0, activeRequests - 1);
      requestCount += 1;
      totalLatencyMs += Date.now() - startedAt;
      if (failed) errorCount += 1;
    },
    snapshot() {
      // Values are intentionally simulated, rather than readings from the host or a cloud platform.
      return {
        serviceName, instanceId, requestCount, errorCount, activeRequests,
        averageLatencyMs: requestCount ? Number((totalLatencyMs / requestCount).toFixed(2)) : 0,
        simulatedCpuPercent: Number((8 + activeRequests * 12 + (requestCount % 9)).toFixed(1)),
        simulatedMemoryMb: 64 + activeRequests * 16 + (requestCount % 11)
      };
    }
  };
}
