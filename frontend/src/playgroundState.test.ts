import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldResetForProjectChange } from './playgroundState.js';

// This is the exact rule that fixes the reported bug: PlaygroundView.tsx's
// topology previously reset to empty every time `projectId` became
// undefined, including transiently. These cases are the regression guard.

test('a genuinely new/different project resets the graph', () => {
  assert.equal(shouldResetForProjectChange(undefined, 'project-a'), true, 'first project ever loaded');
  assert.equal(shouldResetForProjectChange('project-a', 'project-b'), true, 'switching to a different project');
});

test('re-observing the SAME already-loaded project never resets the graph', () => {
  assert.equal(shouldResetForProjectChange('project-a', 'project-a'), false);
});

test('losing the project id after one was already loaded does NOT reset immediately (Task 2: preserve last valid graph)', () => {
  assert.equal(shouldResetForProjectChange('project-a', undefined), false);
});

test('losing the project id when nothing had ever loaded IS a genuine empty state', () => {
  assert.equal(shouldResetForProjectChange(undefined, undefined), true);
});
