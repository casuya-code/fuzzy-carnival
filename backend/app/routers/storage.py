import logging
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from app.config import (
    DEFAULT_INTRO_SEC,
    DEFAULT_OUTRO_SEC,
    MAX_INTRO_SEC,
    MAX_OUTRO_SEC,
    TEMP_AUDIO_DIR,
)
from app.services.audio_processor import (
    SFX_KINDS,
    _ffmpeg_available,
    analyze_reference,
    generate_sfx,
    get_duration,
    mix_voice_with_music,
    transform_audio,
)
from app.services.beat_sync_processor import (
    detect_bpm_lightweight,
    get_beat_synced_zoom_expr,
)
from app.services.r2_storage import download_reference, upload_output
from PIL import ImageFont

router = APIRouter(prefix="/api/v1", tags=["storage"])
logger = logging.getLogger(__name__)


def _cleanup_dir(path: Path) -> None:
    try:
        shutil.rmtree(path)
    except Exception as e:
        logger.warning("Cleanup failed for %s: %s", path, e)


def _cleanup_file(path: str | Path) -> None:
    try:
        Path(path).unlink(missing_ok=True)
    except Exception as e:
        logger.warning("Could not remove temporary file %s: %s", path, e)


def _safe_local_path(key: str) -> Path:
    root = TEMP_AUDIO_DIR.resolve()
    dest = (root / key).resolve()
    if dest != root and not dest.is_relative_to(root):
        raise HTTPException(status_code=400, detail="Invalid upload key")
    return dest


@router.put("/local-upload/{key:path}")
async def local_upload(key: str, request: Request):
    """Local dev fallback: accept uploaded files when R2 is not configured."""
    data = await request.body()
    dest = _safe_local_path(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return {"ok": True, "key": key}


class MixRequest(BaseModel):
    voice_r2_key: str = Field(..., min_length=1)
    music_r2_key: Optional[str] = Field(None, description="Layer 3: background music bed (ducked)")
    music_volume: float = Field(0.18, ge=0.0, le=1.0)
    ambient_r2_key: Optional[str] = Field(None, description="Layer 2: ambient texture/risers (steady)")
    ambient_volume: float = Field(0.08, ge=0.0, le=1.0)
    intro_ms: int = Field(
        int(DEFAULT_INTRO_SEC * 1000), ge=0, le=int(MAX_INTRO_SEC * 1000)
    )
    outro_sec: float = Field(DEFAULT_OUTRO_SEC, ge=0.0, le=MAX_OUTRO_SEC)


def _resolve_audio_key(key: str, dest: Optional[Path] = None) -> str:
    local = _safe_local_path(key)
    if local.exists():
        return str(local)
    try:
        return download_reference(key, dest=dest)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        # A missing audio key is a client input problem, not a server failure.
        raise HTTPException(status_code=404, detail=f"Audio key not found: {key}") from e


@router.post("/mix")
def mix(req: MixRequest):
    """Mix/master speech (L1) with optional ambient (L2, steady) and/or music (L3, auto-ducked). Voice-only mastering supported."""
    if not _ffmpeg_available():
        raise HTTPException(status_code=503, detail="FFmpeg required for mixing")

    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "mix_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    out_path = str(work_dir / f"mixed_{job_id}.mp3")

    try:
        voice_path = _resolve_audio_key(req.voice_r2_key, dest=work_dir / "voice.mp3")
        music_path = _resolve_audio_key(req.music_r2_key, dest=work_dir / "music.mp3") if req.music_r2_key else None
        ambient_path = _resolve_audio_key(req.ambient_r2_key, dest=work_dir / "ambient.mp3") if req.ambient_r2_key else None

        mix_voice_with_music(
            voice_path=voice_path,
            output_path=out_path,
            music_path=music_path,
            music_volume=req.music_volume,
            intro_ms=req.intro_ms,
            outro_sec=req.outro_sec,
            ambient_path=ambient_path,
            ambient_volume=req.ambient_volume,
        )

        r2_key = f"outputs/mixed_{job_id}.mp3"
        url = upload_output(out_path, r2_key)
        return {
            "audio_r2_key": r2_key,
            "audio_url": url,
            "duration_seconds": get_duration(out_path),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mix failed: {e}")
    finally:
        _cleanup_dir(work_dir)


class TransformRequest(BaseModel):
    audio_r2_key: str = Field(..., min_length=1)
    speed: float = Field(1.0, ge=0.25, le=4.0)
    volume: float = Field(1.0, ge=0.0, le=4.0)
    output_format: str = Field("mp3", pattern="^(mp3|wav)$")


@router.post("/audio/transform")
def transform(req: TransformRequest):
    """Expert export: tempo-preserving speed and/or volume adjustment, rendered to a new file."""
    if not _ffmpeg_available():
        raise HTTPException(status_code=503, detail="FFmpeg required for audio transform")

    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "transform_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    ext = ".wav" if req.output_format == "wav" else ".mp3"
    out_path = str(work_dir / f"xf_{job_id}{ext}")
    try:
        src = _resolve_audio_key(req.audio_r2_key, dest=work_dir / f"source{ext}")
        transform_audio(src, out_path, speed=req.speed, volume=req.volume, output_format=req.output_format)
        r2_key = f"outputs/xf_{job_id}{ext}"
        url = upload_output(out_path, r2_key)
        return {"audio_r2_key": r2_key, "audio_url": url, "duration_seconds": get_duration(out_path)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transform failed: {e}")
    finally:
        _cleanup_dir(work_dir)


class AnalyzeRequest(BaseModel):
    key: str = Field(..., min_length=1)


@router.post("/audio/analyze")
def analyze(req: AnalyzeRequest):
    """Analyze an uploaded/reference audio file and return quality metrics + hints."""
    path: str | None = None
    try:
        path = _resolve_audio_key(req.key, dest=TEMP_AUDIO_DIR / f"analyze_{uuid.uuid4().hex}")
        return analyze_reference(path)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analyze failed: {e}")
    finally:
        if path and Path(path).name.startswith("analyze_"):
            _cleanup_file(path)


class BpmRequest(BaseModel):
    key: str = Field(..., min_length=1)


@router.post("/audio/bpm")
def bpm(req: BpmRequest):
    """Detect the dominant BPM of an audio track and suggest a beat cycle."""
    path: str | None = None
    try:
        path = _resolve_audio_key(req.key, dest=TEMP_AUDIO_DIR / f"bpm_{uuid.uuid4().hex}")
        detected = detect_bpm_lightweight(path)
        _, cycle_sec = get_beat_synced_zoom_expr(detected)
        return {"bpm": detected, "cycle_sec": cycle_sec}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BPM detection failed: {e}")
    finally:
        if path and Path(path).name.startswith("bpm_"):
            _cleanup_file(path)


class SfxRequest(BaseModel):
    kind: str = Field(..., min_length=1)
    duration_sec: float | None = Field(None, ge=0.15, le=5.0)
    output_format: str = Field("mp3", pattern="^(mp3|wav)$")


@router.post("/audio/sfx")
def create_sfx(req: SfxRequest):
    """Generate a short sound effect locally and return it as a stored audio file."""
    if not _ffmpeg_available():
        raise HTTPException(status_code=503, detail="FFmpeg required for SFX generation")
    kind = str(req.kind or "").strip().lower()
    if kind not in SFX_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of: {', '.join(SFX_KINDS)}")

    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "sfx_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    ext = ".wav" if req.output_format == "wav" else ".mp3"
    out_path = str(work_dir / f"sfx_{kind}_{job_id}{ext}")
    try:
        generate_sfx(kind, out_path, duration_sec=req.duration_sec)
        r2_key = f"outputs/sfx_{kind}_{job_id}{ext}"
        url = upload_output(out_path, r2_key)
        return {
            "kind": kind,
            "audio_r2_key": r2_key,
            "audio_url": url,
            "duration_seconds": get_duration(out_path),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SFX generation failed: {e}")
    finally:
        _cleanup_dir(work_dir)


@router.post("/fonts/upload")
async def upload_brand_font(font: UploadFile = File(...)):
    """Upload a brand font (.ttf/.otf) for thumbnails/captions."""
    name = Path(font.filename or "").name
    suffix = Path(name).suffix.lower()
    if suffix not in {".ttf", ".otf"}:
        raise HTTPException(status_code=400, detail="Font must be .ttf or .otf")
    data = await font.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Font must be 5 MB or smaller")
    fonts_dir = TEMP_AUDIO_DIR / "brand_fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    font_id = uuid.uuid4().hex
    dest = fonts_dir / f"{font_id}{suffix}"
    dest.write_bytes(data)
    try:
        family, style = ImageFont.truetype(str(dest), 24).getname()
    except Exception:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Invalid font file")
    return {"font_path": str(dest), "font_name": family or Path(name).stem, "font_style": style or ""}
