// PKCE (RFC 7636) helpers for the Google desktop OAuth flow (googleAuth.js).
// Pure, Node-crypto-only - no Electron dependency, directly testable via
// plain node:test.
const crypto = require('node:crypto');

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A high-entropy random string from the unreserved URL-safe charset, 43-128
// characters per RFC 7636 §4.1 - 64 random bytes base64url-encodes to 86
// characters, comfortably inside that range.
function generateCodeVerifier() {
  return base64url(crypto.randomBytes(64));
}

// S256 method (RFC 7636 §4.2): base64url(SHA256(code_verifier)) - the
// method Google's own docs recommend over plain.
function generateCodeChallenge(codeVerifier) {
  return base64url(crypto.createHash('sha256').update(codeVerifier).digest());
}

// CSRF-mitigation state value for the authorization request - a separate,
// unrelated random string from the code verifier (never derived from it).
function generateState() {
  return base64url(crypto.randomBytes(32));
}

module.exports = { generateCodeVerifier, generateCodeChallenge, generateState };
