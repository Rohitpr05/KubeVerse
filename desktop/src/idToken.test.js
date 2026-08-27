const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeIdTokenPayload } = require('./idToken.js');

function fakeIdToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

test('extracts exactly the minimal identity fields from a real-shaped Google ID token payload', () => {
  const token = fakeIdToken({
    iss: 'https://accounts.google.com',
    sub: '110169484474386276334',
    email: 'user@example.com',
    email_verified: true,
    name: 'Ada Lovelace',
    picture: 'https://lh3.googleusercontent.com/a/photo.jpg',
    aud: 'some-client-id',
    exp: 9999999999,
    iat: 1000000000,
  });
  const identity = decodeIdTokenPayload(token);
  assert.deepEqual(identity, {
    sub: '110169484474386276334',
    email: 'user@example.com',
    name: 'Ada Lovelace',
    picture: 'https://lh3.googleusercontent.com/a/photo.jpg',
  });
});

// Privacy proof: nothing from the token beyond these four fields ever
// survives decodeIdTokenPayload - not the audience, not verification flags,
// not issued/expiry timestamps, and never anything project-related (which
// could never be in a Google ID token anyway, but the returned object's
// shape is a hard guarantee, not just an absence of a bug).
test('never returns any field beyond sub/email/name/picture, even if the token payload has more', () => {
  const token = fakeIdToken({
    sub: 'abc123',
    email: 'user@example.com',
    aud: 'client-id',
    iss: 'https://accounts.google.com',
    hd: 'example.com',
    locale: 'en',
    extra_secret_looking_field: 'should-never-appear',
  });
  const identity = decodeIdTokenPayload(token);
  assert.deepEqual(Object.keys(identity).sort(), ['email', 'name', 'picture', 'sub']);
});

test('email/name/picture are optional - omitted fields become undefined, sub alone is enough', () => {
  const token = fakeIdToken({ sub: 'only-sub-present' });
  const identity = decodeIdTokenPayload(token);
  assert.deepEqual(identity, { sub: 'only-sub-present', email: undefined, name: undefined, picture: undefined });
});

test('rejects a token with no sub claim - a stable identity is not optional', () => {
  const token = fakeIdToken({ email: 'user@example.com' });
  assert.throws(() => decodeIdTokenPayload(token), /sub/);
});

test('rejects a malformed token (wrong number of dot-separated segments)', () => {
  assert.throws(() => decodeIdTokenPayload('not-a-real-jwt'), /Malformed/);
});

test('rejects a token whose payload segment is not valid JSON', () => {
  const bogus = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('not-json').toString('base64url')}.sig`;
  assert.throws(() => decodeIdTokenPayload(bogus), /Malformed/);
});

test('rejects a non-string input rather than throwing an unrelated TypeError', () => {
  assert.throws(() => decodeIdTokenPayload(undefined), /Missing ID token/);
});
