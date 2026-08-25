# Legacy simulator (demo / example, not KubeVerse core)

This is the original fixed-architecture learning simulator the KubeVerse repository started as: a Gateway that fans out to Validation, Security, and OCR services, backed by local MongoDB and Redis containers, fronted by Nginx, with matching Kubernetes manifests under `k8s/`.

It is preserved here as a **worked example** — a small, real, multi-service application you can build, run, and deploy while learning Docker/Kubernetes, and as a reference example of the kind of application KubeVerse's architecture compiler and generators (see the root [`KUBEVERSE_MASTER_SPEC.md`](../../KUBEVERSE_MASTER_SPEC.md)) are meant to eventually produce automatically from a plain-language description. It is **not** part of KubeVerse's product core, is not read by the architecture compiler or code generators, and gets no special treatment from the Kubernetes observer beyond what any other workload gets.

This folder is a fully self-contained npm workspace root — it does not depend on anything at the repository root.

## Run with Docker Compose

```bash
cd examples/legacy-simulator
docker compose up --build
```

The public entry point is `http://localhost:8080`. See [`docs/running-locally.md`](docs/running-locally.md) for sample requests.

## Run on Kubernetes (local registry workflow)

See [`k8s/README.md`](k8s/README.md) for the local registry, build/push, and deploy workflow (`scripts/build-and-push-images.sh`, `scripts/mirror-infrastructure-images.sh`, `scripts/deploy-k8s.sh`).

## Run the Node test suite

```bash
cd examples/legacy-simulator
npm install
npm test
```

## Layout

```text
services/       Gateway, Validation, Security, OCR simulator services
shared/         Runtime helpers used by the services above (config, events, logging, metrics, request contract)
infra/          Local-only Nginx and MongoDB seed configuration
k8s/            Local-registry-backed Kubernetes manifests for this demo
scripts/        Build/push/deploy/mirror scripts for the Kubernetes workflow
docs/           Architecture contract and a runnable request walkthrough
docker-compose.yml, docker-compose.registry.yml
test/           Node test-runner coverage for the shared request contract
```
