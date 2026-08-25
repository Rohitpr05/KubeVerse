import { randomUUID } from 'node:crypto';

// Deliberately in-memory: it makes event loss on a restart observable during local learning.
export function createEventStore({ serviceName, instanceId, limit = 500 }) {
  const events = [];
  return {
    emit(type, requestId, details = {}) {
      const event = { id: randomUUID(), type, timestamp: new Date().toISOString(), service: serviceName, instanceId, requestId, details };
      events.push(event);
      if (events.length > limit) events.shift();
      return event;
    },
    recent(max = 100) { return events.slice(-Math.min(max, limit)); }
  };
}
