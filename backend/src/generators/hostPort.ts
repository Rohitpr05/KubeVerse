// Allocates real, currently-available Docker Compose HOST ports for a
// generated project - never the container port, which stays exactly what
// the architecture spec declared (KubeVerse Docker port-collision fix).
//
// Root cause this exists to fix: the generator used to publish every
// service as `${service.port}:${service.port}` - i.e. it reused the
// CONTAINER port as the HOST port too. Since the architecture.md starter
// template's own example backend uses port 4000 - the exact port KubeVerse's
// own backend listens on - a freshly generated project routinely collided
// with KubeVerse itself ("bind: address already in use").
//
// The fix asks the OS for a genuinely free port (the same technique
// execution/kubernetesRunner.ts's openPodPortForward already uses: bind to
// port 0 and read back whatever the OS assigned) rather than guessing at or
// incrementing through candidate numbers. This is deliberately NOT a
// persisted "ports currently in use" registry - an OS-level bind test is
// already the authoritative answer to "is this port free right now," and it
// transparently avoids every port anything on the machine is already
// using - KubeVerse's own backend/frontend dev server, another already-running
// generated project, or any unrelated application - with no hardcoded
// exclusion list to keep in sync.
import { createServer } from 'node:net';

interface ReservedPort {
  port: number;
  release: () => Promise<void>;
}

function reserveEphemeralPort(): Promise<ReservedPort> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      if (!port) { server.close(); reject(new Error('Could not determine an assigned port.')); return; }
      resolve({ port, release: () => new Promise<void>((res) => server.close(() => res())) });
    });
  });
}

// Allocates `count` distinct available host ports in one batch. Every probe
// socket in the batch is kept open until all of them have been reserved,
// then released together - that's what guarantees two services generated in
// the SAME docker-compose.yml never collide with EACH OTHER (as opposed to
// only avoiding ports already used by something else on the machine).
//
// Known, inherent limitation shared by every "ask the OS for a free port,
// use it later" technique (not specific to KubeVerse): between releasing the
// probe socket here and `docker compose up` actually binding the port
// moments later, another process could in principle claim it first. There is
// no race-proof alternative without holding the OS resource for the whole
// container lifetime, which Docker itself has no way to be asked to do in
// advance - the same trade-off openPodPortForward already accepts for
// traffic-experiment port-forwards.
export async function allocateHostPorts(count: number): Promise<number[]> {
  if (count <= 0) return [];
  const reserved: ReservedPort[] = [];
  try {
    for (let i = 0; i < count; i += 1) reserved.push(await reserveEphemeralPort());
  } catch (error) {
    await Promise.all(reserved.map((entry) => entry.release()));
    throw new Error(`Could not find ${count} available host port(s): ${error instanceof Error ? error.message : String(error)}`);
  }
  await Promise.all(reserved.map((entry) => entry.release()));
  return reserved.map((entry) => entry.port);
}
