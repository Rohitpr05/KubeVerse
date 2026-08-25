# Architecture Contract

This document fixes the learning-oriented boundaries before application code is
written. It avoids accidental coupling to production systems and keeps the later
Kubernetes migration straightforward.

## Services

| Service | Responsibility | State |
| --- | --- | --- |
| Gateway API | Accept a simulated request, call downstream services, and aggregate their responses. | Stateless |
| Validation Service | Simulate work based on selected validation checks and return a dummy result. | Stateless |
| Security Service | Simulate work based on standard/deep scan settings and return a dummy result. | Stateless |
| OCR Service | Simulate work based on accuracy and extraction settings, then return dummy text. | Stateless |
| Notification Service | Optional simulated notification work; no real message delivery. | Stateless |
| MongoDB | Local dummy/sample data only. | Container-managed |
| Redis | Local cache and learning aid only. | Container-managed |
| Nginx | Local reverse proxy entry point. | Container-managed |

## Common HTTP contract

Every application service will expose these unauthenticated endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | General process health for a human or simple local check. |
| `GET /ready` | Whether the service can receive traffic. |
| `GET /live` | Whether the process is alive and should not be restarted. |
| `GET /info` | Service metadata such as service name and instance ID. |
| `GET /metrics` | JSON metrics for local observation. |

The default endpoint format is JSON. The local Kubernetes manifests use
`/ready` and `/live` directly as readiness and liveness probes.

## Events

Each service will retain a bounded in-memory event list. Events will use this
shape:

```json
{
  "id": "uuid",
  "type": "REQUEST_RECEIVED",
  "timestamp": "ISO-8601 timestamp",
  "service": "gateway-api",
  "instanceId": "gateway-api-local",
  "requestId": "uuid",
  "details": {}
}
```

The orchestration flow emits `REQUEST_RECEIVED`, `REQUEST_VALIDATED`,
`SERVICE_SELECTED`, `SERVICE_SKIPPED`, `SERVICE_STARTED`, `SERVICE_COMPLETED`,
`SERVICE_FAILED`, `RESPONSE_AGGREGATED`, and `REQUEST_COMPLETED`. Events are
intentionally not durable: losing them on a restart demonstrates the distinction
between local observability and a real event pipeline.

## Processing request contract

`POST /api/process` accepts a document plus a pipeline configuration. The
Gateway validates this schema, selects only enabled services, and forwards each
service its document metadata plus its own configuration section. A service
never receives the configuration sections intended for its peers.

```json
{
  "document": { "name": "invoice_2026_07.pdf", "type": "invoice", "mimeType": "application/pdf", "size": 245678 },
  "pipeline": {
    "validation": { "enabled": true, "checks": ["schema", "required-fields"] },
    "security": { "enabled": true, "malwareScan": true, "deepScan": false },
    "ocr": { "enabled": true, "extractText": true, "extractTables": false, "languageDetection": false, "accuracy": "normal" }
  }
}
```

Valid validation checks are `schema`, `required-fields`, and `business-rules`.
OCR accuracy is `normal` or `high`; a deep security scan requires
`malwareScan: true`. The response from each selected service includes its
simulated processing time, latency, CPU, memory, and result.

## Metrics

`GET /metrics` will return request count, average latency, active requests,
simulated CPU usage, simulated memory usage, error count, service name, and
instance ID. Simulated resource values teach dashboards and autoscaling inputs;
they are not host resource measurements.

## Configuration principles

All environment-specific values will be configured through environment
variables with safe local defaults. Service-to-service URLs will use Docker
Compose DNS names, never external endpoints. No credential, cloud SDK, or
external integration will be introduced.

## Kubernetes mapping

Each directory under `services/` owns its Dockerfile and remains runnable as one
stateless container. The common health contract maps directly to readiness and
liveness probes. The local registry workflow and Deployment manifests are in
[`k8s/`](../k8s/); ConfigMaps, Secrets, HPA, and ingress remain separate future
learning exercises.
