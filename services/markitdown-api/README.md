# markitdown-api

Self-hosted HTTP service for converting files to Markdown with Microsoft MarkItDown.

## Endpoints

```text
GET /health
POST /v1/convert
```

`POST /v1/convert` recibe `multipart/form-data` con el campo `file`.

## Environment Variables

```text
MARKITDOWN_API_KEY=change-me
MAX_UPLOAD_BYTES=52428800
CONVERSION_TIMEOUT_SECONDS=120
MARKITDOWN_CONCURRENCY=2
```

If `MARKITDOWN_API_KEY` is empty, authentication is disabled.

## Docker

Published image:

```text
ghcr.io/solutions2az/markitdown-api:latest
```

Local build:

```bash
docker build -t markitdown-api:local .
docker run --rm -p 8000:8000 -e MARKITDOWN_API_KEY=change-me markitdown-api:local
```

```bash
curl -H "x-api-key: change-me" -F "file=@document.pdf" http://localhost:8000/v1/convert
```
