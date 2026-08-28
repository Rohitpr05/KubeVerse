// Pure, Electron-independent by design (unlike updater.js, which requires
// 'electron-updater' and can therefore only run inside a real Electron
// process - see updater.js's own comment). electron-updater's raw
// error.message can be a multi-line dump of HTTP response details (status,
// headers, response body) - useful for a developer, never for an end user.
// Confirmed live: checking for updates against a repository with no
// published GitHub release yet (the real, expected state before this
// project's first release) produces exactly that kind of raw dump via a 404
// from GitHub's releases API. Technical detail still reaches the main
// process's own console (see updater.js) - it just never reaches
// user-facing UI.
function sanitizeUpdateError(error) {
  return "Couldn't check for updates right now.";
}

// A *separate* function for what the main process's own console is allowed
// to see - deliberately more technical than sanitizeUpdateError's UI-facing
// sentence, but still never the raw error object.
//
// Regression fix: `console.error('...', error)` used to pass the raw
// electron-updater/builder-util-runtime error straight through - Node's
// console formats an Error by printing its full .stack, which *starts with*
// .message. For an HttpError specifically (builder-util-runtime's
// httpExecutor.js), createHttpError() builds that .message by concatenating
// the request URL, a JSON dump of every response header, and (via
// safeStringifyJson) most of the response body - confirmed live: a real
// GitHub 404 response's Set-Cookie header (_gh_sess/_octo session cookies)
// ended up printed verbatim in the terminal. Checked directly:
// builder-util-runtime's own "safe" stringify helper does NOT redact Cookie/
// Set-Cookie at all (its sensitive-field list is
// token/password/secret/authorization/credential/apikey/passphrase/auth/
// *key - not cookie), so trusting the library's own message formatting was
// never actually safe here - this only ever reads *structured*, non-free-text
// properties (statusCode/code/name), never .message, .stack, .description,
// or .headers, which is what actually guarantees nothing free-text from a
// response can leak through.
function describeErrorForLog(error) {
  if (error && typeof error === 'object') {
    if (typeof error.statusCode === 'number') return `HTTP ${error.statusCode}`;
    if (typeof error.code === 'string' && error.code) return error.code;
    if (typeof error.name === 'string' && error.name) return error.name;
  }
  return 'unknown error';
}

// electron-updater's AppUpdater constructor (node_modules/electron-updater/
// out/AppUpdater.js) always registers its OWN internal `'error'` listener,
// completely independent of updater.js's own - Node's EventEmitter calls
// every registered listener for an event, not just the app's:
//   this.on("error", (error) => { this._logger.error(`Error: ${error.stack || error.message}`); });
// `this._logger` defaults to plain `console` (`this._logger = console;`),
// so without this override, electron-updater's own internals independently
// print the exact raw dump (full response headers, Set-Cookie session
// cookies) this whole module exists to keep out of the console - confirmed
// live: this fired even after updater.js's own listener was already
// correctly using describeErrorForLog, since the two listeners are
// unrelated code paths reacting to the same event.
//
// electron-updater only ever hands its logger a *pre-formatted string*
// (already interpolated - e.g. that `Error: ${error.stack}` above), never
// the original error object, so by the time a string reaches here there is
// no reliable way to tell a genuinely safe status line ("Checking for
// update", "Found version 3.1.0") apart from one that embeds a raw error's
// .message/.stack. warn()/error() are therefore dropped entirely rather
// than attempting content-based redaction on arbitrary free text - regex-
// matching "does this look like a header/cookie" is exactly the kind of
// incomplete safety net the task's own "must NEVER log" requirement is
// stricter than. info()-level messages are passed through as-is: checked
// directly against electron-updater's current source, every info() call
// site only ever interpolates known-safe primitives (version strings,
// staging percentages, the update artifact's own public GitHub download
// URL) - never a caught error.
//
// updater.js's own explicit `autoUpdater.on('error', ...)` listener
// (using describeErrorForLog, which *does* have the real error object, not
// a pre-formatted string) remains the sole source of truth for what the
// console sees about an update failure.
function createSanitizedUpdaterLogger(baseLogger = console) {
  return {
    info: (message) => baseLogger.info(message),
    warn: () => {},
    error: () => {},
  };
}

module.exports = { sanitizeUpdateError, describeErrorForLog, createSanitizedUpdaterLogger };
