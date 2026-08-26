// Pure decision logic extracted out of PlaygroundView.tsx so it can be unit
// tested without a component-testing framework (none exists in this repo -
// see workspace.test.ts-style plain node:test usage elsewhere for the same
// pattern). This is the exact rule that fixed the "topology disappears"
// bug: a project id going missing is not, by itself, reason to reset a
// topology that was already loaded successfully.
export function shouldResetForProjectChange(loadedProjectId: string | undefined, nextProjectId: string | undefined): boolean {
  if (nextProjectId) return nextProjectId !== loadedProjectId;
  // nextProjectId is undefined. Only a "reset" if nothing had ever loaded -
  // otherwise this is a potentially-transient loss, handled by the grace
  // period timer in PlaygroundView, never an immediate reset.
  return !loadedProjectId;
}
