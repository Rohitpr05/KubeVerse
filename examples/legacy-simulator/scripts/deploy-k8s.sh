#!/usr/bin/env sh
# Applies the registry-backed local learning stack, then waits for each workload to become available.
set -eu

namespace="${K8S_NAMESPACE:-k8s-simulator}"
kubectl apply -k k8s

for deployment in mongodb redis validation security ocr gateway; do
  kubectl rollout status "deployment/${deployment}" --namespace "${namespace}" --timeout=120s
done
