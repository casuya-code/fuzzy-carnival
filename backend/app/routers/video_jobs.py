"""Background (202) variants of the video render endpoints.

Every render option is forwarded unchanged to the existing synchronous endpoints;
only the transport changes. Jobs are process-local and bounded per owner by
``VIDEO_JOB_MAX_CONCURRENT``.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import shutil
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app.auth import require_user as require_api_key
from app.config import DEFAULT_TRIM_END_SEC, DEFAULT_WORDS_PER_CHUNK, TEMP_AUDIO_DIR
from app.observability import record
from app.rate_limit import rate_limit
from app.routers.video import (
    _effect_overlay,
    _font_path_or_400,
    _lower_third_or_400,
    _overlay_settings,
    _parse_segment_keys,
    _save_overlay_upload,
    _sfx_settings,
    _text_style_or_400,
    _transition_settings,
    finalize_video,
    process_video,
    process_video_batch,
)
from app.services.audio_processor import _media_tools_available
from app.services.captions_processor import DEFAULT_ASPECT_RATIO, SAFE_ZONES
from app.services.job_context import JobCancelled, JobContext, reset_job_context, set_job_context
from app.services.user_store import verify_access_token
from app.services.upload_validation import copy_upload_capped
from app.services.video_jobs import bind_job_owner, clear_job_owner, get_video_job_store
from app.services.video_overlays import DEFAULT_OVERLAY as DEFAULT_EFFECT_OVERLAY
from app.services.video_transitions import DEFAULT_TRANSITION, DEFAULT_TRANSITION_DURATION_SEC
from app.services.local_overlays import (
    DEFAULT_OVERLAY_OPACITY,
    DEFAULT_OVERLAY_POSITION,
    DEFAULT_OVERLAY_SIZE,
)
from app.services.sfx_generator import DEFAULT_SFX, DEFAULT_SFX_LEVEL

router = APIRouter(
    prefix="/api/v1/video/jobs",
    tags=["video-jobs"],
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
logger = logging.getLogger(__name__)

# Strong references: without these the event loop may garbage-collect a pending
# task mid-render. Drained on shutdown so no renderer outlives its container.
_TASKS: set[asyncio.Task] = set()


def _owner(request: Request) -> str:
    """Hash the verified token subject, not the raw header (M21)."""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        payload = verify_access_token(token)
        if payload:
            subject = f"user:{payload.get('id')}"
            return hashlib.sha256(subject.encode("utf-8")).hexdigest()[:16]
        return hashlib.sha256(f"bearer:{token}".encode("utf-8")).hexdigest()[:16]
    key = request.headers.get("x-api-key") or ""
    if key:
        return hashlib.sha256(f"key:{key}".encode("utf-8")).hexdigest()[:16]
    host = request.client.host if request.client else "anonymous"
    return hashlib.sha256(f"host:{host}".encode("utf-8")).hexdigest()[:16]


@router.on_event("shutdown")
async def _drain_jobs() -> None:
    tasks = list(_TASKS)
    for task in tasks:
        if not task.done():
            task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def _materialize(job_id: str, uploads: Optional[UploadFile], prefix: str = "input") -> tuple[Path, Any]:
    work = TEMP_AUDIO_DIR / "video_jobs" / f"{job_id}_input"
    work.mkdir(parents=True, exist_ok=True)
    if uploads is None:
        return work, None
    name = Path(uploads.filename or "upload.bin").name
    dest = work / f"{prefix}_{name}"
    copy_upload_capped(uploads, dest)
    return work, (name, str(dest))


async def _materialize_clips(job_id: str, clips: List[UploadFile]) -> tuple[Path, list[tuple[str, str]]]:
    work = TEMP_AUDIO_DIR / "video_jobs" / f"{job_id}_input"
    work.mkdir(parents=True, exist_ok=True)
    specs: list[tuple[str, str]] = []
    for i, up in enumerate(clips):
        name = Path(up.filename or f"clip_{i}.mp4").name
        dest = work / f"clip_{i}_{name}"
        copy_upload_capped(up, dest)
        specs.append((name, str(dest)))
    return work, specs


def _open_upload(spec: tuple[str, str]):
    from fastapi import UploadFile

    return UploadFile(filename=spec[0], file=open(spec[1], "rb"))


def _run_render(kind: str, specs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    """Run the existing endpoint coroutine in a fresh event loop (worker thread)."""

    async def _call():
        handles: list[Any] = []
        try:
            clips = [_open_upload(s) for s in specs["clips"]]
            handles.extend(c.file for c in clips)
            audio = _open_upload(specs["audio"]) if specs.get("audio") else None
            if audio:
                handles.append(audio.file)
            overlay = _open_upload(specs["overlay"]) if specs.get("overlay") else None
            if overlay:
                handles.append(overlay.file)
            if kind == "process":
                return await process_video(clips=clips, audio=audio, overlay_image=overlay, **params)
            if kind == "batch":
                return await process_video_batch(clips=clips, audio=audio, **params)
            return await finalize_video(audio=audio, overlay_image=overlay, **params)
        finally:
            for handle in handles:
                try:
                    handle.close()
                except Exception:
                    pass

    return asyncio.run(_call())


async def _execute(job_id: str, kind: str, work: Path, specs: dict[str, Any], params: dict[str, Any]) -> None:
    store = get_video_job_store()
    job = store.get(job_id)
    if job is None:
        return

    def progress(stage: str, pct: float) -> None:
        store.update(job, stage=stage, progress=pct)

    token = set_job_context(JobContext(job.cancel_event, progress, kind=kind))
    started = time.perf_counter()
    try:
        if job.cancel_event.is_set():
            raise JobCancelled()
        store.update(job, status="running", stage="starting", progress=1)
        result = await asyncio.to_thread(_run_render, kind, specs, params)
        if job.cancel_event.is_set():
            raise JobCancelled()
        record("video.render", (time.perf_counter() - started) * 1000, kind=kind, status="ok")
        store.finish(job, status="succeeded", result=result)
    except JobCancelled:
        record("video.render", (time.perf_counter() - started) * 1000, kind=kind, status="cancelled")
        store.finish(job, status="cancelled", error="Cancelled")
    except BaseException as e:  # noqa: BLE001 - report any render failure in job status
        detail = getattr(e, "detail", None)
        message = detail if isinstance(detail, str) else str(e)
        status = getattr(e, "status_code", None)
        record("video.render", (time.perf_counter() - started) * 1000, kind=kind, status="error")
        store.finish(
            job,
            status="failed",
            error=message[-1000:],
            error_status=status if isinstance(status, int) else 500,
        )
    finally:
        reset_job_context(token)
        shutil.rmtree(work, ignore_errors=True)


def _validate_common(
    aspect_ratio: str,
    gap_count: int,
    transition: str,
    duration: float,
    transitions: str | None,
    lower_third: str | None = None,
    font_path: str | None = None,
) -> None:
    if aspect_ratio not in SAFE_ZONES:
        raise HTTPException(status_code=400, detail="Invalid aspect_ratio")
    _transition_settings(transition, duration, transitions, gap_count)
    _lower_third_or_400(lower_third)
    _font_path_or_400(font_path)


def _spawn(job_id: str, kind: str, work: Path, specs: dict[str, Any], params: dict[str, Any]) -> None:
    """Keep a strong task reference and discard it when done (H32)."""
    task = asyncio.create_task(_execute(job_id, kind, work, specs, params))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


async def _submit(
    request: Request,
    kind: str,
    prepare: Callable[[str], Awaitable[tuple[Path, dict[str, Any], dict[str, Any]]]],
    owner: str,
) -> JSONResponse:
    """Acquire a per-owner slot, create the job, materialize, spawn, and clean up (H34)."""
    store = get_video_job_store()
    ctx_token = bind_job_owner(owner)
    work: Path | None = None
    try:
        if not store.acquire_slot():
            raise HTTPException(status_code=429, detail="Another video render is already running")
        try:
            job = store.create(kind, owner)
            work, specs, params = await prepare(job.id)
            _spawn(job.id, kind, work, specs, params)
        except BaseException:
            store.release_slot()
            if work is not None:
                shutil.rmtree(work, ignore_errors=True)
            raise
    finally:
        clear_job_owner(ctx_token)
    return _accepted(job)


@router.get("/{job_id}")
def job_status(job_id: str, request: Request):
    job = get_video_job_store().get(job_id, _owner(request))
    if job is None:
        raise HTTPException(status_code=404, detail="Video job not found")
    return job.snapshot()


@router.delete("/{job_id}")
def cancel_job(job_id: str, request: Request):
    job = get_video_job_store().get(job_id, _owner(request))
    if job is None:
        raise HTTPException(status_code=404, detail="Video job not found")
    if not get_video_job_store().cancel(job):
        raise HTTPException(status_code=409, detail="Job already finished")
    return {"job_id": job_id, "status": "cancelled"}


@router.post("/process")
async def submit_process(
    request: Request,
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
    preview: bool = Form(False),
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
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe required for video processing")
    if not clips:
        raise HTTPException(status_code=400, detail="At least one video clip is required")
    _validate_common(
        aspect_ratio, len(clips) - 1, transition, transition_duration_sec,
        transitions, lower_third, font_path,
    )
    _sfx_settings(transition_sfx, transition_sfx_level)
    _overlay_settings(overlay_position, overlay_size, overlay_opacity)
    _effect_overlay(overlay)
    _text_style_or_400(caption_style)

    async def prepare(job_id: str):
        work, clip_specs = await _materialize_clips(job_id, clips)
        _, audio_spec = await _materialize(job_id, audio, prefix="audio")
        _, overlay_spec = await _materialize(job_id, overlay_image, prefix="overlay")
        if overlay_spec:
            # Validate the same way the sync endpoint does, before accepting the job.
            probe = _open_upload(overlay_spec)
            try:
                _save_overlay_upload(probe, work, job_id)
            finally:
                probe.file.close()
        params = dict(
            audio_r2_key=audio_r2_key,
            aspect_ratio=aspect_ratio,
            trim_end_sec=trim_end_sec,
            topic=topic,
            language=language,
            script_text=script_text,
            intro_delay_sec=intro_delay_sec,
            outro_sec=outro_sec,
            words_per_chunk=words_per_chunk,
            upscale_2k=upscale_2k,
            preview=preview,
            loudnorm=loudnorm,
            transition=transition,
            transition_duration_sec=transition_duration_sec,
            transitions=transitions,
            transition_sfx=transition_sfx,
            transition_sfx_level=transition_sfx_level,
            overlay_position=overlay_position,
            overlay_size=overlay_size,
            overlay_opacity=overlay_opacity,
            overlay=overlay,
            caption_style=caption_style,
            lower_third=lower_third,
            lower_third_duration_sec=lower_third_duration_sec,
            font_path=font_path,
        )
        return work, {"clips": clip_specs, "audio": audio_spec, "overlay": overlay_spec}, params

    return await _submit(request, "process", prepare, _owner(request))


@router.post("/process-batch")
async def submit_batch(
    request: Request,
    clips: List[UploadFile] = File(...),
    aspect_ratio: str = Form(DEFAULT_ASPECT_RATIO),
    trim_end_sec: float = Form(DEFAULT_TRIM_END_SEC),
    topic: str = Form("Untitled"),
    language: str = Form("en"),
    audio: Optional[UploadFile] = File(None),
    audio_r2_key: Optional[str] = Form(None),
    bpm: Optional[float] = Form(None),
    keep_audio: bool = Form(False),
    transition: str = Form(DEFAULT_TRANSITION),
    transition_duration_sec: float = Form(DEFAULT_TRANSITION_DURATION_SEC),
    transitions: Optional[str] = Form(None),
    overlay: str = Form(DEFAULT_EFFECT_OVERLAY),
    preview: bool = Form(False),
):
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe required for video processing")
    if not clips:
        raise HTTPException(status_code=400, detail="At least one video clip is required")
    _validate_common(aspect_ratio, len(clips) - 1, transition, transition_duration_sec, transitions)
    _effect_overlay(overlay)

    async def prepare(job_id: str):
        work, clip_specs = await _materialize_clips(job_id, clips)
        _, audio_spec = await _materialize(job_id, audio, prefix="audio")
        params = dict(
            aspect_ratio=aspect_ratio,
            trim_end_sec=trim_end_sec,
            topic=topic,
            language=language,
            audio_r2_key=audio_r2_key,
            bpm=bpm,
            keep_audio=keep_audio,
            transition=transition,
            transition_duration_sec=transition_duration_sec,
            transitions=transitions,
            overlay=overlay,
            preview=preview,
        )
        return work, {"clips": clip_specs, "audio": audio_spec, "overlay": None}, params

    return await _submit(request, "batch", prepare, _owner(request))


@router.post("/finalize")
async def submit_finalize(
    request: Request,
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
    preview: bool = Form(False),
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
    if not _media_tools_available():
        raise HTTPException(status_code=503, detail="FFmpeg/ffprobe required for video processing")
    # Audio is optional; without it the segments' own audio is preserved.
    # Shared parser: JSON array (keys may contain commas) with CSV fallback (H29).
    segments = _parse_segment_keys(video_r2_keys)
    if not segments:
        raise HTTPException(status_code=400, detail="At least one video segment is required")
    _validate_common(
        aspect_ratio, len(segments) - 1, transition, transition_duration_sec,
        transitions, lower_third, font_path,
    )
    _sfx_settings(transition_sfx, transition_sfx_level)
    _overlay_settings(overlay_position, overlay_size, overlay_opacity)
    _effect_overlay(overlay)
    _text_style_or_400(caption_style)

    async def prepare(job_id: str):
        work, _ = await _materialize_clips(job_id, [])
        _, audio_spec = await _materialize(job_id, audio, prefix="audio")
        _, overlay_spec = await _materialize(job_id, overlay_image, prefix="overlay")
        params = dict(
            video_r2_keys=video_r2_keys,
            audio_r2_key=audio_r2_key,
            aspect_ratio=aspect_ratio,
            topic=topic,
            language=language,
            script_text=script_text,
            intro_delay_sec=intro_delay_sec,
            outro_sec=outro_sec,
            words_per_chunk=words_per_chunk,
            upscale_2k=upscale_2k,
            preview=preview,
            loudnorm=loudnorm,
            transition=transition,
            transition_duration_sec=transition_duration_sec,
            transitions=transitions,
            transition_sfx=transition_sfx,
            transition_sfx_level=transition_sfx_level,
            overlay_position=overlay_position,
            overlay_size=overlay_size,
            overlay_opacity=overlay_opacity,
            overlay=overlay,
            caption_style=caption_style,
            lower_third=lower_third,
            lower_third_duration_sec=lower_third_duration_sec,
            font_path=font_path,
        )
        return work, {"clips": [], "audio": audio_spec, "overlay": overlay_spec}, params

    return await _submit(request, "finalize", prepare, _owner(request))


def _accepted(job) -> JSONResponse:
    return JSONResponse(
        status_code=202,
        content={
            "job_id": job.id,
            "status": "queued",
            "status_url": f"/api/v1/video/jobs/{job.id}",
        },
    )
