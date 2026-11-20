import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.config import (
    DEFAULT_INTRO_SEC,
    DEFAULT_OUTRO_SEC,
    DEFAULT_WORDS_PER_CHUNK,
    MAX_INTRO_SEC,
    MAX_OUTRO_SEC,
    MAX_WORDS_PER_CHUNK,
    TEMP_AUDIO_DIR,
)
from app.services.naming_utils import build_video_r2_key
from app.services.audio_processor import _media_tools_available, get_duration
from app.services.captions_processor import (
    DEFAULT_ASPECT_RATIO,
    SAFE_ZONES,
    burn_captions_onto_video,
    chunk_count,
    format_ass_time,
    generate_word_by_word_ass,
    time_words,
)
from app.services.r2_storage import download_reference, upload_output

router = APIRouter(prefix="/api/v1", tags=["captions"])


def _validate_aspect(aspect_ratio: str) -> None:
    if aspect_ratio not in SAFE_ZONES:
        allowed = ", ".join(f"'{k}'" for k in SAFE_ZONES)
        raise HTTPException(status_code=400, detail=f"aspect_ratio must be one of {allowed}")


class CaptionPreviewRequest(BaseModel):
    script_text: str = Field(..., min_length=1, max_length=4000)
    voice_duration: float = Field(..., gt=0, le=10000)
    intro_delay_sec: float = Field(DEFAULT_INTRO_SEC, ge=0, le=MAX_INTRO_SEC)
    aspect_ratio: str = Field(DEFAULT_ASPECT_RATIO)
    words_per_chunk: int = Field(DEFAULT_WORDS_PER_CHUNK, ge=1, le=MAX_WORDS_PER_CHUNK)


@router.post("/captions/preview")
def captions_preview(payload: CaptionPreviewRequest):
    """Preview word timings + sample ASS dialogue without rendering a video."""
    _validate_aspect(payload.aspect_ratio)
    zone = SAFE_ZONES[payload.aspect_ratio]
    timings = time_words(payload.script_text, payload.voice_duration, payload.intro_delay_sec)
    sample_lines = []
    for tw in timings[: 3 * payload.words_per_chunk]:
        sample_lines.append(
            f"{format_ass_time(tw['start'])} → {format_ass_time(tw['end'])}  {tw['word'].upper()}"
        )
    return {
        "word_count": len(timings),
        "chunk_count": chunk_count(len(timings), payload.words_per_chunk),
        "word_timings": timings,
        "sample_lines": sample_lines,
        "style": {
            "aspect_ratio": payload.aspect_ratio,
            "play_res": [zone["w"], zone["h"]],
            "font_size": zone["font"],
            "margin_l": zone["ml"],
            "margin_r": zone["mr"],
            "margin_v": zone["mv"],
            "highlight": "&H00FFFF& (yellow)",
            "base": "&HFFFFFF& (white)",
            "outline": 5,
        },
        "intro_delay_sec": payload.intro_delay_sec,
        "voice_duration": payload.voice_duration,
    }


@router.post("/captions/burn")
async def captions_burn(
    video: Optional[UploadFile] = File(None),
    video_r2_key: Optional[str] = Form(None),
    script_text: str = Form(...),
    intro_delay_sec: float = Form(DEFAULT_INTRO_SEC),
    voice_duration: Optional[float] = Form(None),
    outro_sec: float = Form(DEFAULT_OUTRO_SEC),
    aspect_ratio: str = Form(DEFAULT_ASPECT_RATIO),
    words_per_chunk: int = Form(DEFAULT_WORDS_PER_CHUNK),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
):
    """Generate a word-by-word ASS file and burn it onto an existing video.

    Video source: upload a file from the device, or pass video_r2_key from a
    previous Trimming & Zooming result.
    """
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe/libass required for captions")
    if video is None and not video_r2_key:
        raise HTTPException(status_code=400, detail="Provide a video file or video_r2_key")
    if not script_text.strip():
        raise HTTPException(status_code=400, detail="script_text is required")
    _validate_aspect(aspect_ratio)
    words_per_chunk = max(1, min(int(words_per_chunk), MAX_WORDS_PER_CHUNK))
    intro = max(0.0, min(float(intro_delay_sec), MAX_INTRO_SEC))
    outro = max(0.0, min(float(outro_sec), MAX_OUTRO_SEC))

    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "caption_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    video_path: Optional[str] = None
    final_path = str(work_dir / f"captioned_{job_id}.mp4")
    ass_path = str(work_dir / "captions.ass")

    try:
        if video is not None:
            suffix = Path(video.filename or "video.mp4").suffix or ".mp4"
            video_path = str(work_dir / f"source{suffix}")
            with open(video_path, "wb") as f:
                shutil.copyfileobj(video.file, f)
        else:
            # Download into the job dir so cleanup can never touch cached files.
            video_path = download_reference(
                video_r2_key,  # type: ignore[arg-type]
                dest=work_dir / f"source{Path(video_r2_key).suffix or '.mp4'}",  # type: ignore[arg-type]
            )

        duration = get_duration(video_path)
        vd = (
            max(1.0, float(voice_duration))
            if voice_duration is not None
            else max(1.0, duration - intro - outro)
        )

        generate_word_by_word_ass(
            script_text=script_text,
            voice_duration=vd,
            ass_output_path=ass_path,
            intro_delay_sec=intro,
            aspect_ratio=aspect_ratio,
            words_per_chunk=words_per_chunk,
        )
        burn_captions_onto_video(video_path, ass_path, final_path)

        r2_key = build_video_r2_key("Video_Captioned", language, topic, "mp4")
        url = upload_output(final_path, r2_key)
        ass_key = build_video_r2_key("Captions", language, topic, "ass")
        ass_url = ""
        try:
            ass_url = upload_output(ass_path, ass_key)
        except Exception:
            ass_key = ""

        timings = time_words(script_text, vd, intro)
        return {
            "video_r2_key": r2_key,
            "video_url": url,
            "duration_seconds": get_duration(final_path),
            "ass_r2_key": ass_key,
            "ass_url": ass_url,
            "word_count": len(timings),
            "chunk_count": chunk_count(len(timings), words_per_chunk),
            "voice_duration_seconds": vd,
            "intro_delay_sec": intro,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="ignore") if isinstance(e.stderr, (bytes, bytearray)) else str(e)
        raise HTTPException(status_code=500, detail=f"Caption burn failed: {err[-500:]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Caption burn failed: {e}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
