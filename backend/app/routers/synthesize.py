import hashlib
import re
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import DENOISE_REFERENCE, ELEVENLABS_ENABLE_CLONING, TEMP_AUDIO_DIR
from app.engines.azure_swahili import AzureQuotaExceededError
from app.engines.elevenlabs import ElevenLabsCloningUnavailableError
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
from app.services.r2_storage import download_reference, public_url, upload_output
from app.services.text_normalizer import normalize_text
from app.services.timeline_service import estimate_timeline

router = APIRouter(prefix="/api/v1", tags=["synthesize"])

# Singleton model manager
_manager: ModelManager | None = None

# LRU cache for identical requests (text, language, engine, voice key).
# Only keys + engine metadata are cached; URLs are re-signed on every hit.
_result_cache: OrderedDict = OrderedDict()
_CACHE_MAX = 32
_cache_lock = threading.Lock()

# Cache normalized+validated reference files by voice key (avoids re-download/re-normalize)
_ref_cache: dict[str, str] = {}
_ref_cache_lock = threading.Lock()
_REFS_DIR = TEMP_AUDIO_DIR / "refs_cache"
_REFS_DIR.mkdir(parents=True, exist_ok=True)

CLONING_ENGINES = {"kyutai", "afrispeech", "msingi"}


def _uses_reference_sample(engine_name: str) -> bool:
    return engine_name in CLONING_ENGINES or (engine_name == "elevenlabs" and ELEVENLABS_ENABLE_CLONING)


def get_manager() -> ModelManager:
    global _manager
    if _manager is None:
        _manager = ModelManager()
    return _manager


def _split_sentences(text: str, max_len: int = 400) -> list[str]:
    """Split into sentence-aligned chunks so long text doesn't drift."""
    parts = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    cur = ""
    for p in parts:
        if cur and len(cur) + len(p) + 1 > max_len:
            chunks.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip() if cur else p
    if cur:
        chunks.append(cur)
    return chunks


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


def _synthesize_chunked(
    engine,
    text: str,
    ref_path,
    out_path: str,
    job_id: str,
    pause_ms: int = 220,
    crossfade: bool = True,
    speaking_rate: float | None = None,
) -> str:
    """Synthesize long text sentence-by-sentence and concatenate (XTTS/MMS stability)."""
    chunks, gaps = _split_with_pauses(text)
    if len(chunks) == 1:
        return engine.synthesize(
            text=text, reference_audio_path=ref_path, output_path=out_path, speaking_rate=speaking_rate
        )

    tmp_files = []
    try:
        for i, chunk in enumerate(chunks):
            tmp = str(TEMP_AUDIO_DIR / f"chunk_{job_id}_{i}.wav")
            engine.synthesize(
                text=chunk, reference_audio_path=ref_path, output_path=tmp, speaking_rate=speaking_rate
            )
            tmp_files.append(tmp)

        if crossfade:
            stitched = str(TEMP_AUDIO_DIR / f"out_{job_id}.mp3")
            from app.services.audio_processor import stitch_voice_with_crossfades

            produced = stitch_voice_with_crossfades(tmp_files, stitched, pause_ms=pause_ms, crossfade_sec=0.020)
            return produced
        # Pause-based stitching (for engines like MMS that lack natural breaths).
        # gaps_ms makes silence follow punctuation: a breath after a sentence,
        # a short catch after a comma.
        stitched = str(TEMP_AUDIO_DIR / f"out_{job_id}.wav")
        from app.services.audio_processor import stitch_audio_with_pauses

        produced = stitch_audio_with_pauses(tmp_files, stitched, pause_ms=pause_ms, gaps_ms=gaps)
        return produced
    finally:
        for tmp in tmp_files:
            Path(tmp).unlink(missing_ok=True)


def _cached_response_url(cached: SynthesizeResponse) -> SynthesizeResponse:
    """Re-sign the URL on every cache hit so presigned links never go stale."""
    try:
        return cached.model_copy(update={"audio_url": public_url(cached.audio_r2_key)})
    except Exception:
        return cached


def _resolve_engine(engine_name: str, language: str) -> str:
    if language == "en":
        if engine_name in ("msingi", "mms", "azure"):
            return "kyutai"
        return engine_name
    # sw
    if engine_name in ("kyutai", "afrispeech"):
        return "azure"
    return engine_name


def _prepare_reference(req: SynthesizeRequest, engine_name: str):
    if not req.voice_r2_key or not _uses_reference_sample(engine_name):
        return None
    try:
        denoise = req.denoise_ref if req.denoise_ref is not None else DENOISE_REFERENCE
        key_hash = hashlib.md5(req.voice_r2_key.encode()).hexdigest()
        cache_tag = f"{key_hash}_v3_{'dn' if denoise else 'raw'}"
        cached_norm = str(_REFS_DIR / f"{cache_tag}.wav")
        cache_lookup_key = f"{req.voice_r2_key}|{cache_tag}"

        with _ref_cache_lock:
            if cache_lookup_key in _ref_cache and Path(_ref_cache[cache_lookup_key]).exists():
                return _ref_cache[cache_lookup_key]
            if Path(cached_norm).exists():
                _ref_cache[cache_lookup_key] = cached_norm
                return cached_norm

        suffix = Path(req.voice_r2_key).suffix or ".audio"
        downloaded = download_reference(req.voice_r2_key, dest=_REFS_DIR / f"{key_hash}_src{suffix}")
        try:
            normalize_reference(downloaded, cached_norm, denoise=denoise)
            validate_reference(cached_norm)  # reject too-short / silent clips
        finally:
            Path(downloaded).unlink(missing_ok=True)
        with _ref_cache_lock:
            _ref_cache[cache_lookup_key] = cached_norm
        return cached_norm
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
) -> str:
    # Azure/ElevenLabs: single cloud call (text already normalized; length <= 2000)
    if engine_name in CLOUD_ENGINES:
        # Prefer explicit language-aware method for Azure when available
        if engine_name == "azure" and hasattr(engine, "synthesize_for_language"):
            return engine.synthesize_for_language(text=text, language=language, output_path=raw_out)
        return engine.synthesize(text=text, reference_audio_path=ref_path, output_path=raw_out)

    if engine_name == "msingi" and len(text) > 400:
        return _synthesize_chunked(
            engine, text, ref_path, raw_out, job_id, pause_ms=220, crossfade=True, speaking_rate=speaking_rate
        )
    if engine_name == "mms" and (_split_sentences(text).__len__() > 1 or len(text) > 120):
        return _synthesize_chunked(
            engine, text, ref_path, raw_out, job_id, pause_ms=400, crossfade=False, speaking_rate=speaking_rate
        )
    return engine.synthesize(
        text=text, reference_audio_path=ref_path, output_path=raw_out, speaking_rate=speaking_rate
    )


@router.post("/synthesize", response_model=SynthesizeResponse)
def synthesize(req: SynthesizeRequest):
    manager = get_manager()

    # Normalize text
    text = normalize_text(req.text, req.language)

    # Resolve engine (validate against language)
    requested_engine = req.engine
    engine_name = _resolve_engine(requested_engine, req.language)

    # Cache lookup for identical requests (by effective engine)
    cache_key = (engine_name, req.language, text, req.voice_r2_key or "", req.speaking_rate or 1.0)
    if not req.skip_cache:
        with _cache_lock:
            if cache_key in _result_cache:
                cached = _result_cache[cache_key]
                _result_cache.move_to_end(cache_key)
                # Verify local (dev) output still exists
                if "/static/" not in cached.audio_url or (
                    TEMP_AUDIO_DIR / "outputs" / Path(cached.audio_r2_key).name
                ).exists():
                    return _cached_response_url(cached)
                del _result_cache[cache_key]

    # Prepare reference audio (cached by voice key) for local cloning engines only
    ref_path = _prepare_reference(req, engine_name)

    warning: str | None = None
    job_id = uuid.uuid4().hex
    raw_out = str(TEMP_AUDIO_DIR / f"out_{job_id}.wav")
    mp3_out: str | None = None
    try:
        # Synthesize with Azure quota fallback to MMS
        try:
            engine = manager.get(engine_name)
        except Exception as e:
            if requested_engine == "azure":
                # Smart fallback if Azure unavailable/disabled
                try:
                    engine_name = "mms"
                    engine = manager.get("mms")
                    ref_path = None
                    warning = "Azure engine unavailable. Fell back to Meta MMS-TTS."
                except Exception:
                    raise HTTPException(status_code=503, detail=f"Engine unavailable: {e}")
            else:
                raise HTTPException(status_code=503, detail=f"Engine unavailable: {e}")

        # If we fell back at availability time, update cache key context to effective engine
        cache_key = (engine_name, req.language, text, req.voice_r2_key or "", req.speaking_rate or 1.0)

        try:
            produced = _run_synthesis(
                engine, engine_name, text, req.language, ref_path, raw_out, job_id, speaking_rate=req.speaking_rate
            )
            engine_warning = getattr(engine, "last_warning", None)
            if engine_warning:
                warning = f"{warning} {engine_warning}".strip() if warning else engine_warning
        except ElevenLabsCloningUnavailableError as e:
            # Account/plan does not support IVC: fall back to preset ElevenLabs voice.
            if requested_engine == "elevenlabs":
                warning = "ElevenLabs voice cloning is not available on your current plan. Generated with the preset ElevenLabs voice instead."
                produced = _run_synthesis(
                    engine, "elevenlabs", text, req.language, None, raw_out, job_id, speaking_rate=req.speaking_rate
                )
            else:
                raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")
        except AzureQuotaExceededError:
            # Required smart quota fallback: Azure -> MMS
            try:
                fallback_engine = manager.get("mms")
            except Exception as e:
                raise HTTPException(status_code=503, detail=f"Azure quota exceeded and MMS fallback unavailable: {e}")
            engine_name = "mms"
            ref_path = None
            warning = "Azure quota exceeded (HTTP 429). Fell back to Meta MMS-TTS for this request."
            # Re-run with fallback (new output path)
            raw_out_fb = str(TEMP_AUDIO_DIR / f"out_{job_id}_fb.wav")
            try:
                produced = _run_synthesis(
                    fallback_engine,
                    "mms",
                    text,
                    req.language,
                    None,
                    raw_out_fb,
                    job_id + "_fb",
                    speaking_rate=req.speaking_rate,
                )
                raw_out = raw_out_fb
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"MMS fallback synthesis failed: {e}")
        except Exception as e:
            # Optional resilience: if Azure fails for other transient reasons, do not auto-fallback silently except quota.
            raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")

        if produced.endswith(".mp3"):
            # Already delivered as mp3 (e.g. cloud engine or crossfaded chunks) — skip re-encode.
            mp3_out = produced
        elif _ffmpeg_available():
            candidate = str(TEMP_AUDIO_DIR / f"out_{job_id}.mp3")
            try:
                to_mp3(produced, candidate)
                mp3_out = candidate
            except Exception:
                mp3_out = produced
        else:
            # No ffmpeg locally: keep original container (wav)
            mp3_out = produced

        ext = "mp3" if mp3_out.endswith(".mp3") else "wav"
        r2_key = build_speech_r2_key(
            engine_name, req.language, req.topic or "Untitled", ext
        )
        try:
            url = upload_output(mp3_out, r2_key)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"R2 upload failed: {e}")

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
        except Exception:
            timeline = None
            timeline_source = None

        if not timeline:
            try:
                est = estimate_timeline(text, duration_seconds)
                if est:
                    timeline = est
                    timeline_source = "estimated"
            except Exception:
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

        # Cache successful result by effective engine (without warning to avoid persisting transient fallback notices)
        cache_store = result.model_copy(update={"warning": None})
        cache_key_store = (engine_name, req.language, text, req.voice_r2_key or "", req.speaking_rate or 1.0)
        with _cache_lock:
            _result_cache[cache_key_store] = cache_store
            while len(_result_cache) > _CACHE_MAX:
                _result_cache.popitem(last=False)

        return result
    finally:
        # Output was uploaded; keep cached references, drop per-job scratch files.
        for p in {raw_out, mp3_out}:
            if p:
                Path(p).unlink(missing_ok=True)
