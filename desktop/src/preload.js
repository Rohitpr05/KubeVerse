// Runs in an isolated context with Node access, before the renderer's own
// scripts (Electron's standard contextBridge pattern - Phase 3, §9). Exposes
// nothing to the renderer today: the renderer only ever needs plain HTTP/SSE
// to the local backend, exactly like the browser dev workflow, so there is
// currently no privileged capability worth bridging. Kept as an explicit,
// empty boundary rather than omitted, so a future genuinely-privileged need
// (e.g. "reveal project folder in file manager") has one obvious, reviewed
// place to add a narrow, typed API - never direct Node/fs/shell access.
