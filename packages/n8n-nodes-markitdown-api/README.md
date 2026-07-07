# n8n-nodes-markitdown-api

n8n community node for converting files to Markdown through a self-hosted MarkItDown API container.

Repository: https://github.com/Solutions2AZ/n8n-nodes-markitdown-api

## Requirements

- Self-hosted n8n.
- `N8N_COMMUNITY_PACKAGES_ENABLED=true`.
- A running `markitdown-api` service.

## Credentials

Create `MarkItDown API` credentials:

```text
Base URL: http://markitdown-api:8000
API Key: change-me
```

If the API service has no `MARKITDOWN_API_KEY`, leave API Key empty.

## Docker API Service

Run the companion service with Docker:

```bash
docker run --rm -p 8000:8000 -e MARKITDOWN_API_KEY=change-me ghcr.io/solutions2az/markitdown-api:latest
```

## Usage

Use a node that outputs binary data, then connect it to `MarkItDown`.

```text
Read Binary File / Google Drive / HTTP Download
  -> MarkItDown
  -> LLM / Vector Store / Notion / Email
```

The converted Markdown is written to the configured output field, `markdown` by default.
