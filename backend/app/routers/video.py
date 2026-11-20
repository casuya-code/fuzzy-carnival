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
from app.services.naming_utils import build_video_r2_key
from app.services.captions_processor import (
    DEFAULT_ASPECT_RATIO,
    SAFE_ZONES,
    chunk_count,
    generate_word_by_word_ass,
    time_words,
)
from app.services.r2_storage import download_reference, upload_output
from app.services.video_processor import stitch_clips_with_audio, stitch_silent_clips, trim_and_zoom_clip

router = APIRouter(prefix="/api/v1/video", tags=["video"])


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

        # Best-effort BPM detection for beat-synced zoompan (falls back to static).
        zoom_expr = None
        try:
            from app.services.beat_sync_processor import (
                detect_bpm_lightweight,
                get_beat_synced_zoom_expr,
            )

            bpm = detect_bpm_lightweight(audio_path)
            zoom_expr, _ = get_beat_synced_zoom_expr(bpm)
        except Exception:
            zoom_expr = None

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
                )
            finally:
                Path(raw_path).unlink(missing_ok=True)
            processed_paths.append(proc_path)

        # Optional animated captions: generate ASS before the final merge so
        # libass renders in the same pass (saves a full video encode on CPU).
        ass_path = None
        caption_meta: dict = {}
        if script_text and script_text.strip():
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
                script_text=script_text,
                voice_duration=voice_duration,
                ass_output_path=ass_path,
                intro_delay_sec=intro,
                aspect_ratio=aspect_ratio,
                words_per_chunk=words_per_chunk,
            )
            timings = time_words(script_text, voice_duration, intro)
            caption_meta = {
                "word_count": len(timings),
                "chunk_count": chunk_count(len(timings), words_per_chunk),
                "voice_duration_seconds": voice_duration,
                "intro_delay_sec": intro,
                "aspect_ratio": aspect_ratio,
            }

        stitch_clips_with_audio(
            processed_paths,
            audio_path,
            final_path,
            ass_path=ass_path,
            aspect_ratio=aspect_ratio,
            upscale_2k=upscale_2k,
            loudnorm=loudnorm,
        )

        r2_key = build_video_r2_key("Video_Master16x9", language, topic, "mp4")
        url = upload_output(final_path, r2_key)
        duration = get_duration(final_path)

        return {
            "video_r2_key": r2_key,
            "video_url": url,
            "duration_seconds": duration,
            "clips_processed": len(processed_paths),
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
):
    """Process a batch of clips (trim + zoom) and return one stitched silent intermediate video.

    Intended for large jobs: frontend can send clips in smaller batches, then call /finalize
    with the returned intermediate keys and the audio track.
    """
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe required for video processing")
    if not clips:
        raise HTTPException(status_code=400, detail="At least one video clip is required")
    if aspect_ratio not in SAFE_ZONES:
        allowed = ", ".join(f"'{k}'" for k in SAFE_ZONES)
        raise HTTPException(status_code=400, detail=f"aspect_ratio must be one of {allowed}")
    trim_end_sec = max(0.0, min(float(trim_end_sec), MAX_TRIM_END_SEC))

    job_id = uuid.uuid4().hex
    work_dir = TEMP_AUDIO_DIR / "video_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    processed_paths: list[str] = []
    batch_path = str(work_dir / f"batch_{job_id}.mp4")

    try:
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
                )
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed processing clip {i + 1}: {e}")
            finally:
                Path(raw_path).unlink(missing_ok=True)
            processed_paths.append(proc_path)

        stitch_silent_clips(processed_paths, batch_path)

        r2_key = build_video_r2_key("Video_Batch", language, topic, "mp4")
        url = upload_output(batch_path, r2_key)
        duration = get_duration(batch_path)

        return {
            "video_r2_key": r2_key,
            "video_url": url,
            "duration_seconds": duration,
            "clips_processed": len(processed_paths),
            "intermediate": True,
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

        # Download segment videos in order
        for i, key in enumerate(segment_keys):
            seg_path = download_reference(key, dest=work_dir / f"seg_{i}{Path(key).suffix or '.mp4'}")
            segment_paths.append(seg_path)

        ass_path = None
        caption_meta: dict = {}
        if script_text and script_text.strip():
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
                script_text=script_text,
                voice_duration=voice_duration,
                ass_output_path=ass_path,
                intro_delay_sec=intro,
                aspect_ratio=aspect_ratio,
                words_per_chunk=words_per_chunk,
            )
            timings = time_words(script_text, voice_duration, intro)
            caption_meta = {
                "word_count": len(timings),
                "chunk_count": chunk_count(len(timings), words_per_chunk),
                "voice_duration_seconds": voice_duration,
                "intro_delay_sec": intro,
                "aspect_ratio": aspect_ratio,
            }

        stitch_clips_with_audio(
            segment_paths,
            audio_path,
            final_path,
            ass_path=ass_path,
            aspect_ratio=aspect_ratio,
            upscale_2k=upscale_2k,
            loudnorm=loudnorm,
        )

        r2_key = build_video_r2_key("Video_Master16x9", language, topic, "mp4")
        url = upload_output(final_path, r2_key)
        duration = get_duration(final_path)

        return {
            "video_r2_key": r2_key,
            "video_url": url,
            "duration_seconds": duration,
            "clips_processed": len(segment_paths),
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
