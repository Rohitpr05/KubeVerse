// Same discipline as sanitizeUpdateError.js: the renderer never sees a raw
// error object/stack trace, only a clean, bounded, human-readable sentence.
// Unlike electron-updater's errors (which can be multi-line raw HTTP dumps -
// see sanitizeUpdateError.js), googleAuth.js's own thrown errors are already
// short, plain, human-written sentences ("Google sign-in was cancelled...",
// "Sign-in timed out...", plus Google's own short error_description text) -
// so this passes those through rather than collapsing everything to one
// generic string, while still guarding against anything unexpectedly long,
// multi-line, or non-Error reaching the UI.
function sanitizeAuthError(error) {
  const message = error && typeof error.message === 'string' ? error.message : String(error);
  const isCleanShortMessage = message.length > 0 && message.length <= 200 && !message.includes('\n');
  return isCleanShortMessage ? message : 'Google sign-in failed. Please try again.';
}

module.exports = { sanitizeAuthError };
