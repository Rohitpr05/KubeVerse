# Contributing to KubeVerse

Thanks for your interest in contributing to KubeVerse. This document explains how to report issues, propose changes, and submit pull requests.

## Reporting Bugs

Please report reproducible bugs using [GitHub Issues](../../issues). A good bug report includes:

- What happened
- What you expected to happen instead
- Steps to reproduce the issue
- Relevant logs, error messages, or screenshots
- Environment information when relevant (OS, Node.js version, Docker/Kubernetes version and distribution, browser)

If you believe you've found a **security vulnerability**, do not open a public issue — see [SECURITY.md](SECURITY.md) instead.

## Feature Requests

Feature requests are also welcome as [GitHub Issues](../../issues). Please include:

- The problem you're trying to solve
- Your proposed solution
- Why it would be useful to KubeVerse users
- Any alternatives you considered

## Forking

To contribute code, start by forking the repository to your own GitHub account, then clone your fork locally.

## Creating a Branch

Work on a focused feature or fix branch rather than committing directly to the default branch (`main`), for example:

```bash
git checkout -b fix/short-description-of-the-change
```

## Making Changes

- Keep changes focused on a single bug fix or feature.
- Follow the existing conventions and style already used in the surrounding code.
- Don't modify unrelated parts of the application as part of an unrelated change.
- Update documentation (README, `KUBEVERSE_MASTER_SPEC.md`, etc.) when your change affects documented behavior.
- Add or update tests when your change affects tested behavior.
- Avoid adding, removing, or upgrading dependencies unless the change genuinely requires it.

## Running Checks

KubeVerse is an npm workspace with three packages: `shared`, `backend`, and `frontend`. Run the following from the repository root unless noted otherwise.

**Install dependencies (once):**

```bash
npm install
```

**Backend tests:**

```bash
npm test
```

(This runs `@kubeverse/backend`'s test suite - `node --import tsx --test 'src/**/*.test.ts'`.)

**Backend TypeScript check:**

```bash
cd backend && npm run typecheck
```

**Frontend tests:**

```bash
cd frontend && npm test
```

**Frontend build (includes a TypeScript project build via `tsc -b`):**

```bash
cd frontend && npm run build
```

There is currently no linter configured in this repository, so there is no lint command to run as part of your checks.

If your change touches the legacy demo application under `examples/legacy-simulator/`, see that directory's own `README.md` for how to install and test it - it is a separate, self-contained npm workspace and is not part of KubeVerse's product core.

## Pull Requests

- Open your pull request against the repository's default branch.
- Describe **what** changed and **why**.
- Mention which checks and tests you ran locally (see above).
- Keep the pull request focused - avoid bundling unrelated changes together.
- Be responsive to review feedback.
- Where practical, keep commits understandable (e.g. avoid a single commit that mixes several unrelated changes).

## Contribution Licensing / Ownership

KubeVerse is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution, you agree that it is submitted under the project's applicable licensing terms (the Apache License 2.0). You retain whatever rights you legally hold in your own contribution, as applicable.

Contributing to KubeVerse does not make you a co-owner of the project, does not transfer ownership of the upstream GitHub repository, and does not transfer ownership of the KubeVerse name, logo, or branding. The project remains maintained by its existing upstream maintainers.
