import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, initials, signInButtonLabel, type GoogleIdentity } from './authLogic.js';

test('displayName prefers name, then email, then a generic fallback - never the raw sub', () => {
  assert.equal(displayName({ sub: '110169484474386276334', name: 'Ada Lovelace', email: 'ada@example.com' }), 'Ada Lovelace');
  assert.equal(displayName({ sub: '110169484474386276334', email: 'ada@example.com' }), 'ada@example.com');
  assert.equal(displayName({ sub: '110169484474386276334' }), 'Signed in');
});

test('displayName never returns the raw Google subject id, even with only sub present', () => {
  const identity: GoogleIdentity = { sub: '110169484474386276334' };
  assert.doesNotMatch(displayName(identity), /110169484474386276334/);
});

test('initials derives from name first, then email, capped at two letters', () => {
  assert.equal(initials({ sub: 'x', name: 'Ada Lovelace' }), 'AL');
  assert.equal(initials({ sub: 'x', name: 'Ada Katherine Lovelace' }), 'AK');
  assert.equal(initials({ sub: 'x', email: 'ada@example.com' }), 'A');
  assert.equal(initials({ sub: 'x' }), '?');
});

test('signInButtonLabel reflects the real busy state, no fake progress text', () => {
  assert.equal(signInButtonLabel(false), 'Continue with Google');
  assert.equal(signInButtonLabel(true), 'Opening Google sign-in…');
});
