from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, BinaryIO

import requests
from fastapi import HTTPException, UploadFile

from app.config import (
    MAX_UPLOAD_BYTES,
    TEMP_AUDIO_DIR,
    UPLOAD_SCAN_TIMEOUT_SEC,
    UPLOAD_SCAN_URL,
)

FONT_MAX_BYTES = 5 * 1024 * 1024
_COPY_CHUNK = 1024 * 1024


AUDIO_MAGIC = {
    "wav": [b"RIFF"],
    "mp3": [b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"],
    "flac": [b"fLaC"],
    "ogg": [b"OggS"],
    "m4a": [b"\x00\x00\x00"],
    "mp4": [b"\x00\x00\x00"],
    "aac": [b"\xff\xf1", b"\xff\xf9"],
    "webm": [b"\x1a\x45\xdf\xa3"],
}


def sniff_audio_type(data: bytes) -> str | None:
    if not data:
        return None
    head = data[:16]
    if head.startswith(b"RIFF") and b"WAVE" in data[:16]:
        return "wav"
    if head.startswith(b"fLaC"):
        return "flac"
    if head.startswith(b"OggS"):
        return "ogg"
    if head.startswith(b"ID3") or head[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xf1", b"\xff\xf9"}:
        return "mp3"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"
    if len(head) >= 8 and head[4:8] == b"ftyp":
        # mp4/m4a family; treat as allowed audio container
        return "mp4"
    return None


def validate_audio_upload(filename: str, content_type: str | None, data: bytes) -> None:
    """Require the extension to agree with the sniffed container bytes.

    A client-supplied Content-Type is *not* trusted as evidence: it is trivial
    to spoof and previously allowed any sniffed audio type through (H38).
    """
    ext = Path(filename or "").suffix.lower().lstrip(".")
    sniff = sniff_audio_type(data)
    if sniff is None:
        raise ValueError("Uploaded file does not look like a supported audio file")
    if ext == sniff:
        return
    # Explicit container overlaps only (m4a/mp4/aac vs mp4/mp3 frames).
    if ext in {"m4a", "mp4", "aac"} and sniff in {"mp4", "mp3"}:
        return
    raise ValueError("Uploaded file type does not match its content")


def _too_large(max_bytes: int) -> HTTPException:
    return HTTPException(
        status_code=413,
        detail=f"Upload too large (max {max(1, max_bytes) // (1024 * 1024)} MB)",
    )


def _copy_capped(
    source: BinaryIO,
    dest: Path,
    max_bytes: int,
) -> tuple[int, bytes]:
    """Stream into dest, refusing to materialize more than max_bytes."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    prefix = bytearray()
    with dest.open("wb") as out:
        while True:
            chunk = source.read(_COPY_CHUNK)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise _too_large(max_bytes)
            out.write(chunk)
            if len(prefix) < 64:
                prefix.extend(chunk[: 64 - len(prefix)])
    return size, bytes(prefix)


def copy_upload_capped(
    upload: UploadFile,
    dest: Path,
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> tuple[int, bytes]:
    """Copy an UploadFile with a hard size cap; returns (bytes, first-64-bytes)."""
    declared = getattr(upload, "size", None)
    if declared is None:
        headers = getattr(upload, "headers", None) or {}
        raw = headers.get("content-length") if hasattr(headers, "get") else None
        try:
            declared = int(raw) if raw is not None else None
        except (TypeError, ValueError):
            declared = None
    if declared is not None and declared > max_bytes:
        raise _too_large(max_bytes)
    file_obj = upload.file
    try:
        file_obj.seek(0)
    except (OSError, ValueError):
        pass
    return _copy_capped(file_obj, dest, max_bytes)


async def copy_stream_capped(
    stream: Any,
    dest: Path,
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> tuple[int, str, bytes]:
    """Async capped copy that also hashes while streaming (M39)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    digest = hashlib.sha256()
    prefix = bytearray()
    with dest.open("wb") as out:
        async for chunk in stream:
            if not chunk:
                continue
            size += len(chunk)
            if size > max_bytes:
                raise _too_large(max_bytes)
            out.write(chunk)
            digest.update(chunk)
            if len(prefix) < 64:
                prefix.extend(chunk[: 64 - len(prefix)])
    return size, digest.hexdigest(), bytes(prefix)


def scan_upload_stream(
    filename: str,
    content_type: str | None,
    size: int,
    sha256_hex: str,
) -> None:
    """Send only metadata/hash to the scanner; never hold the whole file in RAM."""
    if not UPLOAD_SCAN_URL:
        return
    payload = {
        "filename": filename,
        "content_type": content_type or "",
        "size": int(size),
        "sha256": sha256_hex,
    }
    try:
        r = requests.post(UPLOAD_SCAN_URL, json=payload, timeout=UPLOAD_SCAN_TIMEOUT_SEC)
        if r.status_code >= 400:
            raise ValueError("Upload rejected by scan service")
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Upload scan failed: {e}") from e


def scan_upload(filename: str, content_type: str | None, data: bytes) -> None:
    """Compatibility wrapper for callers that already hold the bytes."""
    scan_upload_stream(
        filename,
        content_type,
        len(data),
        hashlib.sha256(data).hexdigest(),
    )


def resolve_brand_font_path(font_path: str | None) -> str | None:
    """Accept only fonts uploaded through /fonts/upload (M31)."""
    if not font_path or not str(font_path).strip():
        return None
    root = (TEMP_AUDIO_DIR / "brand_fonts").resolve()
    candidate = Path(font_path).resolve()
    if candidate.parent != root or candidate.suffix.lower() not in {".ttf", ".otf"}:
        raise ValueError("font_path must be an uploaded brand font")
    if not candidate.is_file():
        raise ValueError("Brand font not found")
    return str(candidate)
