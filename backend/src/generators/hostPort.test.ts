import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { allocateHostPorts } from './hostPort.js';

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('allocateHostPorts(0) returns an empty array without probing anything', async () => {
  assert.deepEqual(await allocateHostPorts(0), []);
});

test('allocateHostPorts returns real, currently-bindable ports', async () => {
  const [port] = await allocateHostPorts(1);
  assert.equal(typeof port, 'number');
  assert.ok(port > 0 && port < 65536);
  // The whole point: the returned port must actually be free to bind right
  // after allocation (this is what "release the probe socket" promises).
  const server = await listenOn(port);
  await close(server);
});

test('a batch allocation never returns the same port twice', async () => {
  const ports = await allocateHostPorts(5);
  assert.equal(ports.length, 5);
  assert.equal(new Set(ports).size, 5, `expected 5 distinct ports, got: ${ports.join(', ')}`);
});

test('allocated ports never include a port that is genuinely already in use', async () => {
  // Occupy whatever the OS would otherwise be free to hand out isn't
  // directly controllable, but we can at least prove that a port we already
  // hold is never handed back to us in the SAME batch it's held during.
  const held = await listenOn(0);
  const heldPort = (held.address() as { port: number }).port;
  try {
    const ports = await allocateHostPorts(20);
    assert.ok(!ports.includes(heldPort), `allocateHostPorts must never return ${heldPort}, which is already bound`);
  } finally {
    await close(held);
  }
});
