// Production build for the desktop app (KubeVerse Phase 3): bundles the
// backend's own first-party source (backend/src/** plus the tiny
// @kubeverse/shared workspace package, which has real runtime exports -
// clusterKinds - not just types) into one standalone ESM file. Real npm
// dependencies stay external/unbundled - the packaged app ships node_modules
// alongside dist/, and leaving native/CJS-interop-sensitive packages like
// @kubernetes/client-node and fastify to Node's own module resolution avoids
// esbuild having to understand their internals at all.
//
// Dev is untouched: `npm run dev` still runs `tsx watch src/server.ts`
// directly against source, no build step involved. This script only powers
// `npm run build` -> `dist/server.mjs`, which the desktop shell spawns as a
// plain `node dist/server.mjs` child process (see desktop/src/backend.js).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => name !== '@kubeverse/shared');

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
