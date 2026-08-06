// Structured JSON logs stay easy to inspect locally and are ready for container log collection later.
export function createLogger({ serviceName, instanceId }) {
  function write(level, message, fields = {}) {
    process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, service: serviceName, instanceId, message, ...fields })}\n`);
  }
  return { info: (message, fields) => write('INFO', message, fields), error: (message, fields) => write('ERROR', message, fields) };
}
