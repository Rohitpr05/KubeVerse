#!/usr/bin/env sh
# Mirrors third-party infrastructure images into the same local registry so cluster nodes use one image source.
set -eu

registry="${LOCAL_REGISTRY:-localhost:5000}"

mirror() {
  source="$1"
  destination="$2"
  docker pull "${source}"
  docker tag "${source}" "${registry}/${destination}"
  docker push "${registry}/${destination}"
}

mirror "mongo:8.2" "k8s-dockersimulator-mongodb:8.2"
mirror "redis:7.4-alpine" "k8s-dockersimulator-redis:7.4-alpine"
