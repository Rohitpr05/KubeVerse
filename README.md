# KubeVerse

KubeVerse is an open-source, local-first workstation for learning Docker and Kubernetes: describe a small application in plain language, let KubeVerse generate a real runnable version of it (source code, Dockerfiles, Docker Compose, Kubernetes manifests), and observe it running on your own local Docker/Kubernetes.

Everything runs on your machine. KubeVerse does not run a hosted cluster, does not store your architecture or generated code remotely, and your AI provider key never leaves your machine except to call that provider.

See [`KUBEVERSE_MASTER_SPEC.md`](KUBEVERSE_MASTER_SPEC.md) for the full architecture, what's implemented today vs. planned, and the security/privacy model.

## Prerequisites

- Node.js 22+
- A local Kubernetes context (any distribution) if you want to use the Playground's live Kubernetes explorer
- Docker, if you want to build/run a project KubeVerse generates for you
- An AI provider API key (OpenRouter today) if you want to use the AI Builder - everything else works without one

## Run it

```bash
npm install
npm run dev
```

This starts the backend (`http://localhost:4000`) and the frontend (`http://localhost:5173`) together. Open `http://localhost:5173`.

- `npm run dev:backend` / `npm run dev:frontend` — run either half alone.
- `npm test` — runs the backend's unit tests (NAM schema validation, the generators, local identity).

## Configuring an AI provider

Open the app, go to **Settings**, choose a model, and paste an OpenRouter API key. **Save**, then **Test Connection** to confirm it's valid. The key is stored at `~/.kubeverse/settings.json` with owner-only file permissions — never in this repository, never committed, never sent anywhere but OpenRouter. This is a documented development-mode fallback; see the master spec's §7 for the planned production (OS keychain) design.

## Using the AI Builder

1. **Projects** — open or create a local project directory.
2. **AI Builder** — write or paste an `architecture.md` description (or load one from disk), then **Compile Architecture**. KubeVerse sends it to your configured AI provider and validates the result against a strict schema before trusting it — the AI's output is never treated as final on its own.
3. Once compiled, **Generate Project** writes real source code, a `Dockerfile` per service, `docker/docker-compose.yml`, and Kubernetes manifests into your project directory. Preview any generated file right in the browser.
4. **Architectures** shows the current project's `architecture.md` and generation history.

From there, run what was generated the normal way: `docker compose up --build` from the project's `docker/` folder, or `kubectl apply -f kubernetes/ --recursive` against your own cluster.

## Playground

The **Playground** tab is a live, read-only explorer for whatever is running in your configured Kubernetes context — a generated project, the legacy demo below, or anything else. It streams Namespaces, Nodes, Deployments, Pods, Services, and more over Server-Sent Events onto a React Flow canvas, with an inspector panel for logs, events, and raw YAML. It does not modify your cluster.

## The legacy simulator

Before KubeVerse existed, this repository was a fixed-architecture learning simulator (Gateway → Validation/Security/OCR, MongoDB, Redis). It's preserved as a self-contained worked example at [`examples/legacy-simulator/`](examples/legacy-simulator/) — see its own README for how to run it. It is not part of KubeVerse's product core.

## Repository layout

```text
backend/                    Fastify backend: Kubernetes observer + KubeVerse product API
frontend/                   React app shell: Playground, AI Builder, Architectures, Projects, Settings
shared/                     @kubeverse/shared - the backend<->frontend Kubernetes contract
examples/legacy-simulator/  Self-contained legacy demo application (not part of KubeVerse core)
docs/                       Supporting design notes
```
