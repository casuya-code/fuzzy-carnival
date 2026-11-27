import logging
import os
import shutil
import threading
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.config import Config

from app.config import (
    ALLOW_LOCAL_MEDIA_FALLBACK,
    PUBLIC_BASE_URL,
    R2_ACCESS_KEY_ID,
    R2_ACCOUNT_ID,
    R2_BUCKET_NAME,
    R2_PUBLIC_URL,
    R2_SECRET_ACCESS_KEY,
    TEMP_AUDIO_DIR,
)

# Keep generated media playable for as long as possible (S3/R2 presigned URLs
# cap at 7 days). Frontend refreshes URLs on demand for older entries.
PRESIGN_EXPIRES_SEC = 7 * 24 * 3600
logger = logging.getLogger(__name__)

_LOCALHOST_DEFAULTS = {
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://localhost",
}

_client_cache: object | None = None
_client_lock = threading.Lock()


def _r2_configured() -> bool:
    return bool(R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY)


def _require_local_fallback() -> None:
    if not ALLOW_LOCAL_MEDIA_FALLBACK:
        raise RuntimeError("Object storage is not configured and local media fallback is disabled")
    # A localhost public base URL is fine for local development but unusable in
    # a deployed environment; fail fast instead of handing out dead URLs (M41).
    if (
        PUBLIC_BASE_URL.rstrip("/") in _LOCALHOST_DEFAULTS
        and os.getenv("ENVIRONMENT", "dev").strip().lower() in {"prod", "production"}
    ):
        raise RuntimeError("PUBLIC_BASE_URL must be set when local media fallback is used")


def _client():
    """Return one pooled client; constructing a boto3 client per call is costly."""
    global _client_cache
    if _client_cache is None:
        with _client_lock:
            if _client_cache is None:
                _client_cache = boto3.client(
                    "s3",
                    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
                    aws_access_key_id=R2_ACCESS_KEY_ID,
                    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
                    config=Config(
                        signature_version="s3v4",
                        connect_timeout=5,
                        read_timeout=30,
                        retries={"max_attempts": 3, "mode": "standard"},
                        max_pool_connections=16,
                    ),
                    region_name="auto",
                )
    return _client_cache


def _local_key_path(key: str) -> Path | None:
    """Resolve an object key inside TEMP_AUDIO_DIR, rejecting path traversal."""
    root = TEMP_AUDIO_DIR.resolve()
    candidate = (root / key).resolve()
    if candidate != root and not candidate.is_relative_to(root):
        return None
    return candidate


def local_output_path(key: str) -> Path | None:
    """Local-dev path for a logical key, preserving its subdirectories."""
    return _local_key_path(key)


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


def object_exists(key: str) -> bool:
    """Check an object server-side; never assume a public URL still resolves."""
    if not _r2_configured():
        local = _local_key_path(key)
        return bool(local is not None and local.exists())
    try:
        _client().head_object(Bucket=R2_BUCKET_NAME, Key=key)
        return True
    except Exception:
        return False


def public_url(key: str) -> str:
    """Return a fresh URL for an already-uploaded object (never cache presigned URLs)."""
    if not _r2_configured():
        _require_local_fallback()
        local = _local_key_path(key)
        if local is None:
            raise ValueError("Invalid object key")
        relative = local.relative_to(TEMP_AUDIO_DIR.resolve()).as_posix()
        return f"{PUBLIC_BASE_URL}/static/{quote(relative, safe='/')}"
    if R2_PUBLIC_URL:
        return f"{R2_PUBLIC_URL.rstrip('/')}/{quote(key, safe='/')}"
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

    outputs_local = (TEMP_AUDIO_DIR / "outputs" / Path(key).name).resolve()
    outputs_root = (TEMP_AUDIO_DIR / "outputs").resolve()

    def _from_local() -> str | None:
        # 1) Exact key path inside temp dir (e.g. local-upload keys)
        if local.exists():
            if local.resolve() != Path(dest).resolve():
                shutil.copyfile(local, dest)
            return str(dest)
        # 2) Legacy local-dev outputs were flattened to outputs/<basename>.
        if outputs_local.is_relative_to(outputs_root) and outputs_local.exists():
            if outputs_local != Path(dest).resolve():
                shutil.copyfile(outputs_local, dest)
            return str(dest)
        return None

    if not _r2_configured():
        found = _from_local()
        if found is not None:
            return found
        _require_local_fallback()
        raise RuntimeError("R2 not configured and local reference not found")

    # With R2 configured the object is authoritative: never let a stale local
    # file with the same name shadow a newer upload (M32).
    try:
        _client().download_file(R2_BUCKET_NAME, key, str(dest))
        return str(dest)
    except Exception:
        # Still allow genuinely local-only keys (local dev uploads) as a fallback.
        found = _from_local()
        if found is not None:
            return found
        raise


def upload_output(local_path: str, key: str) -> str:
    """Upload a generated output to R2 and return a public/presigned URL.

    When R2 is not configured (local dev), fall back to serving the file
    from the backend's ``/static`` mount so the frontend can still play it.
    """
    if not _r2_configured():
        _require_local_fallback()
        dest = _local_key_path(key)
        if dest is None:
            raise ValueError("Invalid object key")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if Path(local_path).resolve() != dest.resolve():
            shutil.copyfile(local_path, dest)
        return public_url(key)

    extra = {"ContentType": _content_type(local_path)}
    # Generated keys are content-addressed/timestamped; immutable caching is safe.
    if key.startswith(("outputs/", "audio/", "video/", "thumbs/", "refs_cache/")):
        extra["CacheControl"] = "public, max-age=31536000, immutable"
    else:
        extra["CacheControl"] = "public, max-age=3600"
    _client().upload_file(
        local_path,
        R2_BUCKET_NAME,
        key,
        ExtraArgs=extra,
    )
    return public_url(key)


def delete_object(key: str) -> bool:
    """Best-effort deletion of an uploaded object (used for partial-publish rollback)."""
    if not _r2_configured():
        local = _local_key_path(key)
        if local is None:
            return False
        try:
            local.unlink(missing_ok=True)
            return True
        except OSError:
            # Never log the key or the underlying error verbatim.
            logger.warning("Local object cleanup failed during partial-publish rollback")
            return False
    try:
        _client().delete_object(Bucket=R2_BUCKET_NAME, Key=key)
        return True
    except Exception:
        logger.warning("Object cleanup failed during partial-publish rollback")
        return False
