<p align="center">
  <img src="branding/kubeverse-icon-tile.svg" alt="KubeVerse logo" width="96" height="96" />
</p>

<h1 align="center">KubeVerse</h1>

<p align="center">
  A local-first desktop workstation for learning Docker and Kubernetes by building, running, and observing real applications.
</p>

<p align="center">
  <a href="#download-kubeverse">Download</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#key-features">Features</a> ·
  <a href="#development">Development</a> ·
  <a href="KUBEVERSE_MASTER_SPEC.md">Full Spec</a>
</p>

---

KubeVerse is an open-source, native desktop application. You describe a small application in plain language, KubeVerse's AI Builder turns that into a real, runnable project (source code, Dockerfiles, Docker Compose, Kubernetes manifests), and you run and observe it against your own local Docker and Kubernetes — with a live, visual explorer for what's actually happening underneath.

Everything — your projects, generated code, and configuration — stays on your machine. See [Local-First & Privacy](#local-first--privacy) for exactly what does and doesn't leave your computer.

## Download KubeVerse

**If you just want to use KubeVerse, you do not need to clone this repository, install Node.js, or build anything.** This source repository is for development and contribution — normal users should download the packaged desktop application from GitHub Releases.

**[Get KubeVerse from the GitHub Releases page →](https://github.com/Rohitpr05/KubeVerse/releases)**

The current version is **v4.3.0**, packaged as:

- **Linux** — [`KubeVerse-4.3.0-linux-x86_64.AppImage`](https://github.com/Rohitpr05/KubeVerse/releases/download/v4.3.0/KubeVerse-4.3.0-linux-x86_64.AppImage) (portable) or [`KubeVerse-4.3.0-linux-amd64.deb`](https://github.com/Rohitpr05/KubeVerse/releases/download/v4.3.0/KubeVerse-4.3.0-linux-amd64.deb) (system install)
- **Windows** — [`KubeVerse-4.3.0-win-x64.exe`](https://github.com/Rohitpr05/KubeVerse/releases/download/v4.3.0/KubeVerse-4.3.0-win-x64.exe) (installer)

See [Linux](#linux) / [Windows](#windows) below for exact setup steps once you've downloaded the file for your OS.

## Using KubeVerse vs. Developing KubeVerse

**Using KubeVerse** — download and run the packaged app. The packaged desktop build already contains the frontend and backend runtime KubeVerse needs, so no Node.js, npm, or source checkout is required:

```text
GitHub Releases
      ↓
Download installer for your OS
      ↓
Install KubeVerse
      ↓
Launch KubeVerse
```

**Developing KubeVerse** — if you want to modify KubeVerse itself, clone the repository and follow the [Development](#development) section below, which documents the actual `npm` workflow, tests, and build commands. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contribution process.

## Screenshots

Screenshots will be added soon.

## Why KubeVerse Exists

Kubernetes is powerful, but a beginner has to hold a lot of invisible concepts in their head at once: Pods, Deployments, ReplicaSets, Services, containers, networking, scheduling, health checks, scaling, failures, self-healing — usually all at the same time, with nothing to actually look at.

KubeVerse tries to make those concepts visible and experimentable: generate a small real system, deploy it, and watch what Kubernetes actually does — rather than reading about it in the abstract.

## Key Features

| Feature | What it does |
| --- | --- |
| **AI Architecture Builder** | Describe an application in an `architecture.md` file (or plain text) and compile it into a structured, schema-validated architecture using your own AI provider API key. |
| **Docker generation** | Generates a `Dockerfile` per service and a `docker-compose.yml` for the whole project — ready to run with `docker compose up`. |
| **Kubernetes generation** | Generates Kubernetes manifests (Deployments, Services, ConfigMaps, Secrets, PVCs, Ingress) from the same validated architecture. |
| **Visual Playground** | A live topology explorer for whatever is actually running in your configured Kubernetes context — Namespaces, Nodes, Pods, Services, and more, streamed in real time. |
| **Traffic simulation** | Generates real traffic against a running project and animates it flowing across the live topology. |
| **Failure experiments** | Deletes a real Pod on request and observes Kubernetes' own self-healing (a real replacement Pod converging), visualized as it happens. |
| **Live state, not animation** | The Playground reflects what the Kubernetes API actually reports — it never invents Pods, scaling events, or recovery outcomes. |
| **Optional Google sign-in** | Desktop-only, identity only (via Firebase Authentication) — never required, never gates any local functionality. |
| **Automatic update checks** | Checks GitHub Releases in the background and shows a non-blocking banner when a new version is available — see [Automatic Updates](#automatic-updates). Never installs or restarts without your explicit action. |

The AI Builder step requires your own API key from a supported AI provider (OpenRouter today) — KubeVerse does not provide free or bundled AI inference. Every other feature above works without one.

## Requirements

**To install and run the desktop app:**

- Linux (x64) or Windows (x64)

**Needed for specific features, not to launch the app:**

| Dependency | Needed for | If missing |
| --- | --- | --- |
| Docker | Building and running a generated project's containers | KubeVerse still launches; Docker-dependent actions are unavailable until it's running |
| A local Kubernetes context + `kubectl` | The Playground's live Kubernetes explorer, traffic simulation, failure experiments | KubeVerse still launches; Kubernetes-dependent views show as unavailable |
| An AI provider API key (OpenRouter today) | The AI Builder's Compile step | Everything else works; you can still open/create projects and browse the app |

KubeVerse's first-launch checklist reports the real status of each of these — it never silently installs or assumes any of them (see [First Launch](#first-launch)).

## Installation

Once you've downloaded the right file for your OS from [GitHub Releases](https://github.com/Rohitpr05/KubeVerse/releases) (see [Download KubeVerse](#download-kubeverse) above), follow the steps below.

### Linux

KubeVerse packages as an **AppImage** (portable, no installation) and a **`.deb`** (installs system-wide with proper desktop/menu integration). Both are built for x86_64 — no other Linux architectures are currently packaged.

#### AppImage

The portable option — runs directly, no package manager or installation step required:

1. Download `KubeVerse-4.3.0-linux-x86_64.AppImage` from the v4.3.0 GitHub Release.
2. Make it executable and run it:

```bash
chmod +x KubeVerse-4.3.0-linux-x86_64.AppImage
./KubeVerse-4.3.0-linux-x86_64.AppImage
```

This has been verified to run as a standalone AppImage; it is not guaranteed to work identically across every Linux distribution.

#### Debian / Ubuntu

`KubeVerse-4.3.0-linux-amd64.deb` is intended for Debian/Ubuntu-based distributions and installs KubeVerse with a proper application menu entry and dock icon:

```bash
sudo apt install ./KubeVerse-4.3.0-linux-amd64.deb
```

> Without an AppImage integration tool (e.g. `AppImageLauncher`) installed on your system, the AppImage won't get a desktop menu entry or a proper dock icon on some desktop environments — this is standard AppImage behavior, not specific to KubeVerse. The `.deb` install doesn't have this limitation.

### Windows

KubeVerse packages as an **NSIS installer**:

1. Open the [v4.3.0 GitHub Release](https://github.com/Rohitpr05/KubeVerse/releases).
2. Download `KubeVerse-4.3.0-win-x64.exe`.
3. Run the installer and follow the prompts.
4. Launch KubeVerse from the Start Menu or your desktop shortcut.

The installer is currently **unsigned** (no code-signing certificate is configured yet — see [`RELEASING.md`](RELEASING.md) §6), so Windows SmartScreen will show an "Unknown Publisher" warning on first run.

> The Windows installer is currently provided as a cross-built artifact and has not yet been independently verified on a physical Windows system. If you encounter an installation or runtime problem, please report it through [GitHub Issues](https://github.com/Rohitpr05/KubeVerse/issues).

## First Launch

```text
Launch KubeVerse
      │
      ▼
KubeVerse local service check
      │
      ▼
Docker check
      │
      ▼
Kubernetes check
      │
      ▼
kubectl check
      │
      ▼
(optional) Continue with Google, or Skip for now
      │
      ▼
KubeVerse Playground
```

On first launch, KubeVerse checks your local environment and reports exactly what it finds — it never installs Docker, Kubernetes, or `kubectl` for you, and it never blocks you from continuing because one of them is unavailable. You can revisit any of these later from **Settings**.

## Getting Started

1. Install KubeVerse (see [Installation](#installation)).
2. Start Docker, if you want to run generated projects.
3. Start or enable your local Kubernetes cluster, if you want the Playground's Kubernetes features.
4. Launch KubeVerse and complete the first-launch environment check.
5. In **Projects**, open or create a local project directory.
6. Open **AI Builder** and write (or load) an `architecture.md` description of the application you want.
7. If you haven't already, configure your AI provider API key in **Settings**.
8. Click **Compile Architecture** — KubeVerse validates the AI's output against a strict schema before trusting it.
9. Click **Generate Project** to write real source code, Dockerfiles, `docker-compose.yml`, and Kubernetes manifests into your project directory.
10. Run what was generated: `docker compose up --build` from the project's `docker/` folder, or `kubectl apply -f kubernetes/ --recursive` against your own cluster.
11. Open **Playground** to watch the real, live state of what you just deployed.
12. Try traffic simulation and Pod failure experiments against it.

## AI Builder

```text
architecture.md
      │
      ▼
  AI Builder  ──(your API key)──▶  AI provider
      │
      ▼
Structured architecture (schema-validated)
      │
      ▼
Generated services + Dockerfiles
      │
      ▼
docker-compose.yml + Kubernetes manifests
      │
      ▼
Playground
```

The AI Builder never trusts an AI provider's output directly: what comes back is parsed and validated against a strict schema before anything is generated. If it fails validation, you see the validation errors, not a broken project.

You provide your own AI provider API key in **Settings** (OpenRouter is the only supported provider today). The key is entered once, saved locally, and can be checked with **Test Connection**. It is never displayed back to you after saving, and is only ever sent to the provider you configured — never anywhere else, and never included in this repository or any generated file.

## Google Sign-In

KubeVerse's desktop app supports an optional "Continue with Google" step, offered during first-launch onboarding and available any time afterward from the account menu.

- It's authentication only: it identifies which Google account is using the app, nothing more.
- Sign-in is backed by **Firebase Authentication** — Firebase acts as the identity provider for the Google sign-in flow.
- Signing in does not mean your Kubernetes projects, generated code, or any other local data is stored remotely. Authentication and project/data storage are entirely separate systems in KubeVerse — see [Local-First & Privacy](#local-first--privacy) below.
- Sign-in is entirely optional. Skipping it (choosing "Skip for now") does not disable or limit any feature. If a given build doesn't have sign-in configured, "Continue with Google" reports that clearly rather than failing silently — KubeVerse still launches and works fully either way.

## Local-First & Privacy

KubeVerse is built to run entirely on your machine:

- Projects, `architecture.md` files, generated source code, Dockerfiles, and Kubernetes manifests are plain files in your project directory — nothing is uploaded or synced to a KubeVerse-owned server, because there isn't one.
- Docker and Kubernetes interactions happen directly against your own local Docker/Kubernetes — KubeVerse does not run or manage a cloud cluster.
- Your AI provider API key is stored locally and is only ever sent to the AI provider you configured, when you compile an architecture.
- Optional Google sign-in (see [Google Sign-In](#google-sign-in) above) identifies who's using the app via Firebase Authentication and nothing more — it does not gate, upload, or sync any project, generated code, or Docker/Kubernetes state. Firebase is used for authentication only in KubeVerse; no other Firebase service is involved. See [`KUBEVERSE_MASTER_SPEC.md`](KUBEVERSE_MASTER_SPEC.md) §7 for the exact data boundary.
- The packaged desktop app bundles the frontend and backend runtime KubeVerse needs to run — you don't need to separately install Node.js or any other runtime to use it.

To be precise, rather than overstate this: KubeVerse itself has no cloud backend and no project database, but network requests you explicitly trigger — an AI Builder compile, or signing in with Google — do necessarily send data to that specific external provider (your AI provider, or Google/Firebase for sign-in). One request is not user-triggered: the packaged app automatically checks GitHub Releases for a newer version shortly after launch (see [Automatic Updates](#automatic-updates)) — a plain version check, nothing else. Nothing else leaves your machine.

### Where your data lives

| Data | Location |
| --- | --- |
| Projects (`architecture.md`, generated source, Docker/Kubernetes output) | Wherever you choose to open or create a project directory — the packaged app suggests your OS `Documents/KubeVerse` folder as a starting point, but any location works |
| App settings, installation identity, and local auth session | An OS-standard app-config location under a `KubeVerse` folder (e.g. `~/.config/KubeVerse` on Linux, `%APPDATA%\KubeVerse` on Windows) |

KubeVerse never stores your projects inside its own installation folder, and reinstalling or updating KubeVerse does not touch your project directories.

## Docker & Kubernetes Setup

If you're new to either of these:

- **Docker** runs containers — it builds and runs the individual services KubeVerse generates for you.
- **Kubernetes** orchestrates containers across a cluster — it decides where Pods run, restarts them when they fail, and exposes them as Services.
- **KubeVerse** doesn't replace either one — it generates real Docker/Kubernetes configuration for you, and visualizes what's actually happening once you run it, so you can see the relationship between the two rather than just reading about it.

You'll need Docker running to build/run a generated project's containers, and a working local Kubernetes context (any distribution — for example Docker Desktop's built-in Kubernetes, minikube, kind, or k3d) with `kubectl` configured against it for the Playground's Kubernetes features. KubeVerse uses whatever kubeconfig context is already active on your system — it does not set one up for you.

## Development

This section is for contributors working on KubeVerse itself, not for end users installing the packaged app.

```bash
git clone https://github.com/Rohitpr05/KubeVerse.git
cd KubeVerse
npm install
npm run dev
```

`npm run dev` starts the backend (`http://localhost:4000`) and frontend (`http://localhost:5173`) together for browser-based development. Open `http://localhost:5173`.

| Command | Description |
| --- | --- |
| `npm run dev` | Backend + frontend together, browser dev mode |
| `npm run dev:backend` / `npm run dev:frontend` | Either half alone |
| `npm run desktop:dev` | Same app inside an Electron window instead of a browser tab |
| `npm test` | Backend unit tests |
| `npm run test:all` | Backend + frontend + desktop unit tests |
| `npm run typecheck:all` | TypeScript checks (backend + frontend) |
| `npm run build:all` | Production backend + frontend builds |
| `npm run desktop:build` | Full production build plus a packaged desktop artifact for your current OS |

There is currently no linter configured in this repository. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contribution workflow (branching, pull requests, per-package commands), and [`RELEASING.md`](RELEASING.md) for how a maintainer actually cuts a tagged release.

## Project Structure

```text
KubeVerse/
├── backend/                  Fastify backend: Kubernetes observer + KubeVerse product API
├── frontend/                 React app shell: Playground, AI Builder, Architectures, Projects, Settings
├── desktop/                  Electron desktop shell: packaging, local backend lifecycle
├── shared/                   @kubeverse/shared - the backend↔frontend Kubernetes contract
├── branding/                 Official KubeVerse logo/mark assets
├── examples/legacy-simulator/  Self-contained legacy demo application (not part of KubeVerse core)
├── docs/                     Supporting design notes
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
└── SECURITY.md
```

See [`KUBEVERSE_MASTER_SPEC.md`](KUBEVERSE_MASTER_SPEC.md) for the full technical architecture, what's implemented today versus planned, and the complete security/privacy model.

## Roadmap

Status below is drawn directly from [`KUBEVERSE_MASTER_SPEC.md`](KUBEVERSE_MASTER_SPEC.md)'s roadmap (§18).

**Completed:**

| Phase | What it delivered |
| --- | --- |
| 1 — Core Application | Project workspace, AI architecture compiler, schema validation, Docker/Kubernetes generators |
| 2 — Playground & Simulation | Live Kubernetes topology, traffic simulation, Pod failure experiments, real Kubernetes self-healing |
| 3 — Desktop Application | Electron shell, packaging (AppImage/`.deb`/NSIS), first-launch onboarding |
| 4 — Hardening & Public-Release Readiness | Security and correctness fixes found by running the app end-to-end (CORS, path traversal, probe protocol bugs, and more) |
| 5 — Identity, Authentication & Local-First Privacy | Optional "Continue with Google" sign-in, identity only |
| 6 — Firebase Authentication | Google sign-in brokered through Firebase Authentication as the identity provider |
| 7 — Desktop Distribution, Auto-Updates & Windows Polish | Finished the update lifecycle (see [Automatic Updates](#automatic-updates) below), Windows application icon fix, longer backend startup allowance, a more compact sign-in trigger in the top bar |

**Planned / future work** (not yet implemented):

- Code signing for Windows and Linux release artifacts
- OS keychain storage for the AI provider API key (currently a documented local-file fallback)
- macOS packaging
- A dedicated experiment/simulation engine and guided learning content
- Additional Kubernetes observability (resource-version-aware watch continuity, network policy awareness, metrics providers)
- Optional collaboration/cloud sync — deliberately deferred, and would remain opt-in given KubeVerse's local-first design

## Educational Use

KubeVerse is designed to help people learn Kubernetes and Docker concepts by watching them happen against a real, small system they built themselves — Pods, Deployments, ReplicaSets, Services, scheduling, health checks, traffic, failures, self-healing, and how Docker and Kubernetes relate to each other. It's aimed at students, educators, and anyone learning Kubernetes hands-on. It is not currently adopted by any university or institution — this is an open-source project anyone can use or teach with.

## Releases

Official packaged builds are distributed only through [GitHub Releases](https://github.com/Rohitpr05/KubeVerse/releases) — see [Download KubeVerse](#download-kubeverse) above. Do not download KubeVerse from any third-party binary host.

- **Linux**: AppImage (portable) and a Debian/Ubuntu `.deb` package.
- **Windows**: an NSIS `.exe` installer.

Each release is tagged `vX.Y.Z` and lists the exact artifacts attached (see [`RELEASING.md`](RELEASING.md) for how a maintainer cuts one).

## Automatic Updates

KubeVerse checks GitHub Releases for a newer version shortly after launch, and again any time you click **Check for Updates** in Settings. This check is a plain request to GitHub's public Releases API — no analytics, tracking, or third-party service is involved, and it never happens in a build you've built yourself for development.

- If nothing new is available, nothing happens — no notification, no interruption.
- If a newer version is available, a small banner appears with a **Download Update** button. Nothing downloads until you click it.
- Once downloaded, the banner offers **Restart and Update** — KubeVerse never restarts or installs anything on its own.
- If the check or download fails for any reason (offline, GitHub unreachable), KubeVerse keeps working normally — an update problem never affects your projects, Docker, or Kubernetes access.

**Platform differences, stated precisely:** on Windows and the Linux AppImage, restarting to install is fully silent. On the Linux `.deb` install, installing an update requires your system password (a `pkexec`/`sudo` prompt) — this is normal Linux package-manager behavior, not a KubeVerse limitation, and there's nothing you need to configure for it.

## Security

Found a security vulnerability? Please **do not** open a public GitHub issue. See [SECURITY.md](SECURITY.md) for how to report it privately.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to report issues, propose features, and submit pull requests.

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [License](LICENSE)

## Project Name and Branding

The KubeVerse name, logo, and associated project branding are not covered by the Apache License 2.0. The software license does not grant permission to use the project's branding in a way that implies endorsement, sponsorship, or official affiliation with the KubeVerse project or its maintainers. "KubeVerse" is not a registered trademark.

## License

KubeVerse is licensed under the Apache License 2.0.

See the [LICENSE](LICENSE) file for the complete license text.

Copyright © 2026 Rohit PR.

## Contact

For bugs and feature requests, use [GitHub Issues](https://github.com/Rohitpr05/KubeVerse/issues). For security vulnerabilities, see [Security](#security) above instead.
