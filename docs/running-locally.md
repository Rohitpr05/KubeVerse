# Running locally

Prerequisite: Docker Desktop or Docker Engine with the Compose plugin.

Start the complete local topology:

```bash
docker compose up --build
```

Nginx is the only host-facing service at `http://localhost:8080`. The Gateway
validates the payload, selects enabled services, and runs them concurrently.

## Full pipeline

```bash
curl -X POST http://localhost:8080/api/process \
  -H 'content-type: application/json' \
  -d '{"document":{"name":"invoice_2026_07.pdf","type":"invoice","mimeType":"application/pdf","size":245678},"pipeline":{"validation":{"enabled":true,"checks":["schema","required-fields","business-rules"]},"security":{"enabled":true,"malwareScan":true,"deepScan":false},"ocr":{"enabled":true,"extractText":true,"extractTables":true,"languageDetection":true,"accuracy":"high"}}}'
```

## Validation only

```bash
curl -X POST http://localhost:8080/api/process -H 'content-type: application/json' \
  -d '{"document":{"name":"contract.pdf","type":"contract","mimeType":"application/pdf","size":12000},"pipeline":{"validation":{"enabled":true,"checks":["schema"]}}}'
```

## OCR only

```bash
curl -X POST http://localhost:8080/api/process -H 'content-type: application/json' \
  -d '{"document":{"name":"receipt.png","type":"receipt","mimeType":"image/png","size":8000},"pipeline":{"ocr":{"enabled":true,"extractText":true,"extractTables":false,"languageDetection":false,"accuracy":"normal"}}}'
```

## Security and OCR

```bash
curl -X POST http://localhost:8080/api/process -H 'content-type: application/json' \
  -d '{"document":{"name":"upload.pdf","type":"upload","mimeType":"application/pdf","size":66000},"pipeline":{"security":{"enabled":true,"malwareScan":true,"deepScan":true},"ocr":{"enabled":true,"extractText":true,"extractTables":false,"languageDetection":false,"accuracy":"normal"}}}'
```

## Heavier OCR

The normal OCR request simulates 400 ms of work. This request simulates
1,750 ms: high accuracy (1,200 ms), table extraction (+350 ms), and language
detection (+200 ms).

```bash
curl -X POST http://localhost:8080/api/process -H 'content-type: application/json' \
  -d '{"document":{"name":"complex-invoice.pdf","type":"invoice","mimeType":"application/pdf","size":245678},"pipeline":{"ocr":{"enabled":true,"extractText":true,"extractTables":true,"languageDetection":true,"accuracy":"high"}}}'
```

Useful inspection endpoints, all routed through Nginx:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/ready
curl http://localhost:8080/metrics
curl http://localhost:8080/events
curl http://localhost:8080/nginx-health
```

For an individual service, use Compose's internal network instead of publishing
more host ports. For example:

```bash
docker compose exec validation wget -qO- http://localhost:3001/metrics
```

Stop containers with `docker compose down`. Add `-v` only when intentionally
resetting the local MongoDB and Redis sample data.
