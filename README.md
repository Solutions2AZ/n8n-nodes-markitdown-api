# n8n-nodes-markitdown-api

Self-hosted n8n community node for converting files to Markdown with Microsoft MarkItDown through a Docker API service.

This project gives n8n users a real `MarkItDown` node instead of asking them to configure a generic HTTP Request node.

## Architecture

```text
n8n community node "MarkItDown"
  -> internal HTTP call managed by the node
    -> markitdown-api
      -> Microsoft MarkItDown
```

The n8n community node is a lightweight TypeScript package. The document conversion engine runs in a separate self-hosted Docker container.

## Components

```text
packages/n8n-nodes-markitdown-api
services/markitdown-api
docker-compose.example.yml
```

## Quick Start

Start n8n and the MarkItDown API service:

```bash
docker compose -f docker-compose.example.yml up -d
```

Open n8n:

```text
http://localhost:5678
```

Install the community node from n8n:

```text
Settings -> Community Nodes -> Install
```

Package name:

```text
n8n-nodes-markitdown-api
```

Create `MarkItDown API` credentials:

```text
Base URL: http://markitdown-api:8000
API Key: change-me
```

Then use the `MarkItDown` node after any node that outputs binary data.

```text
Google Drive / HTTP Download / Read Binary File
  -> MarkItDown
  -> LLM / Vector DB / Notion / Email
```

## Node Operation

The first release includes one operation:

```text
Convert File to Markdown
```

Inputs:

- `Input Binary Field`: binary property to convert, default `data`.
- `Output Field`: JSON field for the Markdown result, default `markdown`.
- `Include Metadata`: adds conversion metadata to `markitdownMetadata`.

Output example:

```json
{
  "markdown": "# Converted content",
  "markitdownMetadata": {
    "filename": "document.pdf",
    "mimeType": "application/pdf",
    "size": 12345,
    "durationMs": 850,
    "engine": "markitdown",
    "engineVersion": "0.1.6"
  }
}
```

## MarkItDown API

The API service exposes:

```text
GET /health
POST /v1/convert
```

`POST /v1/convert` accepts `multipart/form-data` with a `file` field.

Environment variables:

```text
MARKITDOWN_API_KEY=change-me
MAX_UPLOAD_BYTES=52428800
CONVERSION_TIMEOUT_SECONDS=120
MARKITDOWN_CONCURRENCY=2
```

If `MARKITDOWN_API_KEY` is empty, authentication is disabled.

## Docker Image

Published image:

```text
ghcr.io/solutions2az/markitdown-api:latest
```

Manual API test:

```bash
curl -H "x-api-key: change-me" -F "file=@document.pdf" http://localhost:8000/v1/convert
```

## Development

Build the n8n community node:

```bash
cd packages/n8n-nodes-markitdown-api
npm install
npm run build
npm pack --dry-run
```

Build the API image locally:

```bash
docker build -t markitdown-api:local services/markitdown-api
```

## Publishing

The repository includes GitHub Actions for:

- CI on pushes and pull requests.
- Publishing `ghcr.io/solutions2az/markitdown-api` on version tags.
- Publishing `n8n-nodes-markitdown-api` to npm on version tags.

Required GitHub secret:

```text
NPM_TOKEN
```

Release flow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Security

This project processes user-provided files. Run the API service in a restricted, self-hosted environment and keep it behind your private network unless you understand the risk of exposing document conversion services publicly.

The API key is optional for private Docker networks, but recommended if the service is reachable by anything other than your n8n container.

## License

MIT

## Status

MVP includes:

- Docker service `markitdown-api`.
- n8n community node `MarkItDown`.
- Optional API key authentication.
- Upload size limit.
- Conversion timeout.
- Concurrency limit.
- Docker Compose example for self-hosted n8n.
