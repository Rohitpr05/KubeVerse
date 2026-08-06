#!/usr/bin/env sh
# Builds every application image from the repository root, then publishes it to the local Kubernetes registry.
set -eu

registry="${LOCAL_REGISTRY:-localhost:5000}"
tag="${IMAGE_TAG:-latest}"

for service in gateway validation security ocr; do
  image="${registry}/k8s-dockersimulator-${service}:${tag}"
  echo "Building ${image}"
  docker build --file "services/${service}/Dockerfile" --tag "${image}" .
  echo "Pushing ${image}"
  docker push "${image}"
done
