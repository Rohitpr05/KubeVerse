import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArchitectureSpec } from '../architecture/schema.js';
import { generateNodeService } from './nodeService.js';

function serverJsFor(services: unknown[], targetName: string): string {
  const parsed = validateArchitectureSpec({ name: 'shop', services });
  assert.equal(parsed.success, true);
  if (!parsed.success) throw new Error('fixture spec is invalid');
  const target = parsed.data.services.find((service) => service.name === targetName)!;
  const files = generateNodeService(target, parsed.data);
  const serverFile = files.find((file) => file.path === `${targetName}/src/server.js`);
  assert.ok(serverFile, `expected ${targetName}/src/server.js to be generated`);
  return serverFile!.contents;
}

// Regression test: the generated /status route used to fetch `${DEP_URL}/health`
// for every dependency, including managed runtimes (mongodb/redis/postgres/
// mysql) that never speak HTTP - confirmed live against a real Redis
// dependency, this always reported 'unreachable' and tripped Redis's own
// cross-protocol-scripting log warning on every check. A managed dependency
// should get a real TCP connect check instead.
test('a managed-runtime dependency gets a TCP connect check in /status, not an HTTP fetch to /health', () => {
  const serverJs = serverJsFor(
    [
      { name: 'backend', type: 'backend', runtime: 'node', port: 4000, dependsOn: ['cache'] },
      { name: 'cache', type: 'cache', runtime: 'redis', port: 6379 },
    ],
    'backend',
  );
  assert.match(serverJs, /checkTcp\(process\.env\.CACHE_URL\)/);
  assert.doesNotMatch(serverJs, /fetch\(`\$\{process\.env\.CACHE_URL\}\/health`\)/);
  assert.match(serverJs, /net\.createConnection/);
  assert.match(serverJs, /^import net from 'node:net';$/m);
});

test('a node-runtime dependency still gets an HTTP fetch to /health (unchanged behavior)', () => {
  const serverJs = serverJsFor(
    [
      { name: 'frontend', type: 'frontend', runtime: 'node', port: 3000, dependsOn: ['backend'] },
      { name: 'backend', type: 'backend', runtime: 'node', port: 4000 },
    ],
    'frontend',
  );
  assert.match(serverJs, /fetch\(`\$\{process\.env\.BACKEND_URL\}\/health`\)/);
  assert.doesNotMatch(serverJs, /checkTcp\(process\.env\.BACKEND_URL\)/);
});

test('a service with no dependencies never gets a /status route or the TCP helper at all', () => {
  const serverJs = serverJsFor([{ name: 'solo', type: 'backend', runtime: 'node', port: 4000 }], 'solo');
  assert.doesNotMatch(serverJs, /\/status/);
  assert.doesNotMatch(serverJs, /checkTcp/);
});
