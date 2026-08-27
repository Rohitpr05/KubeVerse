// Decodes (does not cryptographically verify) a Google-issued ID token's
// payload. Verification is deliberately unnecessary here: this token is
// never handed to KubeVerse by an untrusted third party - the main process
// (googleAuth.js) obtains it directly from Google's own token endpoint
// (https://oauth2.googleapis.com/token) over a TLS connection it initiated
// itself, in direct response to its own PKCE-protected authorization-code
// exchange. There is no adversarial hand-off here for a signature to guard
// against - the same trust basis any confidential server-side client
// already relies on when it receives tokens directly from the
// authorization server. Extracts only the minimal fields KubeVerse actually
// uses (KUBEVERSE_MASTER_SPEC.md, "Google identity is for identification
// only") - project data, API keys, and generated code never flow through
// this token or this function.
function decodeIdTokenPayload(idToken) {
  if (typeof idToken !== 'string') throw new Error('Missing ID token.');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token.');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed ID token payload.');
  }
  if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('ID token is missing a stable subject (sub) claim.');
  }
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  };
}

module.exports = { decodeIdTokenPayload };
