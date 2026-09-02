import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./views/PlaygroundView.tsx', import.meta.url)), 'utf8');

// Regression test: the Playground's no-project state used to render a large
// .empty-hero card ("Open a project first" + a "Go to Projects" button) -
// a forced project-selection prompt product decided against. It must now
// stay visually empty/idle (just the plain page, matching the rest of the
// app's background), never that card, never that button, and never a new
// placeholder component invented to replace it. This repo has no
// React-render-testing setup (no @testing-library/react/jsdom anywhere -
// see frontend/package.json), so - matching trafficLayering.test.ts's own
// established pattern for asserting on real source content instead of a
// rendered DOM - this reads the actual component source directly.
test('the Playground empty state no longer renders the "Open a project first" card', () => {
  assert.doesNotMatch(source, /Open a project first/);
});

test('the Playground empty state no longer renders a "Go to Projects" button', () => {
  assert.doesNotMatch(source, /Go to Projects/);
});

test('the Playground empty state no longer uses the .empty-hero card at all - removed, not CSS-hidden', () => {
  const emptyStateBranch = source.match(/if \(!currentProject && !loadedProjectIdRef\.current\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(emptyStateBranch, 'expected to find the no-project early-return branch');
  assert.doesNotMatch(emptyStateBranch![1], /empty-hero/, 'the empty-hero card must be removed from the JSX entirely, not hidden via a CSS class/display:none');
});

// The fix must be scoped to the no-project branch only - the real,
// project-selected Playground (live topology, traffic simulation, Pod
// failure, the actual explorer layout) must be completely unaffected.
test('the project-selected Playground layout is unaffected - still renders the real explorer/canvas, not the empty state', () => {
  assert.match(source, /ExplorerControls/, 'the real toolbar must still be rendered when a project is open');
  assert.match(source, /explorer-layout/, 'the real topology layout must still be rendered when a project is open');
  assert.match(source, /<ReactFlow/, 'the real live canvas must still be rendered when a project is open');
});

test('the no-project state still renders inside .playground-view/.view, preserving the existing centered-workspace CSS behavior', () => {
  const emptyStateBranch = source.match(/if \(!currentProject && !loadedProjectIdRef\.current\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(emptyStateBranch);
  assert.match(emptyStateBranch![1], /className="playground-view"/);
  assert.match(emptyStateBranch![1], /className="view"/);
});
