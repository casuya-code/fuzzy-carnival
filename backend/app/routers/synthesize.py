import hashlib
import re
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException
from scipy.io import wavfile

from app.config import DENOISE_REFERENCE, TEMP_AUDIO_DIR
from app.schemas.tts import SynthesizeRequest, SynthesizeResponse
from app.services.naming_utils import build_speech_r2_key
from app.services.audio_processor import (
    _ffmpeg_available,
    get_duration,
    normalize_reference,
    to_mp3,
    validate_reference,
)
from app.services.model_manager import ModelManager
from app.services.r2_storage import download_reference, public_url, upload_output
from app.services.text_normalizer import normalize_text

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


def _synthesize_chunked(engine, text: str, ref_path, out_path: str, job_id: str, pause_ms: int = 220, crossfade: bool = True) -> str:
    """Synthesize long text sentence-by-sentence and concatenate (XTTS drifts
    on long single passes; chunking keeps pacing consistent)."""
    chunks = _split_sentences(text)
    if len(chunks) == 1:
        return engine.synthesize(text=text, reference_audio_path=ref_path, output_path=out_path)

    tmp_files = []
    try:
        for i, chunk in enumerate(chunks):
            tmp = str(TEMP_AUDIO_DIR / f"chunk_{job_id}_{i}.wav")
            engine.synthesize(text=chunk, reference_audio_path=ref_path, output_path=tmp)
            tmp_files.append(tmp)

        if crossfade:
            stitched = str(TEMP_AUDIO_DIR / f"out_{job_id}.mp3")
            from app.services.audio_processor import stitch_voice_with_crossfades

            produced = stitch_voice_with_crossfades(tmp_files, stitched, pause_ms=pause_ms, crossfade_sec=0.020)
            return produced
        # Pause-based stitching (for engines like MMS that lack natural breaths).
        stitched = str(TEMP_AUDIO_DIR / f"out_{job_id}.wav")
        from app.services.audio_processor import stitch_audio_with_pauses

        produced = stitch_audio_with_pauses(tmp_files, stitched, pause_ms=pause_ms)
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


@router.post("/synthesize", response_model=SynthesizeResponse)
def synthesize(req: SynthesizeRequest):
    manager = get_manager()

    # Normalize text
    text = normalize_text(req.text, req.language)

    # Resolve engine (validate against language)
    engine_name = req.engine
    if req.language == "en" and engine_name in ("msingi", "mms"):
        engine_name = "kyutai"
    if req.language == "sw" and engine_name in ("kyutai", "afrispeech"):
        engine_name = "mms"

    # Cache lookup for identical requests
    cache_key = (engine_name, req.language, text, req.voice_r2_key or "")
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

    try:
        engine = manager.get(engine_name)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Engine unavailable: {e}")

    # Prepare reference audio (cached by voice key)
    ref_path = None
    if req.voice_r2_key and engine_name in ("kyutai", "afrispeech", "msingi"):
        try:
            denoise = req.denoise_ref if req.denoise_ref is not None else DENOISE_REFERENCE
            key_hash = hashlib.md5(req.voice_r2_key.encode()).hexdigest()
            cache_tag = f"{key_hash}_v3_{'dn' if denoise else 'raw'}"
            cached_norm = str(_REFS_DIR / f"{cache_tag}.wav")
            cache_lookup_key = f"{req.voice_r2_key}|{cache_tag}"

            with _ref_cache_lock:
                if cache_lookup_key in _ref_cache and Path(_ref_cache[cache_lookup_key]).exists():
                    ref_path = _ref_cache[cache_lookup_key]
                elif Path(cached_norm).exists():
                    ref_path = cached_norm
                    _ref_cache[cache_lookup_key] = cached_norm

            if ref_path is None:
                suffix = Path(req.voice_r2_key).suffix or ".audio"
                downloaded = download_reference(
                    req.voice_r2_key, dest=_REFS_DIR / f"{key_hash}_src{suffix}"
                )
                try:
                    normalize_reference(downloaded, cached_norm, denoise=denoise)
                    validate_reference(cached_norm)  # reject too-short / silent clips
                finally:
                    Path(downloaded).unlink(missing_ok=True)
                ref_path = cached_norm
                with _ref_cache_lock:
                    _ref_cache[cache_lookup_key] = cached_norm
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Reference audio error: {e}")

    # Synthesize (chunked for XTTS on long text)
    job_id = uuid.uuid4().hex
    raw_out = str(TEMP_AUDIO_DIR / f"out_{job_id}.wav")
    mp3_out: str | None = None
    try:
        try:
            if engine_name == "msingi" and len(text) > 400:
                produced = _synthesize_chunked(engine, text, ref_path, raw_out, job_id, pause_ms=220, crossfade=True)
            elif engine_name == "mms" and (_split_sentences(text).__len__() > 1 or len(text) > 120):
                produced = _synthesize_chunked(engine, text, ref_path, raw_out, job_id, pause_ms=400, crossfade=False)
            else:
                produced = engine.synthesize(text=text, reference_audio_path=ref_path, output_path=raw_out)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")

        if produced.endswith(".mp3"):
            # Already delivered as mp3 (e.g. crossfaded chunks) — skip re-encode.
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

        result = SynthesizeResponse(
            audio_r2_key=r2_key,
            audio_url=url,
            engine_used=engine_name,
            duration_seconds=get_duration(mp3_out),
        )

        with _cache_lock:
            _result_cache[cache_key] = result
            while len(_result_cache) > _CACHE_MAX:
                _result_cache.popitem(last=False)

        return result
    finally:
        # Output was uploaded; keep cached references, drop per-job scratch files.
        for p in {raw_out, mp3_out}:
            if p:
                Path(p).unlink(missing_ok=True)
