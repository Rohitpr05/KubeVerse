# Local registry Kubernetes workflow

This directory deliberately uses a registry workflow rather than Docker's local
image store. Kubernetes nodes run containerd (or another CRI runtime), so an
image successfully built by Docker is not automatically available to a Pod.

Application Deployments use these local registry images:

```text
localhost:5000/k8s-dockersimulator-gateway:latest
localhost:5000/k8s-dockersimulator-validation:latest
localhost:5000/k8s-dockersimulator-security:latest
localhost:5000/k8s-dockersimulator-ocr:latest
```

MongoDB and Redis are mirrored into the same registry under their versioned
tags. This keeps every workload on the same pull-based distribution mechanism.

## 1. Make the registry reachable from Kubernetes nodes

Start the local registry once:

```bash
docker compose -f docker-compose.registry.yml up -d
curl http://localhost:5000/v2/
```

The response should be `{}`. The registry has no cloud dependency and its data
is stored in the local Docker volume `local-registry-data`.

Important: `localhost` in an image name is interpreted by the *Kubernetes node*
performing the pull, not necessarily by the computer running `kubectl`. Before
applying these manifests, configure your cluster's container runtime so its
nodes can reach `localhost:5000` as an insecure HTTP registry, or configure a
registry mirror for that host. This is a Kubernetes-runtime requirement, not a
Docker Desktop feature.

For containerized local clusters, the usual pattern is to connect the registry
container to the cluster network and configure containerd to mirror
`localhost:5000` to the registry container. Consult the cluster distribution's
registry configuration instructions, then verify access from a node before
deploying. If nodes cannot reach that address, use a registry hostname/address
reachable from every node and update both `LOCAL_REGISTRY` and the manifest image
references consistently.

## 2. Build and push application images

From the repository root:

```bash
./scripts/build-and-push-images.sh
```

The script executes `docker build` and `docker push` for Gateway, Validation,
Security, and OCR. Set `LOCAL_REGISTRY` if the registry is available at another
node-reachable address:

```bash
LOCAL_REGISTRY=registry.example.local:5000 ./scripts/build-and-push-images.sh
```

For the local MongoDB and Redis workloads, mirror their upstream base images to
the registry once (or whenever their source version changes):

```bash
./scripts/mirror-infrastructure-images.sh
```

## 3. Deploy and inspect

```bash
./scripts/deploy-k8s.sh
kubectl get pods -n k8s-simulator
```

Every application Deployment uses `imagePullPolicy: Always` because `latest` is
a mutable local learning tag. MongoDB and Redis use versioned, immutable-looking
tags with `IfNotPresent`. In a production registry workflow, replace `latest`
with an immutable build tag or digest and use `IfNotPresent`.

## 4. Update after code changes

Build and push again, then recreate Pods so the `Always` policy pulls the new
mutable tag:

```bash
./scripts/build-and-push-images.sh
kubectl rollout restart deployment -n k8s-simulator
kubectl rollout status deployment/gateway -n k8s-simulator
```

Use `kubectl get pods -n k8s-simulator` and `kubectl describe pod <pod> -n
k8s-simulator` to diagnose pull failures. `ErrImageNeverPull` should no longer
occur because the manifests no longer use `imagePullPolicy: Never` or reference
host-only Docker images.

## Local Compose remains independent

Continue using the original local developer workflow unchanged:

```bash
docker compose up --build
```

It uses its own Compose builds and does not require the registry. The registry
Compose file and scripts are only for Kubernetes deployments.
