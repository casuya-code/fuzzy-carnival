import asyncio
import hashlib
import logging
import os
import re
import subprocess
import sys
import time
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.config import (
    AZURE_SPEECH_KEY,
    DENOISE_REFERENCE,
    ELEVENLABS_API_KEY,
    ELEVENLABS_ENABLE_CLONING,
    REF_CACHE_MAX_AGE_HOURS,
    REF_CACHE_MAX_FILES,
    TEMP_AUDIO_DIR,
)
from app.engines.azure_swahili import AzureQuotaExceededError
from app.engines.elevenlabs import (
    ElevenLabsCloningUnavailableError,
    ElevenLabsQuotaExceededError,
)
from app.engines.msingi_sauti import MsingiReferenceRequiredError
from app.schemas.tts import SynthesizeRequest, SynthesizeResponse
from app.services.audio_processor import (
    _ffmpeg_available,
    get_duration,
    normalize_reference,
    to_mp3,
    validate_reference,
)
from app.services.model_manager import CLOUD_ENGINES, ModelManager
from app.services.naming_utils import build_speech_r2_key
from app.services.r2_storage import (
    download_reference,
    local_output_path,
    object_exists,
    public_url,
    upload_output,
)
from app.services.text_normalizer import normalize_text
from app.services.timeline_service import estimate_timeline
from app.auth import require_api_key
from app.rate_limit import rate_limit
from app.observability import record, timed

router = APIRouter(prefix="/api/v1", tags=["synthesize"], dependencies=[Depends(require_api_key), Depends(rate_limit)])
logger = logging.getLogger(__name__)

# Prevent concurrent heavy synthesis jobs from piling up after client cancel/retry.
_synthesize_lock = threading.Lock()


def is_synthesis_busy() -> bool:
    return _synthesize_lock.locked()


def _check_cancel(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise HTTPException(status_code=499, detail="Speech creation cancelled")

# Singleton model manager
_manager: ModelManager | None = None
_manager_lock = threading.Lock()

# LRU cache for identical requests (text, language, engine, voice key).
# Only keys + engine metadata are cached; URLs are re-signed on every hit.
_result_cache: OrderedDict = OrderedDict()
_CACHE_MAX = 32
_cache_lock = threading.Lock()

# Per-voice-key locks prevent duplicate downloads of the same reference.
# Normalized files are keyed by the SHA-256 of the downloaded bytes, never by
# the R2 key alone, so an overwritten key cannot reuse stale audio (H19).
_ref_cache_lock = threading.Lock()
_ref_key_locks: dict[str, threading.Lock] = {}
_REFS_DIR = TEMP_AUDIO_DIR / "refs_cache"
_REFS_DIR.mkdir(parents=True, exist_ok=True)


def _cleanup_ref_cache() -> None:
    try:
        now = time.time()
        max_age = REF_CACHE_MAX_AGE_HOURS * 3600
        files = [p for p in _REFS_DIR.glob("*") if p.is_file()]
        for p in files:
            try:
                if now - p.stat().st_mtime > max_age:
                    p.unlink(missing_ok=True)
            except Exception:
                pass
        files = [p for p in _REFS_DIR.glob("*") if p.is_file()]
        if len(files) <= REF_CACHE_MAX_FILES:
            return
        files.sort(key=lambda p: p.stat().st_mtime)
        for p in files[: max(0, len(files) - REF_CACHE_MAX_FILES)]:
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass
    except Exception as e:
        logger.debug("Ref cache cleanup failed: %s", e)

CLONING_ENGINES = {"kyutai", "afrispeech", "msingi"}


def _uses_reference_sample(engine_name: str) -> bool:
    return engine_name in CLONING_ENGINES or (engine_name == "elevenlabs" and ELEVENLABS_ENABLE_CLONING)


def get_manager() -> ModelManager:
    global _manager
    if _manager is None:  # fast path: no lock contention once initialized
        with _manager_lock:
            if _manager is None:
                _manager = ModelManager()
    return _manager


# Pause length (ms) by the punctuation that ends each segment. This is what
# makes delivery feel human: a breath after a sentence, a small catch after a
# comma, and a real beat between paragraphs.
_PAUSE_BY_END = {
    ".": 480,
    "!": 500,
    "?": 560,
    ",": 180,
    ";": 240,
    ":": 260,
}


def _split_with_pauses(text: str, max_len: int = 400) -> tuple[list[str], list[int]]:
    """Split text into segments and pair each boundary with a pause length.

    Returns (segments, gaps_ms) where len(gaps_ms) == len(segments) - 1.

    Segments break at sentence punctuation first, then at clause punctuation
    (commas/semicolons/colons) when a segment would otherwise grow too long,
    so the reader never sprints through a 60-word sentence.
    """
    # Keep the punctuation attached to the segment it terminates.
    pieces = re.findall(r"[^.!?]*[.!?]+|[^.!?]+$", text)
    segments: list[str] = []
    for piece in pieces:
        piece = piece.strip()
        if not piece:
            continue
        # Break long clauses at commas so short pauses can be inserted.
        if len(piece) > max_len:
            clauses = re.split(r"(?<=[,;:])\s+", piece)
            cur = ""
            for cl in clauses:
                if cur and len(cur) + len(cl) + 1 > max_len:
                    segments.append(cur)
                    cur = cl
                else:
                    cur = f"{cur} {cl}".strip() if cur else cl
            if cur:
                segments.append(cur)
        else:
            segments.append(piece)

    if len(segments) <= 1:
        return segments, []

    gaps: list[int] = []
    for seg in segments[:-1]:
        last = seg.rstrip()[-1] if seg.rstrip() else ""
        # Paragraph break (double newline preserved in source) = long beat.
        gaps.append(_PAUSE_BY_END.get(last, 480))
    # Grow an over-long segment list is already bounded; nothing else to do.
    return segments, gaps


def _run_ffmpeg_cancellable(cmd: list[str], cancel_event: threading.Event | None) -> None:
    """Run ffmpeg with periodic cancellation checks; kill the child on cancel."""
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        while proc.poll() is None:
            _check_cancel(cancel_event)
            try:
                proc.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                continue
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg stitching failed (exit {proc.returncode})")
    except BaseException:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        raise


def _stitch_crossfade_cancellable(
    chunks: list[str], out_path: str, pause_ms: int, cancel_event: threading.Event | None
) -> str:
    """FFmpeg acrossfade stitching (same filter as audio_processor) with cancel support."""
    inputs: list[str] = []
    filters: list[str] = []
    for idx, chunk in enumerate(chunks):
        inputs.extend(["-i", chunk])
        if idx < len(chunks) - 1:
            filters.append(f"[{idx}:a]aresample=24000,apad=pad_dur={pause_ms / 1000.0}[a{idx}];")
        else:
            filters.append(f"[{idx}:a]aresample=24000[a{idx}];")
    prev = "a0"
    for idx in range(1, len(chunks)):
        label = f"m{idx}" if idx < len(chunks) - 1 else "out"
        filters.append(f"[{prev}][a{idx}]acrossfade=d=0.020:c1=tri:c2=tri[{label}];")
        prev = label
    cmd = [
        "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
        *inputs,
        "-filter_complex", "".join(filters).rstrip(";"),
        "-map", "[out]",
        "-c:a", "libmp3lame", "-b:a", "128k",
        out_path,
    ]
    _run_ffmpeg_cancellable(cmd, cancel_event)
    return out_path


def _synthesize_chunked(
    engine,
    text: str,
    ref_path,
    out_path: str,
    job_id: str,
    pause_ms: int = 220,
    crossfade: bool = True,
    speaking_rate: float | None = None,
    cancel_event: threading.Event | None = None,
) -> str:
    """Synthesize long text sentence-by-sentence and concatenate (XTTS/MMS stability)."""
    chunks, gaps = _split_with_pauses(text)
    if len(chunks) == 1:
        return engine.synthesize(
            text=text, reference_audio_path=ref_path, output_path=out_path, speaking_rate=speaking_rate
        )

    if crossfade and not _ffmpeg_available():
        raise HTTPException(
            status_code=503,
            detail="Chunked synthesis requires ffmpeg for crossfade stitching",
        )

    # Honor the caller's output path; only the container changes to match bytes.
    out = Path(out_path)
    final_path = str(out.with_suffix(".mp3" if crossfade else ".wav"))

    tmp_files = []
    try:
        for i, chunk in enumerate(chunks):
            _check_cancel(cancel_event)
            tmp = str(TEMP_AUDIO_DIR / f"chunk_{job_id}_{i}.wav")
            engine.synthesize(
                text=chunk, reference_audio_path=ref_path, output_path=tmp, speaking_rate=speaking_rate
            )
            tmp_files.append(tmp)

        _check_cancel(cancel_event)
        if crossfade:
            return _stitch_crossfade_cancellable(tmp_files, final_path, pause_ms, cancel_event)

        # Pause-based stitching (for engines like MMS that lack natural breaths).
        # gaps_ms makes silence follow punctuation: a breath after a sentence,
        # a short catch after a comma.
        from app.services.audio_processor import stitch_audio_with_pauses

        produced = stitch_audio_with_pauses(tmp_files, final_path, pause_ms=pause_ms, gaps_ms=gaps)
        _check_cancel(cancel_event)
        return produced
    finally:
        for tmp in tmp_files:
            Path(tmp).unlink(missing_ok=True)


def _cached_response_url(cached: SynthesizeResponse) -> SynthesizeResponse:
    """Re-sign the URL on every cache hit so presigned links never go stale."""
    try:
        return cached.model_copy(update={"audio_url": public_url(cached.audio_r2_key)})
    except Exception:
        # Never hand out a stale URL; the caller evicts this entry and retries.
        # Do not log object keys or generated URLs.
        logger.warning("Could not refresh cached audio URL")
        raise


def _cached_output_available(cached: SynthesizeResponse) -> bool:
    """Validate the cached output; called outside the global cache lock (H21).

    r2_storage.object_exists() performs a real HEAD even with R2_PUBLIC_URL set
    (H22), so deleted outputs are evicted instead of yielding 404 URLs.
    """
    local = local_output_path(cached.audio_r2_key)
    if "/static/" in cached.audio_url:
        return bool(local is not None and local.exists())
    return object_exists(cached.audio_r2_key)


def _drop_cached_result(cache_key: tuple, cached: SynthesizeResponse) -> None:
    with _cache_lock:
        if _result_cache.get(cache_key) is cached:
            _result_cache.pop(cache_key, None)


def _lookup_cached_result(cache_key: tuple, *, skip_cache: bool) -> SynthesizeResponse | None:
    if skip_cache:
        return None
    # Hold the global lock only for the in-memory lookup/eviction. S3 HEAD and
    # URL signing are network/crypto work and must happen outside it (H21).
    with _cache_lock:
        if cache_key not in _result_cache:
            return None
        cached = _result_cache[cache_key]
        _result_cache.move_to_end(cache_key)
    try:
        if not _cached_output_available(cached):
            _drop_cached_result(cache_key, cached)
            return None
        return _cached_response_url(cached)
    except Exception:
        # URL signing/object missing: drop the entry and regenerate below.
        _drop_cached_result(cache_key, cached)
        return None


def _resolve_engine(engine_name: str, language: str) -> str:
    if language == "en":
        if engine_name in ("msingi", "mms", "azure"):
            return "kyutai"
        return engine_name
    # sw
    if engine_name in ("kyutai", "afrispeech"):
        return "azure"
    return engine_name


def _remap_warning(requested: str, effective: str, language: str) -> str | None:
    """Make the deliberate language remap visible without rejecting the request."""
    if requested == effective:
        return None
    lang_name = "English" if language == "en" else "Swahili"
    return f"Requested engine '{requested}' was remapped to '{effective}' for {lang_name}."


def _join_warnings(existing: str | None, new: str | None) -> str | None:
    if not new:
        return existing
    return f"{existing} {new}".strip() if existing else new


_PACE_SUPPORTED_ENGINES = {"mms", "azure"}


def _request_warnings(
    req: SynthesizeRequest, requested: str, effective: str
) -> str | None:
    """Warnings derivable purely from the request and the effective engine.

    These are recomputed on every cache hit instead of being persisted with the
    cached response (H23).
    """
    warning = _remap_warning(requested, effective, req.language)
    pace = req.speaking_rate
    if (
        pace is not None
        and abs(float(pace) - 1.0) > 0.01
        and effective not in _PACE_SUPPORTED_ENGINES
    ):
        warning = _join_warnings(
            warning,
            f"Speaking pace was requested ({float(pace):.2f}x), but the '{effective}' engine "
            "keeps its natural pace. Pace control currently applies to Azure and Basic Swahili (MMS).",
        )
    return warning


def _cached_with_warnings(
    cached: SynthesizeResponse,
    req: SynthesizeRequest,
    requested: str,
    effective: str,
    extra: str | None = None,
) -> SynthesizeResponse:
    warning = _join_warnings(extra, _request_warnings(req, requested, effective))
    if warning == cached.warning:
        return cached
    return cached.model_copy(update={"warning": warning})


def _cloud_configured(engine_name: str) -> bool:
    """Cloud engines load no weights, so a missing credential must be checked here."""
    if engine_name == "azure":
        return bool(AZURE_SPEECH_KEY)
    if engine_name == "elevenlabs":
        return bool(ELEVENLABS_API_KEY)
    return True


def _fallback_engine(language: str) -> str:
    """Swahili falls back to MMS; English falls back to the local default clone engine."""
    return "mms" if language == "sw" else "kyutai"


_FALLBACK_CANDIDATES = {
    "sw": ("mms", "afrispeech", "msingi"),
    "en": ("kyutai", "afrispeech", "mms", "msingi"),
}


def _enabled_fallbacks(language: str, manager: ModelManager, exclude: str | None = None) -> list[str]:
    """Ordered local fallbacks that are actually enabled in this deployment (H15)."""
    preferred = _fallback_engine(language)
    names = [preferred, *_FALLBACK_CANDIDATES.get(language, ())]
    return [
        name
        for name in dict.fromkeys(names)
        if name != exclude and name not in CLOUD_ENGINES and name in manager.engines
    ]


def _load_fallback(
    language: str, manager: ModelManager, exclude: str | None = None
) -> tuple[str | None, object | None, list[str]]:
    """Load the first usable enabled fallback; report why candidates failed."""
    errors: list[str] = []
    for name in _enabled_fallbacks(language, manager, exclude):
        try:
            return name, manager.get(name), errors
        except Exception as e:
            errors.append(f"{name}: {type(e).__name__}")
    return None, None, errors


def _make_cache_key(engine_name: str, req: SynthesizeRequest, text: str) -> tuple:
    """Cache identity must include every setting that changes the delivered take."""
    denoise = req.denoise_ref if req.denoise_ref is not None else DENOISE_REFERENCE
    return (
        engine_name,
        req.language,
        text,
        req.voice_r2_key or "",
        req.speaking_rate or 1.0,
        denoise,
        req.topic or "Untitled",
    )


def _ref_lock(cache_lookup_key: str) -> threading.Lock:
    with _ref_cache_lock:
        lock = _ref_key_locks.get(cache_lookup_key)
        if lock is None:
            lock = threading.Lock()
            _ref_key_locks[cache_lookup_key] = lock
        return lock


def _prepare_reference(req: SynthesizeRequest, engine_name: str):
    if not req.voice_r2_key or not _uses_reference_sample(engine_name):
        return None
    try:
        denoise = req.denoise_ref if req.denoise_ref is not None else DENOISE_REFERENCE
        key_hash = hashlib.md5(req.voice_r2_key.encode()).hexdigest()
        cache_lookup_key = f"{req.voice_r2_key}|{'dn' if denoise else 'raw'}"

        def _use_cached(path: str) -> str | None:
            p = Path(path)
            if not p.exists() or p.stat().st_size <= 0:
                return None
            try:
                validate_reference(str(p))
            except Exception:
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass
                return None
            return str(p)

        # No cache fast path keyed by R2 key: the object may have been replaced.
        # Always download and hash the current bytes before reusing a normalized
        # reference (H19). The per-key lock avoids duplicate concurrent downloads.
        lock = _ref_lock(cache_lookup_key)
        with lock:
            suffix = Path(req.voice_r2_key).suffix or ".audio"
            src_tmp = _REFS_DIR / f"{key_hash}_{uuid.uuid4().hex[:8]}_src{suffix}"
            downloaded = download_reference(req.voice_r2_key, dest=src_tmp)
            norm_tmp: Path | None = None
            try:
                # Content-hash identity prevents stale reuse when same R2 key is overwritten.
                h = hashlib.sha256()
                with Path(downloaded).open("rb") as f:
                    for chunk in iter(lambda: f.read(1024 * 1024), b""):
                        h.update(chunk)
                cache_tag = f"{h.hexdigest()}_{'dn' if denoise else 'raw'}"
                cached_norm = str(_REFS_DIR / f"{cache_tag}.wav")
                existing = _use_cached(cached_norm)
                if existing:
                    return existing

                norm_tmp = _REFS_DIR / f"{cache_tag}.{uuid.uuid4().hex[:8]}.tmp.wav"
                normalize_reference(downloaded, str(norm_tmp), denoise=denoise)
                validate_reference(str(norm_tmp))  # reject too-short / silent clips
                os.replace(str(norm_tmp), cached_norm)
                _cleanup_ref_cache()
                return cached_norm
            finally:
                Path(downloaded).unlink(missing_ok=True)
                if norm_tmp is not None:
                    try:
                        norm_tmp.unlink(missing_ok=True)
                    except Exception:
                        pass
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Reference audio error: {e}")


def _run_synthesis(
    engine,
    engine_name: str,
    text: str,
    language: str,
    ref_path,
    raw_out: str,
    job_id: str,
    speaking_rate: float | None = None,
    cancel_event: threading.Event | None = None,
) -> str:
    _check_cancel(cancel_event)
    # Azure/ElevenLabs: single cloud call (text already normalized; length <= 2000)
    if engine_name == "azure":
        return engine.synthesize_for_language(
            text=text, language=language, output_path=raw_out, speaking_rate=speaking_rate
        )
    if engine_name == "elevenlabs":
        return engine.synthesize(text=text, reference_audio_path=ref_path, output_path=raw_out)

    if engine_name == "msingi" and len(text) > 400:
        return _synthesize_chunked(
            engine, text, ref_path, raw_out, job_id, pause_ms=220, crossfade=True, speaking_rate=speaking_rate, cancel_event=cancel_event
        )
    if engine_name == "mms" and (len(_split_with_pauses(text)[0]) > 1 or len(text) > 120):
        return _synthesize_chunked(
            engine, text, ref_path, raw_out, job_id, pause_ms=400, crossfade=False, speaking_rate=speaking_rate, cancel_event=cancel_event
        )
    return engine.synthesize(
        text=text, reference_audio_path=ref_path, output_path=raw_out, speaking_rate=speaking_rate
    )


def _synthesize_sync(req: SynthesizeRequest, request: Request | None = None, cancel_event: threading.Event | None = None, lock_already_held: bool = False):
    started = time.perf_counter()
    requested_engine_name = req.engine
    cache_hit = False
    effective_engine = req.engine
    acquired_here = False
    if not lock_already_held:
        if not _synthesize_lock.acquire(blocking=False):
            raise HTTPException(
                status_code=429,
                detail="Another speech request is still running. Please wait for it to finish before starting a new one.",
            )
        acquired_here = True
    try:
        _check_cancel(cancel_event)
        manager = get_manager()

        # Normalize text
        text = normalize_text(req.text, req.language)
        if not text.strip():
            raise HTTPException(status_code=400, detail="Text is empty after normalization")

        # Resolve engine (validate against language)
        requested_engine = req.engine
        engine_name = _resolve_engine(requested_engine, req.language)
        fallback_warning: str | None = None
        warning = _request_warnings(req, requested_engine, engine_name)

        # Cache lookup for identical requests (by effective engine and all take-affecting settings)
        cache_key = _make_cache_key(engine_name, req, text)
        cached_hit = _lookup_cached_result(cache_key, skip_cache=req.skip_cache)
        if cached_hit is not None:
            cache_hit = True
            effective_engine = engine_name
            return _cached_with_warnings(cached_hit, req, requested_engine, engine_name)

        # Prepare reference audio (cached by voice key) for local cloning engines only
        with timed("tts.stage.reference", engine=engine_name):
            ref_path = _prepare_reference(req, engine_name)

        job_id = uuid.uuid4().hex
        raw_out = str(TEMP_AUDIO_DIR / f"out_{job_id}.wav")
        raw_out_fb: str | None = None
        mp3_out: str | None = None
        produced: str | None = None
        # Availability check. Cloud engines load no weights, so also verify credentials.
        availability_error: Exception | None = None
        if engine_name in CLOUD_ENGINES and not _cloud_configured(engine_name):
            availability_error = RuntimeError(f"{engine_name} is not configured")
        if availability_error is None:
            try:
                with timed("tts.engine_get", engine=engine_name, phase="primary"):
                    engine = manager.get(engine_name)
            except Exception as e:
                availability_error = e

        if availability_error is not None:
            if engine_name not in CLOUD_ENGINES:
                raise HTTPException(
                    status_code=503, detail=f"Engine unavailable: {availability_error}"
                ) from availability_error
            fallback_name, engine, errors = _load_fallback(req.language, manager, exclude=engine_name)
            if fallback_name is None:
                detail = f"{engine_name} unavailable: no fallback engine is available"
                if errors:
                    detail += f" ({'; '.join(errors)})"
                raise HTTPException(status_code=503, detail=detail) from availability_error
            fallback_warning = f"{engine_name} unavailable. Fell back to '{fallback_name}'."
            engine_name = fallback_name
            warning = _join_warnings(
                _request_warnings(req, requested_engine, engine_name), fallback_warning
            )
            ref_path = None

        # If we fell back at availability time, update cache key context to effective engine
        cache_key = _make_cache_key(engine_name, req, text)
        cached_hit = _lookup_cached_result(cache_key, skip_cache=req.skip_cache)
        if cached_hit is not None:
            cache_hit = True
            effective_engine = engine_name
            return _cached_with_warnings(
                cached_hit, req, requested_engine, engine_name, fallback_warning
            )

        effective_engine = engine_name
        try:
            with timed("tts.synthesize", engine=engine_name, language=req.language, chars=len(text)):
                produced = _run_synthesis(
                    engine, engine_name, text, req.language, ref_path, raw_out, job_id, speaking_rate=req.speaking_rate, cancel_event=cancel_event
                )
            engine_warning = getattr(engine, "last_warning", None)
            if engine_warning:
                warning = _join_warnings(warning, engine_warning)
        except ElevenLabsCloningUnavailableError as e:
            # Account/plan does not support IVC: fall back to preset ElevenLabs voice.
            if requested_engine == "elevenlabs":
                warning = _join_warnings(
                    warning,
                    "ElevenLabs voice cloning is not available on your current plan. "
                    "Generated with the preset ElevenLabs voice instead.",
                )
                with timed("tts.synthesize", engine="elevenlabs", language=req.language, chars=len(text), phase="ivc-fallback"):
                    produced = _run_synthesis(
                        engine, "elevenlabs", text, req.language, None, raw_out, job_id, speaking_rate=req.speaking_rate, cancel_event=cancel_event
                    )
            else:
                raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")
        except MsingiReferenceRequiredError as e:
            # Missing user input, not a server fault.
            raise HTTPException(status_code=400, detail=str(e)) from e
        except (AzureQuotaExceededError, ElevenLabsQuotaExceededError) as e:
            # Required smart quota fallback: cloud -> local engine for this language.
            fallback_name, fallback_engine, errors = _load_fallback(
                req.language, manager, exclude=engine_name
            )
            if fallback_name is None:
                detail = "Cloud quota exceeded: no fallback engine is available"
                if errors:
                    detail += f" ({'; '.join(errors)})"
                raise HTTPException(status_code=503, detail=detail) from e
            reason = (
                "Azure quota exceeded (HTTP 429)"
                if isinstance(e, AzureQuotaExceededError)
                else "ElevenLabs quota/rate limit reached"
            )
            fallback_warning = f"{reason}. Fell back to '{fallback_name}' for this request."
            engine_name = fallback_name
            warning = _join_warnings(
                _request_warnings(req, requested_engine, engine_name), fallback_warning
            )
            ref_path = None
            cache_key = _make_cache_key(engine_name, req, text)
            cached_hit = _lookup_cached_result(cache_key, skip_cache=req.skip_cache)
            if cached_hit is not None:
                cache_hit = True
                effective_engine = engine_name
                return _cached_with_warnings(
                    cached_hit, req, requested_engine, engine_name, fallback_warning
                )
            # Re-run with fallback (new output path)
            raw_out_fb = str(TEMP_AUDIO_DIR / f"out_{job_id}_fb.wav")
            try:
                with timed("tts.synthesize", engine=fallback_name, language=req.language, chars=len(text), phase="quota-fallback"):
                    produced = _run_synthesis(
                        fallback_engine,
                        fallback_name,
                        text,
                        req.language,
                        None,
                        raw_out_fb,
                        job_id + "_fb",
                        speaking_rate=req.speaking_rate,
                        cancel_event=cancel_event,
                    )
                raw_out = raw_out_fb
            except Exception as fallback_error:
                raise HTTPException(
                    status_code=500, detail=f"'{fallback_name}' fallback synthesis failed: {fallback_error}"
                ) from fallback_error
        except Exception as e:
            # Optional resilience: transient cloud errors are not silently falling back except quota.
            raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}") from e

        with timed("tts.stage.encode", engine=engine_name):
            if produced.endswith(".mp3"):
                # Already delivered as mp3 (e.g. cloud engine or crossfaded chunks) — skip re-encode.
                mp3_out = produced
            elif _ffmpeg_available():
                candidate = str(TEMP_AUDIO_DIR / f"out_{job_id}.mp3")
                try:
                    mp3_out = to_mp3(produced, candidate)
                except Exception as e:
                    logger.warning("MP3 encoding failed for %s: %s; keeping original container", produced, e)
                    warning = _join_warnings(warning, "MP3 encoding unavailable; delivered original WAV audio.")
                    mp3_out = produced
            else:
                # No ffmpeg locally: keep original container (wav)
                warning = _join_warnings(warning, "MP3 encoding unavailable; delivered WAV audio.")
                mp3_out = produced

        _check_cancel(cancel_event)
        ext = "mp3" if mp3_out.endswith(".mp3") else "wav"
        r2_key = build_speech_r2_key(
            engine_name, req.language, req.topic or "Untitled", ext
        )
        with timed("tts.stage.upload", engine=engine_name):
            try:
                url = upload_output(mp3_out, r2_key)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"R2 upload failed: {e}")

        with timed("tts.stage.timeline", engine=engine_name):
            duration_seconds = get_duration(mp3_out)

        # Build speech timeline: prefer provider timestamps (ElevenLabs), else robust estimate.
        timeline = None
        timeline_source = None
        try:
            if engine_name == "elevenlabs":
                get_tl = getattr(engine, "get_last_timeline", None)
                if callable(get_tl):
                    tl, src = get_tl()
                    if tl:
                        timeline = tl
                        timeline_source = src or "provider"
        except Exception as e:
            logger.warning("Provider timeline extraction failed: %s", e, exc_info=True)
            timeline = None
            timeline_source = None

        if not timeline:
            try:
                est = estimate_timeline(text, duration_seconds)
                if est:
                    timeline = est
                    timeline_source = "estimated"
            except Exception as e:
                logger.warning("Timeline estimation failed: %s", e, exc_info=True)
                timeline = None
                timeline_source = "unavailable"
        elif not timeline_source:
            timeline_source = "provider"

        if not timeline:
            timeline_source = "unavailable"

        result = SynthesizeResponse(
            audio_r2_key=r2_key,
            audio_url=url,
            engine_used=engine_name,
            duration_seconds=duration_seconds,
            warning=warning,
            timeline=timeline,
            timeline_source=timeline_source,
            source_text=text,
        )

        # Cache only request-derivable warnings; engine-specific notices stay on
        # this response. Cache hits recompute the request warnings (H23).
        stored_warning = _join_warnings(
            fallback_warning, _request_warnings(req, requested_engine, engine_name)
        )
        cache_store = result.model_copy(update={"warning": stored_warning})
        cache_key_store = _make_cache_key(engine_name, req, text)
        with _cache_lock:
            _result_cache[cache_key_store] = cache_store
            while len(_result_cache) > _CACHE_MAX:
                _result_cache.popitem(last=False)

        return result
    finally:
        # Output was uploaded; keep cached references, drop per-job scratch files.
        for p in {raw_out, raw_out_fb, mp3_out, produced}:
            if not p:
                continue
            try:
                pp = Path(p)
                if pp.exists() and TEMP_AUDIO_DIR.resolve() in pp.resolve().parents:
                    pp.unlink(missing_ok=True)
            except Exception:
                pass
        exc = sys.exc_info()[0]
        record(
            "tts.request_total",
            (time.perf_counter() - started) * 1000,
            engine=effective_engine,
            requested_engine=requested_engine_name,
            language=req.language,
            cache_hit=cache_hit,
            status="error" if exc else "ok",
            error_type=exc.__name__ if exc else None,
        )
        if acquired_here:
            _synthesize_lock.release()


@router.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize(req: SynthesizeRequest, request: Request):
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="Speech creation cancelled")
    cancel_event = threading.Event()

    async def _monitor_disconnect() -> None:
        try:
            while not cancel_event.is_set():
                if await request.is_disconnected():
                    cancel_event.set()
                    return
                await asyncio.sleep(0.5)
        except Exception:
            return

    from app.services.synthesis_worker import get_synthesis_worker

    if not _synthesize_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="Another speech request is still running. Please wait for it to finish before starting a new one.",
        )
    monitor = asyncio.create_task(_monitor_disconnect())
    try:
        # All synthesis (including cloud -> local fallback) runs in the worker so
        # cancellation can terminate it and local weights stay out of the API
        # process (H14).
        worker = get_synthesis_worker()
        result = await run_in_threadpool(
            worker.submit,
            req.model_dump(),
            cancel_event=cancel_event,
        )
        if result.ok:
            return SynthesizeResponse.model_validate(result.value)
        if result.error_type == "Cancelled":
            raise HTTPException(status_code=499, detail="Speech creation cancelled")
        if result.error_status:
            raise HTTPException(status_code=result.error_status, detail=result.error_message or "Synthesis failed")
        raise HTTPException(status_code=500, detail=result.error_message or "Synthesis failed")
    finally:
        cancel_event.set()
        monitor.cancel()
        try:
            await monitor
        except (asyncio.CancelledError, Exception):
            pass
        try:
            _synthesize_lock.release()
        except RuntimeError:
            pass
