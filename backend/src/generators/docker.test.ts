import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { validateArchitectureSpec } from '../architecture/schema.js';
import { generateDockerCompose } from './docker.js';
import { getProjectImageName } from './imageName.js';

const parsed = validateArchitectureSpec({
  name: 'Application Server Architecture',
  services: [
    { name: 'frontend', type: 'frontend', runtime: 'node', port: 3000, dependsOn: ['backend'], expose: true },
    { name: 'backend', type: 'backend', runtime: 'node', port: 4000, dependsOn: ['db'] },
    { name: 'db', type: 'database', runtime: 'mongodb', port: 27017 },
  ],
  traffic: [{ from: 'frontend', to: 'backend' }],
});
assert.equal(parsed.success, true);
const spec = parsed.success ? parsed.data : (() => { throw new Error('fixture spec is invalid'); })();
const project = { id: '01a037bf-5bff-7285-a0d0-0d8e79272479', name: 'Application Server Architecture' };

interface ComposeService { image?: string; build?: { context: string } }
interface ComposeFixture { services: Record<string, ComposeService> }

async function compose(): Promise<ComposeFixture> {
  const file = await generateDockerCompose(spec, project);
  return parse(file.contents) as ComposeFixture;
}

test('a node-runtime service gets an explicit image: field, not just a build context', async () => {
  const { services } = await compose();
  assert.equal(services.backend.image, getProjectImageName(project, 'backend'));
  assert.ok(services.backend.build, 'build context must still be present so `docker compose build` can produce that image');
});

test('the compose image never embeds the raw free-text architecture name as a registry-style namespace', async () => {
  const { services } = await compose();
  assert.doesNotMatch(services.backend.image!, /\//, `image reference must not contain "/": ${services.backend.image}`);
});

test('a managed-runtime service keeps referencing its real public image, untouched', async () => {
  const { services } = await compose();
  assert.equal(services.db.image, 'mongo:7');
  assert.equal(services.db.build, undefined);
});

test('the same service produces the identical image reference on repeated generation (deterministic)', async () => {
  const first = await compose();
  const second = await compose();
  assert.equal(first.services.backend.image, second.services.backend.image);
});
