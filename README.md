# Local Microservice Architecture Simulator

This repository is a self-contained learning environment for Docker, Kubernetes,
service networking, reverse proxies, observability, and production debugging.

It intentionally simulates a production-shaped backend without connecting to any
cloud service, external database, third-party API, or real business system.

## Learning boundaries

- Everything runs on one computer through Docker Compose.
- MongoDB and Redis will be local containers containing only sample data.
- Application services will return deterministic or simulated results.
- Kubernetes manifests use a separate, local registry-based learning workflow.
- CI/CD configuration is intentionally deferred for a later learning exercise.

## Planned request flow

```text
Client -> Nginx -> Gateway API -> Validation Service
                              -> Security Service
                              -> OCR Service
                              -> Notification Service (optional)
```

The Gateway will coordinate downstream calls and aggregate a simulated response.
Services will emit in-memory lifecycle events and expose health and metrics
endpoints for later visualization and monitoring exercises.

## Repository layout

```text
services/       Independently deployable application services.
shared/         Small, versioned code shared by services (kept framework-neutral).
infra/          Local-only infrastructure configuration, such as Nginx.
docs/           Architecture notes and learning milestones.
```

## Milestones

1. Repository structure and architecture contract — complete.
2. Shared service foundation: configuration, endpoints, metrics, and events.
3. Simulated domain services and the Gateway orchestration flow.
4. Dockerfiles, Nginx, MongoDB, Redis, and `docker compose up` — complete.
5. Local registry image workflow and Kubernetes Deployment manifests — complete.
6. CI/CD pipeline — intentionally deferred.

See [docs/architecture.md](docs/architecture.md) for the service contract.

## Run the completed local backend

```bash
docker compose up --build
```

The public local entry point is `http://localhost:8080`. See
[docs/running-locally.md](docs/running-locally.md) for a sample request and
debugging endpoints.

## Kubernetes image workflow

Kubernetes pulls images from a local registry rather than relying on Docker's
host image cache. The existing Docker Compose workflow remains unchanged. See
[k8s/README.md](k8s/README.md) for the local registry, build/push, deployment,
and image-update workflow.
