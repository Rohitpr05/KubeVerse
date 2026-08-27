import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProjectImageName } from './imageName.js';

// Regression fixture for the actual production bug: a real Playground
// project generated Pods that failed with "Failed to pull image
// application-server-architecture/project-service:latest ... pull access
// denied / repository does not exist" - a free-text architecture name (not
// even a KubeVerse project name) treated as a Docker registry namespace.
const buggyProject = { id: '01a037bf-5bff-7285-a0d0-0d8e79272479', name: 'Application Server Architecture' };

test('getProjectImageName never produces a slash-namespaced reference, even from the exact free-text name that caused the original bug', () => {
  const image = getProjectImageName(buggyProject, 'project-service');
  assert.doesNotMatch(image, /\//, `image reference must not contain "/" (would be read as a registry namespace): ${image}`);
});

test('getProjectImageName is deterministic: same project + service always produces the same reference', () => {
  const a = getProjectImageName(buggyProject, 'project-service');
  const b = getProjectImageName(buggyProject, 'project-service');
  assert.equal(a, b);
});

test('getProjectImageName produces a valid, lowercase Docker repository reference for arbitrary project names', () => {
  const weird = { id: '01a037bf-5bff-7285-a0d0-0d8e79272480', name: 'My E-Commerce App!! (v2) 你好' };
  const image = getProjectImageName(weird, 'backend');
  const [repository, tag] = image.split(':');
  assert.equal(tag, 'latest');
  assert.match(repository, /^[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*$/, `repository must be a valid Docker reference component: ${repository}`);
});

test('getProjectImageName never collides between two projects with the same sanitized name', () => {
  const projectA = { id: '01a037bf-0000-7000-a000-000000000001', name: 'shop' };
  const projectB = { id: '01a037bf-0000-7000-a000-000000000002', name: 'shop' };
  const imageA = getProjectImageName(projectA, 'backend');
  const imageB = getProjectImageName(projectB, 'backend');
  assert.notEqual(imageA, imageB);
});

test('getProjectImageName never collides between two services in the same project', () => {
  assert.notEqual(getProjectImageName(buggyProject, 'frontend'), getProjectImageName(buggyProject, 'backend'));
});
