from __future__ import annotations

import hashlib
from pathlib import Path

import requests

from app.config import UPLOAD_SCAN_TIMEOUT_SEC, UPLOAD_SCAN_URL


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
    ext = Path(filename or "").suffix.lower().lstrip(".")
    sniff = sniff_audio_type(data)
    if sniff is None:
        raise ValueError("Uploaded file does not look like a supported audio file")
    # Allow reasonable container overlaps
    allowed = {ext, sniff}
    if ext in {"m4a", "mp4", "aac"} and sniff in {"mp4", "mp3"}:
        return
    if ext == "mp3" and sniff == "mp3":
        return
    if ext == "wav" and sniff == "wav":
        return
    if ext == "flac" and sniff == "flac":
        return
    if ext == "ogg" and sniff == "ogg":
        return
    if ext == "webm" and sniff == "webm":
        return
    # If extension unknown but sniff is audio, allow only when content-type is audio-ish.
    ct = (content_type or "").split(";")[0].strip().lower()
    if sniff and (ct.startswith("audio/") or ct in {"video/mp4", "video/webm"}):
        return
    raise ValueError("Uploaded file type does not match its content")


def scan_upload(filename: str, content_type: str | None, data: bytes) -> None:
    if not UPLOAD_SCAN_URL:
        return
    payload = {
        "filename": filename,
        "content_type": content_type or "",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    try:
        r = requests.post(UPLOAD_SCAN_URL, json=payload, timeout=UPLOAD_SCAN_TIMEOUT_SEC)
        if r.status_code >= 400:
            raise ValueError("Upload rejected by scan service")
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Upload scan failed: {e}") from e
