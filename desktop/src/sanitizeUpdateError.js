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

module.exports = { sanitizeUpdateError };
