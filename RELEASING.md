# Releasing KubeVerse

This document describes how to cut a real, signed-eventually, distributable
KubeVerse release. It covers the actual pipeline that exists in this repo
today (`.github/workflows/ci.yml`, `.github/workflows/release.yml`,
`scripts/set-version.js`, `scripts/validate-release-artifacts.js`) — nothing
here is aspirational.

## 1. Versioning

The root [package.json](package.json) `version` field is the single
authoritative version for the whole monorepo. Every workspace
(`shared`, `backend`, `frontend`, `desktop`) carries the same version, kept
in sync by a script — never edit a workspace's `version` field by hand.

To bump the version:

```
npm run version:set -- 3.1.0
```

This updates all five `package.json` files (root + four workspaces) and the
internal `@kubeverse/shared` dependency pin in `backend/package.json` and
`frontend/package.json`, using targeted string replacement so the rest of
each file's formatting is untouched. `desktop/src/version.test.js` asserts
these all agree — run it (or the full desktop test suite) after bumping.

Commit the version bump on its own:

```
git add package.json shared/package.json backend/package.json frontend/package.json desktop/package.json
git commit -m "chore: bump version to 3.1.0"
```

## 2. Run the full test suite locally first

```
npm run test:all
npm run typecheck:all
npm run build:all
```

Do this before tagging. The release workflow re-runs all of this against the
tagged commit too (see §5), but catching a failure locally is faster than
waiting on CI.

## 3. Build and inspect the desktop package locally (optional but recommended)

```
npm run package --workspace=@kubeverse/desktop
node scripts/validate-release-artifacts.js
```

On Linux this produces `desktop/release/KubeVerse-<version>-linux-x86_64.AppImage`
and `desktop/release/KubeVerse-<version>-linux-amd64.deb`. Windows artifacts
(`KubeVerse-<version>-win-x64.exe`) can only be built and meaningfully
inspected on a real Windows machine or the Windows CI runner (see §7) — do
not trust an artifact "built" for Windows from a cross-compile on Linux.

## 4. Tag convention

Release tags follow `vX.Y.Z`, matching the package version exactly (a `v`
prefix, then semver). For example, if `package.json` says `"version":
"3.1.0"`, the tag is `v3.1.0`.

**Tags are never created or pushed automatically.** Cutting a release is a
deliberate, human action:

```
git tag v3.1.0
git push origin v3.1.0
```

Pushing the tag is what triggers `.github/workflows/release.yml`. Pushing to
`main` or opening a pull request never publishes a release — that only runs
`.github/workflows/ci.yml`, which builds and validates artifacts but uploads
them as short-lived workflow artifacts, not a GitHub Release.

## 5. What CI does automatically once you push a tag

`.github/workflows/release.yml`:

1. Re-runs `test:all`, `typecheck:all`, `build:all` on `ubuntu-latest`
   against the exact tagged commit.
2. On a matrix of `ubuntu-latest` and `windows-latest` (no macOS yet), each
   validates that the pushed tag's version matches `package.json`, then runs
   `npm run release --workspace=@kubeverse/desktop`, which packages the app
   and — because `desktop/package.json`'s `build.publish` block points at
   this repo's GitHub Releases and `electron-builder --publish always` is
   passed — uploads that platform's artifacts to a GitHub Release matching
   the tag, creating the release if it doesn't exist yet.
3. Runs `scripts/validate-release-artifacts.js` on each runner as a final
   sanity check (file exists, non-zero size, correct name/version).

No custom GitHub secret is required for this: `secrets.GITHUB_TOKEN`, which
GitHub Actions provides automatically to every workflow run, has sufficient
permission for `electron-builder`'s GitHub publish step (this workflow
explicitly grants `permissions: contents: write` for exactly that).

## 6. Code signing

**Not configured yet.** Today's release artifacts are **unsigned**:

- **Windows**: no Authenticode certificate is configured. Users installing
  the NSIS `.exe` will see an "Unknown Publisher" SmartScreen warning. To
  enable signing later, obtain a code-signing certificate, then set the
  `CSC_LINK` (path or URL to the `.pfx`) and `CSC_KEY_PASSWORD` GitHub
  Secrets — `electron-builder` picks these up automatically with no config
  changes needed.
- **Linux**: AppImage/`.deb` signing is not configured. AppImages can
  optionally be GPG-signed; this is left for a future pass.

This is intentionally not faked. Do not represent artifacts as signed until
`CSC_LINK`/`CSC_KEY_PASSWORD` are actually configured and a signed build has
been verified.

## 7. Verifying a release actually worked

- **Linux**: download the `.AppImage`, `chmod +x`, run it; download the
  `.deb`, `dpkg -I` it to check metadata, optionally `apt install` it in a
  disposable VM/container.
- **Windows**: this can only be genuinely verified using the artifact built
  by the `windows-latest` GitHub Actions runner (or a real Windows machine)
  — never claim a Windows build "works" based on the Linux build succeeding,
  a local cross-compile, or code review alone.
- Confirm the GitHub Release page shows both platform artifacts attached,
  with filenames matching `KubeVerse-<version>-<os>-<arch>.<ext>`.

## 8. Auto-update

Installed copies of KubeVerse check GitHub Releases for a newer version
automatically (electron-updater, `desktop/src/updater.js`) shortly after
launch, and again if the user clicks "Check for Updates" in Settings. This
means: once a release is published per §5, users on an older version will
be offered it — there is no separate "promote to users" step. See
`KUBEVERSE_MASTER_SPEC.md`'s Phase 3B section for the full update UX.

## 9. If something goes wrong

- **CI failed before publishing anything**: nothing was released — no
  GitHub Release was created, so there's nothing to clean up. Fix the
  issue, commit, and push a new tag (do not reuse a failed tag name).
- **One platform published, the other failed** (e.g. Linux succeeded,
  Windows failed): the GitHub Release now exists but is missing an
  artifact. Do not tell users to download it yet. Either delete the
  partial release and its tag (`git push --delete origin vX.Y.Z`, then
  delete the release in the GitHub UI) and re-tag once fixed, or re-run
  the failed matrix job from the Actions UI if the fix doesn't require a
  code change.
- **Published, but the artifact itself is broken**: delete the GitHub
  Release (and the tag, if you don't want it reused), fix the issue, bump
  to a new patch version, and cut a new tag. Never overwrite a previously
  published version's artifacts in place — always ship a new version
  number.
