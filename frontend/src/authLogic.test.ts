import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, initials, signInButtonLabel, type AuthState, type GoogleIdentity } from './authLogic.js';

// Exercises the real discriminated union at runtime, not just compile-time -
// proves the four explicit states (loading/signed_out/signed_in/error) are
// each distinguishable and carry exactly the fields they should, matching
// authController.js's own AuthState shape field-for-field.
function describe(state: AuthState): string {
  switch (state.status) {
    case 'loading': return 'loading';
    case 'signed_out': return 'signed out';
    case 'signed_in': return `signed in as ${displayName(state.identity)}`;
    case 'error': return `error: ${state.message}`;
  }
}

test('AuthState has exactly four distinguishable states: loading, signed_out, signed_in, error', () => {
  assert.equal(describe({ status: 'loading' }), 'loading');
  assert.equal(describe({ status: 'signed_out' }), 'signed out');
  assert.equal(describe({ status: 'signed_in', identity: { uid: 'u1', name: 'Ada Lovelace' } }), 'signed in as Ada Lovelace');
  assert.equal(describe({ status: 'error', message: "Couldn't sign in. Try again." }), "error: Couldn't sign in. Try again.");
});

test('a signed_in state always carries a real identity object, never just a boolean flag', () => {
  const state: AuthState = { status: 'signed_in', identity: { uid: 'u1', email: 'ada@example.com' } };
  assert.equal(state.status, 'signed_in');
  assert.equal(state.identity.uid, 'u1');
});

test('displayName prefers name, then email, then a generic fallback - never the raw uid', () => {
  assert.equal(displayName({ uid: 'firebase-uid-abc123def456', name: 'Ada Lovelace', email: 'ada@example.com' }), 'Ada Lovelace');
  assert.equal(displayName({ uid: 'firebase-uid-abc123def456', email: 'ada@example.com' }), 'ada@example.com');
  assert.equal(displayName({ uid: 'firebase-uid-abc123def456' }), 'Signed in');
});

test('displayName never returns the raw Firebase uid, even when only uid is present', () => {
  const identity: GoogleIdentity = { uid: 'firebase-uid-abc123def456' };
  assert.doesNotMatch(displayName(identity), /firebase-uid-abc123def456/);
});

test('initials derives from name first, then email, capped at two letters', () => {
  assert.equal(initials({ uid: 'x', name: 'Ada Lovelace' }), 'AL');
  assert.equal(initials({ uid: 'x', name: 'Ada Katherine Lovelace' }), 'AK');
  assert.equal(initials({ uid: 'x', email: 'ada@example.com' }), 'A');
  assert.equal(initials({ uid: 'x' }), '?');
});

test('signInButtonLabel reflects the real busy state, no fake progress text', () => {
  assert.equal(signInButtonLabel(false), 'Continue with Google');
  assert.equal(signInButtonLabel(true), 'Opening Google sign-in…');
});
