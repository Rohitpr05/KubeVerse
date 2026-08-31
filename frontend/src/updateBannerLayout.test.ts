import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

function rule(selector: string): string {
  const match = css.match(new RegExp(selector.replace(/[.[\]]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, `expected a ${selector} rule in styles.css`);
  return match![1];
}

// Regression test for a real bug (v4.3.2): .app-shell is a CSS Grid with a
// hardcoded 2-row template (one row for the 56px TopBar, one row -
// minmax(0, 1fr) - for .shell-body) and no explicit grid-row assignments
// anywhere. UpdateBanner.tsx renders as a plain in-flow sibling of TopBar/
// .shell-body inside .app-shell whenever an update is available/downloading/
// ready - a THIRD grid item Grid's auto-placement algorithm was never told
// about. That shifted every subsequent item down one row: the banner landed
// in the 56px row meant for TopBar (overlapping/clipping the header),
// TopBar got shoved into the minmax(0, 1fr) row meant for .shell-body
// (stretching the header to fill most of the window), and .shell-body fell
// into a new implicit row sized by grid-auto-rows - never getting the "fill
// the rest of the viewport" sizing the sidebar/workspace depend on. This
// reproduced live via a real rendered screenshot of both the buggy and
// fixed CSS side by side before this fix was written, not assumed.
//
// The fix (matching lab/LabDrawer.tsx's own already-established pattern for
// exactly this category of problem - see its own comment in styles.css):
// take the banner out of grid flow entirely via `position: fixed`, so it
// can never participate in .app-shell's row template again regardless of
// how many times it mounts/unmounts, docked at the same hardcoded
// topbar-height offset .lab-drawer already uses.
test('.update-banner is taken out of grid flow via position: fixed, so it can never shift .app-shell\'s row assignments again', () => {
  const body = rule('.update-banner');
  assert.match(body, /position\s*:\s*fixed\b/, '.update-banner must not be a normal-flow grid item of .app-shell');
});

test('.update-banner declares an explicit z-index, not implicit stacking (never "just a bigger number" - see .lab-drawer\'s own tier)', () => {
  const body = rule('.update-banner');
  const match = body.match(/z-index\s*:\s*(\d+)/);
  assert.ok(match, '.update-banner must declare an explicit z-index');
  assert.ok(Number(match![1]) > 0, 'expected a real, positive stacking value');
});

// The banner's `top` offset and .app-shell's own topbar row height are two
// independent numbers that must always agree, or the banner will either
// overlap the TopBar again (too small) or leave a visible gap (too large).
// Asserted against each other directly, not just both hardcoded to "56px"
// independently, so a future change to one is caught if the other doesn't
// move with it.
test('.update-banner docks at exactly the same offset as .app-shell\'s own hardcoded topbar row height - it can never overlap the TopBar again', () => {
  const shellBody = rule('.app-shell');
  const rowsMatch = shellBody.match(/grid-template-rows\s*:\s*(\S+)/);
  assert.ok(rowsMatch, '.app-shell must declare an explicit grid-template-rows');
  const topbarHeight = rowsMatch![1];

  const bannerBody = rule('.update-banner');
  const topMatch = bannerBody.match(/top\s*:\s*(\S+);/);
  assert.ok(topMatch, '.update-banner must declare an explicit top offset');
  assert.equal(topMatch![1], topbarHeight, 'the banner\'s top offset must match .app-shell\'s topbar row height exactly');
});

// .app-shell's grid must keep expecting exactly the two real, always-present
// children (TopBar, .shell-body) - a regression guard against "fixing" this
// differently in the future by adding a third row that assumes the banner
// participates in grid flow again (which would silently break the moment
// UpdateBanner isn't mounted/visible, since Grid would then have an empty
// row).
test('.app-shell\'s grid still declares exactly two rows - the banner must never become a grid-flow item again', () => {
  const body = rule('.app-shell');
  const match = body.match(/grid-template-rows\s*:\s*([^;]+);/);
  assert.ok(match, '.app-shell must declare an explicit grid-template-rows');
  const rows = match![1].trim().split(/\s+(?![^(]*\))/); // split on whitespace outside of minmax(...)
  assert.equal(rows.length, 2, `expected exactly 2 grid rows (TopBar, .shell-body), got: ${match![1]}`);
});
