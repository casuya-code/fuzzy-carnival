import logging
import shutil
import subprocess
import uuid
from pathlib import Path
import json
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import (
    DEFAULT_INTRO_SEC,
    DEFAULT_OUTRO_SEC,
    DEFAULT_TRIM_END_SEC,
    DEFAULT_WORDS_PER_CHUNK,
    MAX_INTRO_SEC,
    MAX_OUTRO_SEC,
    MAX_TRIM_END_SEC,
    MAX_WORDS_PER_CHUNK,
    TEMP_AUDIO_DIR,
)
from app.services.audio_processor import _media_tools_available, get_duration
from app.services.local_overlays import (
    ALLOWED_IMAGE_SUFFIXES,
    DEFAULT_OVERLAY_OPACITY,
    DEFAULT_OVERLAY_POSITION,
    DEFAULT_OVERLAY_SIZE,
    normalize_overlay_opacity,
    normalize_overlay_position,
    normalize_overlay_size,
)
from app.services.naming_utils import build_video_r2_key
from app.services.captions_processor import (
    DEFAULT_ASPECT_RATIO,
    SAFE_ZONES,
    chunk_count,
    generate_word_by_word_ass,
    time_words,
)
from app.services.r2_storage import download_reference, upload_output
from app.services.sfx_generator import DEFAULT_SFX, DEFAULT_SFX_LEVEL, normalize_sfx, normalize_sfx_level
from app.services.text_styles import has_lower_third, normalize_lower_third, normalize_text_style
from app.services.video_overlays import DEFAULT_OVERLAY as DEFAULT_EFFECT_OVERLAY, normalize_overlay as normalize_effect_overlay
from app.services.video_transitions import (
    DEFAULT_TRANSITION,
    DEFAULT_TRANSITION_DURATION_SEC,
    MAX_TRANSITION_DURATION_SEC,
    MIN_TRANSITION_DURATION_SEC,
    normalize_transition,
    parse_transitions,
)
from app.services.video_processor import stitch_clips_with_audio, stitch_silent_clips, trim_and_zoom_clip

router = APIRouter(prefix="/api/v1/video", tags=["video"])
logger = logging.getLogger(__name__)


def _transition_settings(
    transition: str,
    duration_sec: float,
    raw_gaps: str | None,
    gap_count: int,
) -> tuple[str, float, list[str]]:
    """Validate form values and return (default, duration, per-gap names)."""
    try:
        default = normalize_transition(transition)
        duration = max(MIN_TRANSITION_DURATION_SEC, min(float(duration_sec), MAX_TRANSITION_DURATION_SEC))
        gaps = parse_transitions(raw_gaps, gap_count, default)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return default, duration, gaps


def _text_style_or_400(raw: str | None):
    try:
        return normalize_text_style(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _sfx_settings(name: str | None, level: object) -> tuple[str, int]:
    try:
        return normalize_sfx(name), normalize_sfx_level(level)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _overlay_settings(
    position: str | None, size: object, opacity: object
) -> tuple[str, int, int]:
    try:
        return (
            normalize_overlay_position(position),
            normalize_overlay_size(size),
            normalize_overlay_opacity(opacity),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _effect_overlay(value: str | None) -> str:
    try:
        return normalize_effect_overlay(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _save_overlay_upload(image: UploadFile | None, work_dir: Path, job_id: str) -> str | None:
    """Validate and save a user-supplied badge image; return its local path."""
    if image is None:
        return None
    content_type = (image.content_type or "").lower()
    suffix = Path(image.filename or "").suffix.lower()
    if not content_type.startswith("image/") or suffix not in ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="overlay_image must be a PNG, JPG or WebP image")
    image.file.seek(0, 2)
    size_bytes = image.file.tell()
    image.file.seek(0)
    if size_bytes > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="overlay_image must be 10 MB or smaller")
    path = work_dir / f"overlay_{job_id}{suffix}"
    with open(path, "wb") as f:
        shutil.copyfileobj(image.file, f)
    return str(path)


def _beat_sync_zoom(
    audio_path: str | None = None, bpm: float | None = None
) -> tuple[str | None, float | None]:
    """Build the same beat-synced zoom for /process and /process-batch.

    Accepts either an audio file to analyse or an already-known BPM. Failures are
    non-fatal: callers fall back to the static retention zoom.
    """
    try:
        from app.services.beat_sync_processor import (
            detect_bpm_lightweight,
            get_beat_synced_zoom_expr,
        )

        if bpm is None:
            if not audio_path:
                return None, None
            bpm = detect_bpm_lightweight(audio_path)
        zoom_expr, _ = get_beat_synced_zoom_expr(bpm)
        return zoom_expr, bpm
    except Exception as e:
        logger.warning("Beat-synced zoom setup failed (audio=%s, bpm=%s): %s", audio_path, bpm, e)
        return None, None


@router.post("/process")
async def process_video(
    clips: List[UploadFile] = File(...),
    audio: Optional[UploadFile] = File(None),
    audio_r2_key: Optional[str] = Form(None),
    aspect_ratio: str = Form(DEFAULT_ASPECT_RATIO),
    trim_end_sec: float = Form(DEFAULT_TRIM_END_SEC),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
    script_text: Optional[str] = Form(None),
    intro_delay_sec: Optional[float] = Form(None),
    outro_sec: Optional[float] = Form(None),
    words_per_chunk: int = Form(DEFAULT_WORDS_PER_CHUNK),
    upscale_2k: bool = Form(False),
    loudnorm: bool = Form(False),
    transition: str = Form(DEFAULT_TRANSITION),
    transition_duration_sec: float = Form(DEFAULT_TRANSITION_DURATION_SEC),
    transitions: Optional[str] = Form(None),
    transition_sfx: str = Form(DEFAULT_SFX),
    transition_sfx_level: int = Form(DEFAULT_SFX_LEVEL),
    overlay_image: Optional[UploadFile] = File(None),
    overlay_position: str = Form(DEFAULT_OVERLAY_POSITION),
    overlay_size: int = Form(DEFAULT_OVERLAY_SIZE),
    overlay_opacity: int = Form(DEFAULT_OVERLAY_OPACITY),
    overlay: str = Form(DEFAULT_EFFECT_OVERLAY),
    caption_style: Optional[str] = Form(None),
    lower_third: Optional[str] = Form(None),
    lower_third_duration_sec: float = Form(5.0),
    font_path: Optional[str] = Form(None),
):
    """Trim tail warp, apply 2.5s retention zoom to each clip, stitch, and attach unified audio.

    When script_text is supplied, animated word-by-word captions are burned in
    the same final encode pass (no second video encode).
    """
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe required for video processing")
    if not clips:
        raise HTTPException(status_code=400, detail="At least one video clip is required")
    if audio is None and not audio_r2_key:
        raise HTTPException(status_code=400, detail="Provide an audio track (upload or audio_r2_key)")
    if aspect_ratio not in SAFE_ZONES:
        allowed = ", ".join(f"'{k}'" for k in SAFE_ZONES)
        raise HTTPException(status_code=400, detail=f"aspect_ratio must be one of {allowed}")
    trim_end_sec = max(0.0, min(float(trim_end_sec), MAX_TRIM_END_SEC))
    words_per_chunk = max(1, min(int(words_per_chunk), MAX_WORDS_PER_CHUNK))
    transition, transition_duration_sec, gaps = _transition_settings(
        transition, transition_duration_sec, transitions, len(clips) - 1
    )
    sfx, sfx_level = _sfx_settings(transition_sfx, transition_sfx_level)
    overlay_pos, overlay_size, overlay_opacity = _overlay_settings(
        overlay_position, overlay_size, overlay_opacity
    )
    overlay_fx = _effect_overlay(overlay)
    overlay_path: str | None = None

    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "video_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    processed_paths: list[str] = []
    final_path = str(work_dir / f"final_{job_id}.mp4")
    audio_path: Optional[str] = None

    try:
        # Resolve audio first so BPM can drive beat-synced zooms/cuts.
        if audio is not None:
            a_suffix = Path(audio.filename or "audio.mp3").suffix or ".mp3"
            audio_path = str(work_dir / f"audio_{job_id}{a_suffix}")
            with open(audio_path, "wb") as f:
                shutil.copyfileobj(audio.file, f)
        else:
            # Download into the job dir so cleanup is automatic
            audio_path = download_reference(
                audio_r2_key,  # type: ignore[arg-type]
                dest=work_dir / f"audio{Path(audio_r2_key).suffix or '.mp3'}",  # type: ignore[arg-type]
            )

        overlay_path = _save_overlay_upload(overlay_image, work_dir, job_id)

        # Best-effort BPM detection for beat-synced zoompan (falls back to static).
        zoom_expr, _ = _beat_sync_zoom(audio_path=audio_path)

        # Save and process clips in received order
        for i, up in enumerate(clips):
            suffix = Path(up.filename or f"clip_{i}.mp4").suffix or ".mp4"
            raw_path = str(work_dir / f"raw_{i}{suffix}")
            proc_path = str(work_dir / f"proc_{i}.mp4")
            with open(raw_path, "wb") as f:
                shutil.copyfileobj(up.file, f)
            try:
                trim_and_zoom_clip(
                    input_path=raw_path,
                    output_path=proc_path,
                    trim_end_sec=trim_end_sec,
                    aspect_ratio=aspect_ratio,
                    zoom_expr=zoom_expr,
                    overlay=overlay_fx,
                )
            finally:
                Path(raw_path).unlink(missing_ok=True)
            processed_paths.append(proc_path)

        # Optional animated captions: generate ASS before the final merge so
        # libass renders in the same pass (saves a full video encode on CPU).
        ass_path = None
        caption_meta: dict = {}
        style = _text_style_or_400(caption_style)
        lower = normalize_lower_third(lower_third)
        script = script_text or ""
        if (script.strip() or has_lower_third(lower)):
            intro = (
                max(0.0, min(float(intro_delay_sec), MAX_INTRO_SEC))
                if intro_delay_sec is not None
                else DEFAULT_INTRO_SEC
            )
            outro = (
                max(0.0, min(float(outro_sec), MAX_OUTRO_SEC))
                if outro_sec is not None
                else DEFAULT_OUTRO_SEC
            )
            audio_duration = get_duration(audio_path)
            voice_duration = max(1.0, audio_duration - intro - outro)
            ass_path = str(work_dir / "captions.ass")
            generate_word_by_word_ass(
                script_text=script,
                voice_duration=voice_duration,
                ass_output_path=ass_path,
                intro_delay_sec=intro,
                aspect_ratio=aspect_ratio,
                words_per_chunk=words_per_chunk,
                caption_style=style,
                lower_third=lower,
                lower_third_duration_sec=lower_third_duration_sec,
                font_path=font_path,
            )
            timings = time_words(script, voice_duration, intro)
            caption_meta = {
                "word_count": len(timings),
                "chunk_count": chunk_count(len(timings), words_per_chunk),
                "voice_duration_seconds": voice_duration,
                "intro_delay_sec": intro,
                "aspect_ratio": aspect_ratio,
                "caption_style": style,
                "lower_third": lower,
                "lower_third_duration_sec": max(1.0, min(15.0, float(lower_third_duration_sec))),
            }

        stitch_clips_with_audio(
            processed_paths,
            audio_path,
            final_path,
            ass_path=ass_path,
            aspect_ratio=aspect_ratio,
            upscale_2k=upscale_2k,
            loudnorm=loudnorm,
            transition=transition,
            transition_duration_sec=transition_duration_sec,
            transitions=gaps,
            transition_sfx=sfx,
            transition_sfx_level=sfx_level,
            overlay_image_path=overlay_path,
            overlay_position=overlay_pos,
            overlay_size=overlay_size,
            overlay_opacity=overlay_opacity,
            overlay=overlay_fx,
            font_path=font_path,
        )

        r2_key = build_video_r2_key("Video_Master16x9", language, topic, "mp4")
        url = upload_output(final_path, r2_key)
        duration = get_duration(final_path)

        return {
            "video_r2_key": r2_key,
            "video_url": url,
            "duration_seconds": duration,
            "clips_processed": len(processed_paths),
            "transition_sfx": sfx,
            "transition_sfx_level": sfx_level,
            "overlay": overlay_fx,
            "overlay_image": bool(overlay_path),
            "overlay_position": overlay_pos,
            "overlay_size": overlay_size,
            "overlay_opacity": overlay_opacity,
            **caption_meta,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="ignore") if isinstance(e.stderr, (bytes, bytearray)) else str(e)
        raise HTTPException(status_code=500, detail=f"Video processing failed: {err[-500:]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video processing failed: {e}")
    finally:
        # Cleanup job working dir (final was copied/uploaded)
        shutil.rmtree(work_dir, ignore_errors=True)


@router.post("/process-batch")
async def process_video_batch(
    clips: List[UploadFile] = File(...),
    aspect_ratio: str = Form(DEFAULT_ASPECT_RATIO),
    trim_end_sec: float = Form(DEFAULT_TRIM_END_SEC),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
    audio: Optional[UploadFile] = File(None),
    audio_r2_key: Optional[str] = Form(None),
    bpm: Optional[float] = Form(None),
    transition: str = Form(DEFAULT_TRANSITION),
    transition_duration_sec: float = Form(DEFAULT_TRANSITION_DURATION_SEC),
    transitions: Optional[str] = Form(None),
    overlay: str = Form(DEFAULT_EFFECT_OVERLAY),
):
    """Process a batch of clips (trim + zoom) and return one stitched silent intermediate video.

    Intended for large jobs: frontend can send clips in smaller batches, then call /finalize
    with the returned intermediate keys and the audio track. Pass ``audio``, ``audio_r2_key``
    or ``bpm`` to apply the same beat-synced zoom used by /process; without them the static
    retention zoom is used (backwards compatible with existing batch callers).
    """
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe required for video processing")
    if not clips:
        raise HTTPException(status_code=400, detail="At least one video clip is required")
    if aspect_ratio not in SAFE_ZONES:
        allowed = ", ".join(f"'{k}'" for k in SAFE_ZONES)
        raise HTTPException(status_code=400, detail=f"aspect_ratio must be one of {allowed}")
    trim_end_sec = max(0.0, min(float(trim_end_sec), MAX_TRIM_END_SEC))
    transition, transition_duration_sec, gaps = _transition_settings(
        transition, transition_duration_sec, transitions, len(clips) - 1
    )
    overlay_fx = _effect_overlay(overlay)

    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "video_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    processed_paths: list[str] = []
    batch_path = str(work_dir / f"batch_{job_id}.mp4")

    try:
        # Optional audio/BPM makes large-job clips match the direct /process path.
        batch_audio_path: str | None = None
        if audio is not None:
            a_suffix = Path(audio.filename or "audio.mp3").suffix or ".mp3"
            batch_audio_path = str(work_dir / f"audio{job_id}{a_suffix}")
            with open(batch_audio_path, "wb") as f:
                shutil.copyfileobj(audio.file, f)
        elif audio_r2_key:
            batch_audio_path = download_reference(
                audio_r2_key,
                dest=work_dir / f"audio{Path(audio_r2_key).suffix or '.mp3'}",
            )
        zoom_expr, bpm_used = _beat_sync_zoom(audio_path=batch_audio_path, bpm=bpm)

        for i, up in enumerate(clips):
            suffix = Path(up.filename or f"clip_{i}.mp4").suffix or ".mp4"
            raw_path = str(work_dir / f"raw_{i}{suffix}")
            proc_path = str(work_dir / f"proc_{i}.mp4")
            with open(raw_path, "wb") as f:
                shutil.copyfileobj(up.file, f)
            try:
                trim_and_zoom_clip(
                    input_path=raw_path,
                    output_path=proc_path,
                    trim_end_sec=trim_end_sec,
                    aspect_ratio=aspect_ratio,
                    zoom_expr=zoom_expr,
                    overlay=overlay_fx,
                )
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed processing clip {i + 1}: {e}")
            finally:
                Path(raw_path).unlink(missing_ok=True)
            processed_paths.append(proc_path)

        stitch_silent_clips(
            processed_paths,
            batch_path,
            transition=transition,
            transition_duration_sec=transition_duration_sec,
            transitions=gaps,
            overlay=overlay_fx,
        )

        r2_key = build_video_r2_key("Video_Batch", language, topic, "mp4")
        url = upload_output(batch_path, r2_key)
        duration = get_duration(batch_path)

        return {
            "video_r2_key": r2_key,
            "video_url": url,
            "duration_seconds": duration,
            "clips_processed": len(processed_paths),
            "intermediate": True,
            "bpm": bpm_used,
            "zoom_synced": zoom_expr is not None,
        }
    except HTTPException:
        raise
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="ignore") if isinstance(e.stderr, (bytes, bytearray)) else str(e)
        raise HTTPException(status_code=500, detail=f"Video batch processing failed: {err[-500:]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video batch processing failed: {e}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@router.post("/finalize")
async def finalize_video(
    video_r2_keys: str = Form(...),
    audio: Optional[UploadFile] = File(None),
    audio_r2_key: Optional[str] = Form(None),
    aspect_ratio: str = Form(DEFAULT_ASPECT_RATIO),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
    script_text: Optional[str] = Form(None),
    intro_delay_sec: Optional[float] = Form(None),
    outro_sec: Optional[float] = Form(None),
    words_per_chunk: int = Form(DEFAULT_WORDS_PER_CHUNK),
    upscale_2k: bool = Form(False),
    loudnorm: bool = Form(False),
    transition: str = Form(DEFAULT_TRANSITION),
    transition_duration_sec: float = Form(DEFAULT_TRANSITION_DURATION_SEC),
    transitions: Optional[str] = Form(None),
    transition_sfx: str = Form(DEFAULT_SFX),
    transition_sfx_level: int = Form(DEFAULT_SFX_LEVEL),
    overlay_image: Optional[UploadFile] = File(None),
    overlay_position: str = Form(DEFAULT_OVERLAY_POSITION),
    overlay_size: int = Form(DEFAULT_OVERLAY_SIZE),
    overlay_opacity: int = Form(DEFAULT_OVERLAY_OPACITY),
    overlay: str = Form(DEFAULT_EFFECT_OVERLAY),
    caption_style: Optional[str] = Form(None),
    lower_third: Optional[str] = Form(None),
    lower_third_duration_sec: float = Form(5.0),
    font_path: Optional[str] = Form(None),
):
    """Finalize one or more processed/intermediate video segments with unified audio (and optional captions)."""
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe required for video processing")
    if audio is None and not audio_r2_key:
        raise HTTPException(status_code=400, detail="Provide an audio track (upload or audio_r2_key)")
    if aspect_ratio not in SAFE_ZONES:
        allowed = ", ".join(f"'{k}'" for k in SAFE_ZONES)
        raise HTTPException(status_code=400, detail=f"aspect_ratio must be one of {allowed}")
    words_per_chunk = max(1, min(int(words_per_chunk), MAX_WORDS_PER_CHUNK))

    try:
        keys_raw = json.loads(video_r2_keys)
        if isinstance(keys_raw, str):
            segment_keys = [keys_raw] if keys_raw.strip() else []
        elif isinstance(keys_raw, list):
            segment_keys = [str(k) for k in keys_raw if str(k).strip()]
        else:
            segment_keys = []
    except Exception:
        # fallback: comma-separated
        segment_keys = [k.strip() for k in video_r2_keys.split(",") if k.strip()]

    if not segment_keys:
        raise HTTPException(status_code=400, detail="At least one video segment key is required")
    transition, transition_duration_sec, gaps = _transition_settings(
        transition, transition_duration_sec, transitions, len(segment_keys) - 1
    )
    sfx, sfx_level = _sfx_settings(transition_sfx, transition_sfx_level)
    overlay_pos, overlay_size, overlay_opacity = _overlay_settings(
        overlay_position, overlay_size, overlay_opacity
    )
    overlay_fx = _effect_overlay(overlay)
    overlay_path: str | None = None

    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "video_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    final_path = str(work_dir / f"final_{job_id}.mp4")
    audio_path: Optional[str] = None
    segment_paths: list[str] = []

    try:
        # Resolve audio
        if audio is not None:
            a_suffix = Path(audio.filename or "audio.mp3").suffix or ".mp3"
            audio_path = str(work_dir / f"audio_{job_id}{a_suffix}")
            with open(audio_path, "wb") as f:
                shutil.copyfileobj(audio.file, f)
        else:
            audio_path = download_reference(
                audio_r2_key,  # type: ignore[arg-type]
                dest=work_dir / f"audio{Path(audio_r2_key).suffix or '.mp3'}",  # type: ignore[arg-type]
            )

        overlay_path = _save_overlay_upload(overlay_image, work_dir, job_id)

        # Download segment videos in order
        for i, key in enumerate(segment_keys):
            seg_path = download_reference(key, dest=work_dir / f"seg_{i}{Path(key).suffix or '.mp4'}")
            segment_paths.append(seg_path)

        ass_path = None
        caption_meta: dict = {}
        style = _text_style_or_400(caption_style)
        lower = normalize_lower_third(lower_third)
        script = script_text or ""
        if (script.strip() or has_lower_third(lower)):
            intro = (
                max(0.0, min(float(intro_delay_sec), MAX_INTRO_SEC))
                if intro_delay_sec is not None
                else DEFAULT_INTRO_SEC
            )
            outro = (
                max(0.0, min(float(outro_sec), MAX_OUTRO_SEC))
                if outro_sec is not None
                else DEFAULT_OUTRO_SEC
            )
            audio_duration = get_duration(audio_path)
            voice_duration = max(1.0, audio_duration - intro - outro)
            ass_path = str(work_dir / "captions.ass")
            generate_word_by_word_ass(
                script_text=script,
                voice_duration=voice_duration,
                ass_output_path=ass_path,
                intro_delay_sec=intro,
                aspect_ratio=aspect_ratio,
                words_per_chunk=words_per_chunk,
                caption_style=style,
                lower_third=lower,
                lower_third_duration_sec=lower_third_duration_sec,
                font_path=font_path,
            )
            timings = time_words(script, voice_duration, intro)
            caption_meta = {
                "word_count": len(timings),
                "chunk_count": chunk_count(len(timings), words_per_chunk),
                "voice_duration_seconds": voice_duration,
                "intro_delay_sec": intro,
                "aspect_ratio": aspect_ratio,
                "caption_style": style,
                "lower_third": lower,
                "lower_third_duration_sec": max(1.0, min(15.0, float(lower_third_duration_sec))),
            }

        stitch_clips_with_audio(
            segment_paths,
            audio_path,
            final_path,
            ass_path=ass_path,
            aspect_ratio=aspect_ratio,
            upscale_2k=upscale_2k,
            loudnorm=loudnorm,
            transition=transition,
            transition_duration_sec=transition_duration_sec,
            transitions=gaps,
            transition_sfx=sfx,
            transition_sfx_level=sfx_level,
            overlay_image_path=overlay_path,
            overlay_position=overlay_pos,
            overlay_size=overlay_size,
            overlay_opacity=overlay_opacity,
            overlay=overlay_fx,
            font_path=font_path,
        )

        r2_key = build_video_r2_key("Video_Master16x9", language, topic, "mp4")
        url = upload_output(final_path, r2_key)
        duration = get_duration(final_path)

        return {
            "video_r2_key": r2_key,
            "video_url": url,
            "duration_seconds": duration,
            "clips_processed": len(segment_paths),
            "transition_sfx": sfx,
            "transition_sfx_level": sfx_level,
            "overlay": overlay_fx,
            "overlay_image": bool(overlay_path),
            "overlay_position": overlay_pos,
            "overlay_size": overlay_size,
            "overlay_opacity": overlay_opacity,
            **caption_meta,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="ignore") if isinstance(e.stderr, (bytes, bytearray)) else str(e)
        raise HTTPException(status_code=500, detail=f"Video finalize failed: {err[-500:]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video finalize failed: {e}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
