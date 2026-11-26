import math
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.config import (
    DEFAULT_CLIP_LENGTH_SEC,
    MAX_CLIP_LENGTH_SEC,
    MIN_CLIP_LENGTH_SEC,
    TEMP_AUDIO_DIR,
)
from app.services.naming_utils import build_video_r2_key, get_eat_parts
from app.services.audio_processor import _media_tools_available, get_duration
from app.services.packaging_processor import (
    ACCENTS,
    export_three_vertical_shorts,
    generate_viral_thumbnail,
    reexport_master_video,
)
from app.services.r2_storage import delete_object, download_reference, upload_output
from app.services.upload_validation import copy_upload_capped, resolve_brand_font_path
from app.services.text_styles import normalize_lower_third, normalize_text_style
from app.auth import require_user as require_api_key
from app.rate_limit import rate_limit

router = APIRouter(prefix="/api/v1/packaging", tags=["packaging"], dependencies=[Depends(require_api_key), Depends(rate_limit)])

DEFAULT_STARTS = [0, 45, 90]
DEFAULT_PHASES = ["THE HOOK", "THE CLIMAX", "THE REVEAL"]


def _lower_third_or_400(raw):
    try:
        return normalize_lower_third(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _font_path_or_400(raw):
    try:
        return resolve_brand_font_path(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _parse_csv_float(value: Optional[str], fallback: list[float]) -> list[float]:
    if not value:
        return fallback
    try:
        parts = [float(x.strip()) for x in value.split(",") if x.strip()]
        # Reject NaN/Infinity and negative positions (M29).
        parts = [p for p in parts if math.isfinite(p) and p >= 0]
        return parts[:3] or fallback
    except Exception:
        return fallback


def _parse_csv_str(value: Optional[str], fallback: list[str]) -> list[str]:
    if not value:
        return fallback
    parts = [x.strip() for x in value.split(",") if x.strip()]
    return parts[:3] or fallback


def _probe_video_dims(path: str) -> tuple[int, int] | None:
    try:
        res = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path,
            ],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True,
        )
        raw = (res.stdout or "").strip()
        if "x" in raw:
            w, h = raw.split("x", 1)
            w_i, h_i = int(w), int(h)
            if w_i > 0 and h_i > 0:
                return w_i, h_i
    except Exception:
        return None
    return None


def _master_label(dims: tuple[int, int] | None) -> str:
    if not dims:
        return "Video_Master"
    w, h = dims
    ratio = w / h if h else 1.0
    if ratio >= 1.2:
        return "Video_Master16x9"
    if ratio <= 1 / 1.2:
        return "Video_Master9x16"
    return "Video_Master1x1"


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
        copy_upload_capped(master_video, dest)
        return str(dest)
    try:
        return download_reference(master_r2_key, dest=dest)  # type: ignore[arg-type]
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail="Master video key not found") from exc


@router.post("/thumbnail")
async def packaging_thumbnail(
    master_video: Optional[UploadFile] = File(None),
    master_r2_key: Optional[str] = Form(None),
    hook_words: str = Form("AFRICA'S HIGHEST PEAK"),
    accent: str = Form("yellow"),
    gradient: str = Form("left"),
    border: bool = Form(True),
    frame: str = Form("solid"),
    shape: str = Form("none"),
    font_path: Optional[str] = Form(None),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
    text_style: Optional[str] = Form(None),
):
    """Generate just the designed thumbnail (fast preview, no Shorts render)."""
    _validate(bool(master_video), bool(master_r2_key), hook_words, accent, gradient)
    if frame not in ("none", "solid", "double", "film"):
        raise HTTPException(status_code=400, detail="Invalid frame")
    if shape not in ("none", "circle", "rect"):
        raise HTTPException(status_code=400, detail="Invalid shape")
    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "packaging_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        style = normalize_text_style(text_style)
        font_path = _font_path_or_400(font_path)
        master = _resolve_master(master_video, master_r2_key, work_dir)
        thumb = str(work_dir / "youtube_thumbnail.jpg")
        generate_viral_thumbnail(
            master, thumb, hook_words=hook_words, font_path=font_path,
            accent=accent, gradient=gradient, border=border, text_style=style,
            frame=frame, shape=shape,
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
            "frame": frame,
            "shape": shape,
            "text_style": style,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="ignore") if isinstance(e.stderr, (bytes, bytearray)) else str(e)
        raise HTTPException(status_code=500, detail=f"Thumbnail failed: {err[-500:]}")
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail="Source media key not found") from e
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
    frame: str = Form("solid"),
    shape: str = Form("none"),
    shorts_title: str = Form(""),
    clip_length_sec: int = Form(DEFAULT_CLIP_LENGTH_SEC),
    start_times: Optional[str] = Form(None),
    phases: Optional[str] = Form(None),
    font_path: Optional[str] = Form(None),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
    upscale_2k: bool = Form(False),
    loudnorm: bool = Form(False),
    text_style: Optional[str] = Form(None),
    lower_third: Optional[str] = Form(None),
):
    """Publish the full package: 16:9 master + designed thumbnail + 3 vertical Shorts."""
    _validate(bool(master_video), bool(master_r2_key), hook_words, accent, gradient, clip_length_sec)
    if frame not in ("none", "solid", "double", "film"):
        raise HTTPException(status_code=400, detail="Invalid frame")
    if shape not in ("none", "circle", "rect"):
        raise HTTPException(status_code=400, detail="Invalid shape")
    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "packaging_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    published = False
    uploaded_keys: list[str] = []
    try:
        style = normalize_text_style(text_style)
        lower = _lower_third_or_400(lower_third)
        font_path = _font_path_or_400(font_path)
        master = _resolve_master(master_video, master_r2_key, work_dir)

        # Optional social export pass for the master (YouTube 2K upscale / loudness normalization)
        export_master = master
        if upscale_2k or loudnorm:
            export_master = str(work_dir / "youtube_master_export.mp4")
            reexport_master_video(
                master,
                export_master,
                upscale_2k=upscale_2k,
                loudnorm=loudnorm,
            )

        # 1) Designed thumbnail
        thumb = str(work_dir / "youtube_thumbnail.jpg")
        generate_viral_thumbnail(
            export_master, thumb, hook_words=hook_words, font_path=font_path,
            accent=accent, gradient=gradient, border=border, text_style=style,
            frame=frame, shape=shape,
        )

        # 2) Three hook-driven vertical Shorts
        master_duration = max(0.0, float(get_duration(export_master) or 0.0))
        if master_duration <= 0:
            raise HTTPException(status_code=400, detail="Master video has no readable duration")
        requested_starts = _parse_csv_float(start_times, DEFAULT_STARTS)
        phase_names = _parse_csv_str(phases, DEFAULT_PHASES)
        clip_length_sec = int(max(MIN_CLIP_LENGTH_SEC, min(MAX_CLIP_LENGTH_SEC, clip_length_sec)))
        clip_length_sec = max(1, min(clip_length_sec, int(master_duration)))
        if master_duration < 3 * clip_length_sec:
            # Short master: spread the hooks across the timeline instead of
            # producing three identical Shorts at start 0 (M28).
            starts = [round(master_duration * i / 3.0, 3) for i in range(3)]
        else:
            max_start = max(0.0, master_duration - float(clip_length_sec))
            starts = [round(max(0.0, min(float(s), max_start)), 3) for s in requested_starts[:3]]
            while len(starts) < 3:
                starts.append(round(max_start, 3))

        shorts_dir = work_dir / "shorts"
        short_paths = export_three_vertical_shorts(
            export_master, str(shorts_dir),
            clip_length_sec=clip_length_sec,
            start_times=starts,
            title=shorts_title,
            phases=phase_names,
            accent=accent,
            font_path=font_path,
            text_style=style,
            lower_third=lower,
        )

        # 3) Upload all 5 deliverables to R2 (or /static in local dev)
        date_str, time_str = get_eat_parts()
        master_dims = _probe_video_dims(export_master)
        master_label = _master_label(master_dims)
        master_key = build_video_r2_key(master_label, language, topic, "mp4", date_str, time_str)
        master_url = upload_output(export_master, master_key)
        uploaded_keys.append(master_key)

        thumb_key = build_video_r2_key("Thumb_1280x720", language, topic, "jpg", date_str, time_str)
        thumb_url = upload_output(thumb, thumb_key)
        uploaded_keys.append(thumb_key)

        uploaded_shorts = []
        for i, (path, start) in enumerate(zip(short_paths, starts[:len(short_paths)]), start=1):
            key = build_video_r2_key(f"Video_Short9x16_P{i}", language, topic, "mp4", date_str, time_str)
            url = upload_output(path, key)
            uploaded_keys.append(key)
            uploaded_shorts.append({
                "part": i,
                "r2_key": key,
                "url": url,
                "start_sec": start,
                "length_sec": clip_length_sec,
                "aspect_ratio": "9:16",
            })

        master_w, master_h = master_dims if master_dims else (None, None)
        published = True
        return {
            "package_id": job_id,
            "master": {
                "r2_key": master_key,
                "url": master_url,
                "width": master_w,
                "height": master_h,
            },
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
            "text_style": style,
            "lower_third": lower,
            # Report the uploaded deliverable, not the pre-export master.
            "duration_seconds": get_duration(export_master),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="ignore") if isinstance(e.stderr, (bytes, bytearray)) else str(e)
        raise HTTPException(status_code=500, detail=f"Packaging failed: {err[-500:]}")
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail="Source media key not found") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Packaging failed: {e}")
    finally:
        if not published:
            # Roll back partial publishes (M37); delete_object is best-effort.
            for key in uploaded_keys:
                delete_object(key)
        shutil.rmtree(work_dir, ignore_errors=True)
