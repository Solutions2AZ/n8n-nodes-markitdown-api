from __future__ import annotations

import asyncio
import importlib.metadata
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status


def _get_int(name: str, default: int, minimum: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default

    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc

    if value < minimum:
        raise RuntimeError(f"{name} must be >= {minimum}")

    return value


class Settings:
    api_key = os.getenv("MARKITDOWN_API_KEY", "").strip()
    max_upload_bytes = _get_int("MAX_UPLOAD_BYTES", 50 * 1024 * 1024, 1)
    conversion_timeout_seconds = _get_int("CONVERSION_TIMEOUT_SECONDS", 120, 1)
    concurrency = _get_int("MARKITDOWN_CONCURRENCY", 2, 1)


settings = Settings()
conversion_semaphore = asyncio.Semaphore(settings.concurrency)

app = FastAPI(
    title="MarkItDown API",
    version="0.1.0",
    description="Self-hosted HTTP API for converting files to Markdown with Microsoft MarkItDown.",
)


def _markitdown_version() -> str:
    try:
        return importlib.metadata.version("markitdown")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


async def require_api_key(request: Request) -> None:
    if not settings.api_key:
        return

    provided = request.headers.get("x-api-key", "").strip()
    authorization = request.headers.get("authorization", "").strip()

    if not provided and authorization.lower().startswith("bearer "):
        provided = authorization[7:].strip()

    if provided != settings.api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )


@app.get("/health")
async def health() -> dict[str, Any]:
    if shutil.which("markitdown") is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="markitdown command not found",
        )

    return {
        "status": "ok",
        "engine": "markitdown",
        "engineVersion": _markitdown_version(),
        "maxUploadBytes": settings.max_upload_bytes,
        "conversionTimeoutSeconds": settings.conversion_timeout_seconds,
        "concurrency": settings.concurrency,
    }


@app.post("/v1/convert", dependencies=[Depends(require_api_key)])
async def convert_file(file: UploadFile = File(...)) -> dict[str, Any]:
    started_at = time.perf_counter()
    input_path: str | None = None
    filename = Path(file.filename or "document").name or "document"

    try:
        input_path, size = await _save_upload(file, filename)

        async with conversion_semaphore:
            markdown = await _convert_with_markitdown(input_path)

        duration_ms = round((time.perf_counter() - started_at) * 1000)

        return {
            "markdown": markdown,
            "metadata": {
                "filename": filename,
                "mimeType": file.content_type or "application/octet-stream",
                "size": size,
                "durationMs": duration_ms,
                "engine": "markitdown",
                "engineVersion": _markitdown_version(),
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Conversion failed: {exc}",
        ) from exc
    finally:
        await file.close()
        if input_path:
            Path(input_path).unlink(missing_ok=True)


async def _save_upload(file: UploadFile, filename: str) -> tuple[str, int]:
    suffix = Path(filename).suffix[:32]
    fd, path = tempfile.mkstemp(prefix="markitdown-input-", suffix=suffix)
    os.close(fd)

    total = 0
    try:
        with open(path, "wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break

                total += len(chunk)
                if total > settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File exceeds MAX_UPLOAD_BYTES ({settings.max_upload_bytes})",
                    )

                output.write(chunk)

        if total == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty",
            )

        return path, total
    except Exception:
        Path(path).unlink(missing_ok=True)
        raise


async def _convert_with_markitdown(input_path: str) -> str:
    fd, output_path = tempfile.mkstemp(prefix="markitdown-output-", suffix=".md")
    os.close(fd)

    try:
        process = await asyncio.create_subprocess_exec(
            "markitdown",
            input_path,
            "-o",
            output_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=settings.conversion_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"Conversion exceeded {settings.conversion_timeout_seconds} seconds",
            ) from exc

        if process.returncode != 0:
            error = stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(error or f"markitdown exited with code {process.returncode}")

        output_file = Path(output_path)
        if output_file.exists() and output_file.stat().st_size > 0:
            return output_file.read_text(encoding="utf-8")

        return stdout.decode("utf-8", errors="replace")
    finally:
        Path(output_path).unlink(missing_ok=True)
