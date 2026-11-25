import hashlib
import json
import logging
import threading
import uuid
from pathlib import Path

from elevenlabs import ElevenLabs

from app.config import (
    ELEVENLABS_API_KEY,
    ELEVENLABS_DEFAULT_VOICE_ID,
    ELEVENLABS_ENABLE_CLONING,
    ELEVENLABS_MODEL_ID,
    TEMP_AUDIO_DIR,
)
from app.engines.base import BaseTTSEngine
from app.services.path_utils import mp3_output_path as _mp3_path
from app.services.timeline_service import (
    extract_audio_bytes_from_elevenlabs_timestamps_response,
    extract_timeline_from_elevenlabs_timestamps_response,
)

logger = logging.getLogger(__name__)


class ElevenLabsQuotaExceededError(RuntimeError):
    """Raised when ElevenLabs returns HTTP 429 / quota exceeded."""


class ElevenLabsCloningUnavailableError(RuntimeError):
    """Raised when Instant Voice Cloning is not available for the account/plan."""


class ElevenLabsEngine(BaseTTSEngine):
    name = "elevenlabs"
    ram_gb = 0.0  # cloud SDK/API, no local model RAM

    def __init__(self) -> None:
        super().__init__()
        self._client: ElevenLabs | None = None
        self._voice_cache: dict[str, str] = {}
        self._voice_cache_lock = threading.Lock()
        self._voice_cache_path = TEMP_AUDIO_DIR / "elevenlabs_voice_cache.json"
        self._last_timeline: list[dict] | None = None
        self._last_timeline_source: str | None = None
        self._load_voice_cache()

    def get_last_timeline(self) -> tuple[list[dict] | None, str | None]:
        return self._last_timeline, self._last_timeline_source

    def _load_voice_cache(self) -> None:
        try:
            if self._voice_cache_path.exists():
                data = json.loads(self._voice_cache_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self._voice_cache = {str(k): str(v) for k, v in data.items() if v}
        except Exception as e:
            logger.warning("Could not load ElevenLabs voice cache %s: %s", self._voice_cache_path, e)
            self._voice_cache = {}

    def _save_voice_cache(self) -> None:
        try:
            self._voice_cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._voice_cache_path.write_text(json.dumps(self._voice_cache, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning("Could not save ElevenLabs voice cache %s: %s", self._voice_cache_path, e)

    def _client_or_raise(self) -> ElevenLabs:
        if not ELEVENLABS_API_KEY:
            raise RuntimeError("ElevenLabs is not configured (set ELEVENLABS_API_KEY)")
        if self._client is None:
            self._client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        return self._client

    def load(self) -> None:
        # No local weights to load. Keep SDK client lazy.
        self._loaded = True
        self.model = object()

    def unload(self) -> None:
        self._client = None
        self.model = None
        self._loaded = False

    def _is_quota_error(self, exc: Exception) -> bool:
        msg = str(exc).lower()
        status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
        body = getattr(exc, "body", None)
        body_text = str(body).lower() if body is not None else ""
        return status == 429 or "429" in msg or "quota" in msg or "rate limit" in msg or "quota" in body_text

    def _is_cloning_unavailable_error(self, exc: Exception) -> bool:
        status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
        body = getattr(exc, "body", None)
        msg = str(exc).lower()

        code = ""
        detail_status = ""
        detail_type = ""
        message = ""
        if isinstance(body, dict):
            detail = body.get("detail")
            if isinstance(detail, dict):
                code = str(detail.get("code", "")).lower()
                detail_status = str(detail.get("status", "")).lower()
                detail_type = str(detail.get("type", "")).lower()
                message = str(detail.get("message", "")).lower()
            elif isinstance(detail, str):
                message = detail.lower()

        haystack = " ".join([msg, code, detail_status, detail_type, message])
        if "can_not_use_instant_voice_cloning" in haystack:
            return True
        if "instant voice cloning" in haystack and ("plan" in haystack or "subscription" in haystack or "upgrade" in haystack or "payment" in haystack):
            return True
        if code in {"paid_plan_required", "payment_required"} and ("clone" in haystack or "voice" in haystack):
            return True
        if status == 403 and ("clone" in haystack or "voice" in haystack):
            return True
        return False

    def _clone_cache_key(self, reference_audio_path: str) -> str:
        p = Path(reference_audio_path)
        try:
            h = hashlib.sha256()
            with p.open("rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
            return h.hexdigest()
        except Exception:
            try:
                st = p.stat()
                basis = f"{p.name}|{st.st_size}|{int(st.st_mtime)}"
            except Exception:
                basis = p.name
            return hashlib.sha256(basis.encode("utf-8")).hexdigest()

    def _get_or_create_cloned_voice_id(self, reference_audio_path: str) -> str:
        if not ELEVENLABS_ENABLE_CLONING:
            raise RuntimeError("ElevenLabs voice cloning is not enabled (set ELEVENLABS_ENABLE_CLONING=true)")

        ref = Path(reference_audio_path)
        if not ref.exists():
            raise RuntimeError("Reference audio file not found for ElevenLabs cloning")

        cache_key = self._clone_cache_key(reference_audio_path)
        with self._voice_cache_lock:
            cached = self._voice_cache.get(cache_key)
        if cached:
            return cached

        client = self._client_or_raise()
        name = f"Yakodonyo IVC {cache_key[:8]}"
        try:
            with ref.open("rb") as f:
                # SDK v2 IVC: create instant voice clone from uploaded sample(s)
                created = client.voices.ivc.create(
                    name=name,
                    files=[f],
                    remove_background_noise=True,
                    description="Auto-created voice clone for Yakodonyo TTS",
                )
        except Exception as e:
            if self._is_quota_error(e):
                raise ElevenLabsQuotaExceededError("ElevenLabs quota/rate limit exceeded (HTTP 429)")
            if self._is_cloning_unavailable_error(e):
                raise ElevenLabsCloningUnavailableError(
                    "Instant voice cloning is not available on your current ElevenLabs plan. Use a preset voice or upgrade your ElevenLabs plan to enable cloning."
                )
            raise RuntimeError(f"ElevenLabs voice cloning failed: {e}")

        voice_id = getattr(created, "voice_id", None) or (created.get("voice_id") if isinstance(created, dict) else None)
        if not voice_id:
            raise RuntimeError("ElevenLabs voice cloning failed: no voice_id returned")

        with self._voice_cache_lock:
            self._voice_cache[cache_key] = str(voice_id)
            self._save_voice_cache()
        return str(voice_id)

    def _resolve_voice_id(self, reference_audio_path) -> str:
        if reference_audio_path and ELEVENLABS_ENABLE_CLONING:
            return self._get_or_create_cloned_voice_id(str(reference_audio_path))
        return ELEVENLABS_DEFAULT_VOICE_ID or "nPczCjzI2devNBz1zQrb"

    def synthesize(
        self,
        text: str,
        reference_audio_path=None,
        output_path=None,
        speaking_rate=None,
    ) -> str:
        client = self._client_or_raise()
        model_id = ELEVENLABS_MODEL_ID or "eleven_flash_v2_5"
        _ = speaking_rate  # ElevenLabs TTS speed control is not wired in this engine yet
        self._last_timeline = None
        self._last_timeline_source = None

        if output_path is None:
            output_path = str(TEMP_AUDIO_DIR / f"elevenlabs_{uuid.uuid4().hex}.mp3")
        else:
            output_path = _mp3_path(output_path)

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # Try once; if a cached cloned voice is invalid, recreate and retry once.
        for attempt in range(2):
            try:
                voice_id = self._resolve_voice_id(reference_audio_path)

                # Prefer timestamps/alignment when available; fall back to plain TTS if unsupported/fails.
                try:
                    ts_resp = client.text_to_speech.convert_with_timestamps(
                        voice_id=voice_id,
                        text=text,
                        model_id=model_id,
                        output_format="mp3_44100_128",
                    )
                    audio_bytes = extract_audio_bytes_from_elevenlabs_timestamps_response(ts_resp)
                    if not audio_bytes:
                        raise RuntimeError("No audio returned from convert_with_timestamps")
                    with open(output_path, "wb") as f:
                        f.write(audio_bytes)
                    try:
                        timeline = extract_timeline_from_elevenlabs_timestamps_response(ts_resp)
                        if timeline:
                            self._last_timeline = timeline
                            self._last_timeline_source = "provider"
                    except Exception as e:
                        logger.debug("ElevenLabs timeline extraction failed: %s", e)
                        self._last_timeline = None
                        self._last_timeline_source = None
                    return output_path
                except ElevenLabsQuotaExceededError:
                    raise
                except ElevenLabsCloningUnavailableError:
                    raise
                except Exception as ts_e:
                    if self._is_quota_error(ts_e):
                        raise ElevenLabsQuotaExceededError("ElevenLabs quota/rate limit exceeded (HTTP 429)")
                    if self._is_cloning_unavailable_error(ts_e):
                        raise ElevenLabsCloningUnavailableError(
                            "Instant voice cloning is not available on your current ElevenLabs plan. Use a preset voice or upgrade your ElevenLabs plan to enable cloning."
                        )
                    # Fallback to plain audio generation for maximum compatibility.
                    self._last_timeline = None
                    self._last_timeline_source = None

                audio = client.text_to_speech.convert(
                    voice_id=voice_id,
                    text=text,
                    model_id=model_id,
                    output_format="mp3_44100_128",
                )
                with open(output_path, "wb") as f:
                    for chunk in audio:
                        if chunk:
                            f.write(chunk)
                return output_path
            except ElevenLabsQuotaExceededError:
                raise
            except ElevenLabsCloningUnavailableError:
                raise
            except Exception as e:
                if self._is_quota_error(e):
                    raise ElevenLabsQuotaExceededError("ElevenLabs quota/rate limit exceeded (HTTP 429)")
                if self._is_cloning_unavailable_error(e):
                    raise ElevenLabsCloningUnavailableError(
                        "Instant voice cloning is not available on your current ElevenLabs plan. Use a preset voice or upgrade your ElevenLabs plan to enable cloning."
                    )

                # If cached cloned voice became invalid, drop cache entry and retry once.
                if (
                    attempt == 0
                    and reference_audio_path
                    and ELEVENLABS_ENABLE_CLONING
                    and ("404" in str(e) or "voice" in str(e).lower() and "not" in str(e).lower())
                ):
                    try:
                        cache_key = self._clone_cache_key(str(reference_audio_path))
                        with self._voice_cache_lock:
                            self._voice_cache.pop(cache_key, None)
                            self._save_voice_cache()
                        continue
                    except Exception as evict_error:
                        logger.warning("Could not evict invalid ElevenLabs voice cache entry: %s", evict_error)

                if not ELEVENLABS_API_KEY:
                    raise RuntimeError("ElevenLabs is not configured (set ELEVENLABS_API_KEY)")
                raise RuntimeError(f"ElevenLabs TTS failed: {e}")

        # Unreachable: the loop above always returns or raises on every path.
        raise RuntimeError("ElevenLabs TTS failed: exhausted retry attempts")
