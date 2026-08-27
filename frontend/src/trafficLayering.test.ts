import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

// Regression test for the traffic-particle layering bug (Phase 3B): dots
// were rendered on top of Pod/Container cards instead of behind them.
// TrafficParticles.tsx renders through React Flow's <ViewportPortal>, whose
// target div (.react-flow__viewport-portal) is the LAST child in the
// pannable viewport - after both the edges and nodes layers, which both
// default to an inline z-index of exactly 0. Without an explicit z-index of
// its own, the portal (same z=0, later in DOM order) painted above
// everything. The fix is a dedicated, negative z-index on that one rule -
// not an opacity change, not moving particles off the real edge path.
test('the traffic-particle portal has an explicit z-index below the default node/edge layer', () => {
  const rule = css.match(/\.react-flow__viewport-portal\s*{([^}]*)}/);
  assert.ok(rule, 'expected a .react-flow__viewport-portal rule in styles.css');
  const zIndexMatch = rule![1].match(/z-index\s*:\s*(-?\d+)/);
  assert.ok(zIndexMatch, '.react-flow__viewport-portal must declare an explicit z-index');
  const zIndex = Number(zIndexMatch![1]);
  assert.ok(zIndex < 0, `expected a negative z-index (React Flow's own default node/edge z-index is 0), got ${zIndex}`);
});

test('the layering fix does not touch .traffic-particle\'s own opacity rule (no "just make it fainter" workaround)', () => {
  const rule = css.match(/\.traffic-particle\s*{([^}]*)}/);
  assert.ok(rule, 'expected a .traffic-particle rule in styles.css');
  // The particle's own base opacity is 0 (JS raises it per-frame while
  // travelling - see TrafficParticles.tsx) - unrelated to whether it's
  // hidden by a node. If this ever changes to a partial, non-zero constant
  // "dimming" value, that would signal the layering bug was worked around
  // with opacity instead of paint order.
  const opacityMatch = rule![1].match(/opacity\s*:\s*([\d.]+)/);
  assert.ok(opacityMatch, '.traffic-particle must declare a base opacity');
  assert.equal(Number(opacityMatch![1]), 0);
});

// Regression coverage for the Pod Failure visual lifecycle's CSS (the class
// itself is applied/removed by real experiment state - see
// lab/experimentHighlight.test.ts for that logic; this only checks the
// stylesheet declares a genuinely distinct, transitioned, non-opaque state
// for it, per "faint red, semi-transparent... smooth CSS transition").
test('.resource-node.pod-failing declares a smooth transition and reduced, non-zero opacity - distinct from the plain .experiment-target ring', () => {
  const rule = css.match(/\.resource-node\.pod-failing\s*{([^}]*)}/);
  assert.ok(rule, 'expected a .resource-node.pod-failing rule in styles.css');
  const body = rule![1];
  assert.match(body, /transition\s*:/, 'expected a CSS transition so the state change is smooth, not instant');
  const opacityMatch = body.match(/opacity\s*:\s*([\d.]+)/);
  assert.ok(opacityMatch, '.resource-node.pod-failing must declare an opacity');
  const opacity = Number(opacityMatch![1]);
  assert.ok(opacity > 0 && opacity < 1, `expected a semi-transparent (not fully opaque, not fully invisible) opacity, got ${opacity}`);
});
