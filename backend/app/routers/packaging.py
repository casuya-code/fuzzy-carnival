import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import (
    DEFAULT_CLIP_LENGTH_SEC,
    MAX_CLIP_LENGTH_SEC,
    MIN_CLIP_LENGTH_SEC,
    TEMP_AUDIO_DIR,
)
from app.services.naming_utils import build_video_r2_key, get_eat_parts, sanitize_topic
from app.services.audio_processor import _media_tools_available, get_duration
from app.services.packaging_processor import (
    ACCENTS,
    export_three_vertical_shorts,
    generate_viral_thumbnail,
)
from app.services.r2_storage import download_reference, upload_output

router = APIRouter(prefix="/api/v1/packaging", tags=["packaging"])

DEFAULT_STARTS = [0, 45, 90]
DEFAULT_PHASES = ["THE HOOK", "THE CLIMAX", "THE REVEAL"]


def _parse_csv_float(value: Optional[str], fallback: list[float]) -> list[float]:
    if not value:
        return fallback
    try:
        parts = [float(x.strip()) for x in value.split(",") if x.strip()]
        return parts[:3] or fallback
    except Exception:
        return fallback


def _parse_csv_str(value: Optional[str], fallback: list[str]) -> list[str]:
    if not value:
        return fallback
    parts = [x.strip() for x in value.split(",") if x.strip()]
    return parts[:3] or fallback


def _validate(
    has_video: bool,
    has_key: bool,
    hook_words: str,
    accent: str,
    gradient: str,
    clip_length_sec: int | None = None,
) -> None:
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe required for packaging")
    if not has_video and not has_key:
        raise HTTPException(status_code=400, detail="Provide master_video or master_r2_key")
    if not hook_words.strip():
        raise HTTPException(status_code=400, detail="hook_words is required")
    if accent not in ACCENTS:
        raise HTTPException(status_code=400, detail="accent must be yellow, red, or white")
    if gradient not in ("left", "bottom"):
        raise HTTPException(status_code=400, detail="gradient must be 'left' or 'bottom'")
    if clip_length_sec is not None and not (
        MIN_CLIP_LENGTH_SEC <= int(clip_length_sec) <= MAX_CLIP_LENGTH_SEC
    ):
        raise HTTPException(
            status_code=400,
            detail=f"clip_length_sec must be {MIN_CLIP_LENGTH_SEC}-{MAX_CLIP_LENGTH_SEC}",
        )


def _resolve_master(
    master_video: Optional[UploadFile],
    master_r2_key: Optional[str],
    work_dir: Path,
) -> str:
    dest = work_dir / "master.mp4"
    if master_video is not None:
        with open(dest, "wb") as f:
            shutil.copyfileobj(master_video.file, f)
        return str(dest)
    return download_reference(master_r2_key, dest=dest)  # type: ignore[arg-type]


@router.post("/thumbnail")
async def packaging_thumbnail(
    master_video: Optional[UploadFile] = File(None),
    master_r2_key: Optional[str] = Form(None),
    hook_words: str = Form("AFRICA'S HIGHEST PEAK"),
    accent: str = Form("yellow"),
    gradient: str = Form("left"),
    border: bool = Form(True),
    font_path: Optional[str] = Form(None),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
):
    """Generate just the designed thumbnail (fast preview, no Shorts render)."""
    _validate(bool(master_video), bool(master_r2_key), hook_words, accent, gradient)
    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "packaging_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        master = _resolve_master(master_video, master_r2_key, work_dir)
        thumb = str(work_dir / "youtube_thumbnail.jpg")
        generate_viral_thumbnail(
            master, thumb, hook_words=hook_words, font_path=font_path,
            accent=accent, gradient=gradient, border=border,
        )
        date_str, time_str = get_eat_parts()
        key = build_video_r2_key("Thumb_1280x720", language, topic, "jpg", date_str, time_str)
        url = upload_output(thumb, key)
        words = hook_words.upper().split()[:3]
        return {
            "thumbnail_r2_key": key,
            "thumbnail_url": url,
            "width": 1280,
            "height": 720,
            "hook_words": words,
            "accent": accent,
            "gradient": gradient,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="ignore") if isinstance(e.stderr, (bytes, bytearray)) else str(e)
        raise HTTPException(status_code=500, detail=f"Thumbnail failed: {err[-500:]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thumbnail failed: {e}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@router.post("/publish")
async def packaging_publish(
    master_video: Optional[UploadFile] = File(None),
    master_r2_key: Optional[str] = Form(None),
    hook_words: str = Form("AFRICA'S HIGHEST PEAK"),
    accent: str = Form("yellow"),
    gradient: str = Form("left"),
    border: bool = Form(True),
    shorts_title: str = Form(""),
    clip_length_sec: int = Form(DEFAULT_CLIP_LENGTH_SEC),
    start_times: Optional[str] = Form(None),
    phases: Optional[str] = Form(None),
    font_path: Optional[str] = Form(None),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
):
    """Publish the full package: 16:9 master + designed thumbnail + 3 vertical Shorts."""
    _validate(bool(master_video), bool(master_r2_key), hook_words, accent, gradient, clip_length_sec)
    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "packaging_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        master = _resolve_master(master_video, master_r2_key, work_dir)

        # 1) Designed thumbnail
        thumb = str(work_dir / "youtube_thumbnail.jpg")
        generate_viral_thumbnail(
            master, thumb, hook_words=hook_words, font_path=font_path,
            accent=accent, gradient=gradient, border=border,
        )

        # 2) Three hook-driven vertical Shorts
        starts = _parse_csv_float(start_times, DEFAULT_STARTS)
        phase_names = _parse_csv_str(phases, DEFAULT_PHASES)
        shorts_dir = work_dir / "shorts"
        short_paths = export_three_vertical_shorts(
            master, str(shorts_dir),
            clip_length_sec=clip_length_sec,
            start_times=starts,
            title=shorts_title,
            phases=phase_names,
            accent=accent,
            font_path=font_path,
        )

        # 3) Upload all 5 deliverables to R2 (or /static in local dev)
        date_str, time_str = get_eat_parts()
        master_key = build_video_r2_key("Video_Master16x9", language, topic, "mp4", date_str, time_str)
        master_url = upload_output(master, master_key)

        thumb_key = build_video_r2_key("Thumb_1280x720", language, topic, "jpg", date_str, time_str)
        thumb_url = upload_output(thumb, thumb_key)

        uploaded_shorts = []
        for i, (path, start) in enumerate(zip(short_paths, starts[:len(short_paths)]), start=1):
            key = build_video_r2_key(f"Video_Short9x16_P{i}", language, topic, "mp4", date_str, time_str)
            url = upload_output(path, key)
            uploaded_shorts.append({
                "part": i,
                "r2_key": key,
                "url": url,
                "start_sec": start,
                "length_sec": clip_length_sec,
                "aspect_ratio": "9:16",
            })

        return {
            "package_id": job_id,
            "master": {"r2_key": master_key, "url": master_url},
            "thumbnail": {
                "r2_key": thumb_key, "url": thumb_url,
                "width": 1280, "height": 720,
                "hook_words": hook_words.upper().split()[:3],
            },
            "shorts": uploaded_shorts,
            # flat conveniences for simple clients
            "master_url": master_url,
            "thumbnail_url": thumb_url,
            "short_urls": [s["url"] for s in uploaded_shorts],
            "duration_seconds": get_duration(master),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="ignore") if isinstance(e.stderr, (bytes, bytearray)) else str(e)
        raise HTTPException(status_code=500, detail=f"Packaging failed: {err[-500:]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Packaging failed: {e}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
