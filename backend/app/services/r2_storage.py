import shutil
from pathlib import Path

import boto3
from botocore.config import Config

from app.config import (
    PUBLIC_BASE_URL,
    R2_ACCESS_KEY_ID,
    R2_ACCOUNT_ID,
    R2_BUCKET_NAME,
    R2_PUBLIC_URL,
    R2_SECRET_ACCESS_KEY,
    TEMP_AUDIO_DIR,
)

PRESIGN_EXPIRES_SEC = 3600


def _r2_configured() -> bool:
    return bool(R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY)


def _client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _local_key_path(key: str) -> Path | None:
    """Resolve an object key inside TEMP_AUDIO_DIR, rejecting path traversal."""
    root = TEMP_AUDIO_DIR.resolve()
    candidate = (root / key).resolve()
    if candidate != root and not candidate.is_relative_to(root):
        return None
    return candidate


def _content_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext == ".mp3":
        return "audio/mpeg"
    if ext == ".wav":
        return "audio/wav"
    if ext in (".mp4", ".m4v"):
        return "video/mp4"
    if ext == ".webm":
        return "video/webm"
    if ext == ".ass":
        return "text/plain; charset=utf-8"
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    return "application/octet-stream"


def public_url(key: str) -> str:
    """Return a fresh URL for an already-uploaded object (never cache presigned URLs)."""
    if not _r2_configured():
        return f"{PUBLIC_BASE_URL}/static/outputs/{Path(key).name}"
    if R2_PUBLIC_URL:
        return f"{R2_PUBLIC_URL.rstrip('/')}/{key}"
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": R2_BUCKET_NAME, "Key": key},
        ExpiresIn=PRESIGN_EXPIRES_SEC,
    )


def download_reference(key: str, dest: Path | None = None) -> str:
    """Download an object from R2 to a local temp path.

    Falls back to local temp storage when R2 is not configured or the file
    was uploaded via the local dev upload endpoint.
    """
    local = _local_key_path(key)
    if local is None:
        raise ValueError("Invalid object key")

    if dest is None:
        dest = TEMP_AUDIO_DIR / Path(key).name
    dest.parent.mkdir(parents=True, exist_ok=True)

    if local.exists():
        if local.resolve() != Path(dest).resolve():
            shutil.copyfile(local, dest)
        return str(dest)

    if not _r2_configured():
        raise RuntimeError("R2 not configured and local reference not found")

    _client().download_file(R2_BUCKET_NAME, key, str(dest))
    return str(dest)


def upload_output(local_path: str, key: str) -> str:
    """Upload a generated output to R2 and return a public/presigned URL.

    When R2 is not configured (local dev), fall back to serving the file
    from the backend's ``/static`` mount so the frontend can still play it.
    """
    if not _r2_configured():
        out_dir = TEMP_AUDIO_DIR / "outputs"
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = out_dir / Path(key).name
        shutil.copyfile(local_path, dest)
        return f"{PUBLIC_BASE_URL}/static/outputs/{dest.name}"

    _client().upload_file(
        local_path,
        R2_BUCKET_NAME,
        key,
        ExtraArgs={"ContentType": _content_type(local_path)},
    )
    return public_url(key)
