"""Single source of truth for environment/config and shared defaults."""

import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
WEIGHTS_DIR = BASE_DIR / "weights"
TEMP_AUDIO_DIR = BASE_DIR / "temp_audio"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    val = raw.strip().lower()
    if val in {"1", "true", "yes", "on"}:
        return True
    if val in {"0", "false", "no", "off"}:
        return False
    logger.warning("Invalid boolean for %s=%r; using default=%s", name, raw, default)
    return default


def _env_int(name: str, default: int, *, min_value: int | None = None, max_value: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        val = int(raw.strip())
    except ValueError:
        logger.warning("Invalid integer for %s=%r; using default=%s", name, raw, default)
        return default
    if min_value is not None and val < min_value:
        logger.warning("Out-of-range integer for %s=%r; using default=%s", name, raw, default)
        return default
    if max_value is not None and val > max_value:
        logger.warning("Out-of-range integer for %s=%r; using default=%s", name, raw, default)
        return default
    return val


def _env_float(name: str, default: float, *, min_value: float | None = None, max_value: float | None = None) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        val = float(raw.strip())
    except ValueError:
        logger.warning("Invalid float for %s=%r; using default=%s", name, raw, default)
        return default
    if min_value is not None and val < min_value:
        logger.warning("Out-of-range float for %s=%r; using default=%s", name, raw, default)
        return default
    if max_value is not None and val > max_value:
        logger.warning("Out-of-range float for %s=%r; using default=%s", name, raw, default)
        return default
    return val


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (no extra dependency).

    Supports ``export KEY=value``, quoted values and trailing ``# comments``.
    Existing environment variables always win (production uses real env vars).
    """
    if not path.exists():
        return
    # utf-8-sig strips a leading BOM; otherwise the first key (often HF_TOKEN)
    # is parsed as "\ufeffHF_TOKEN" and silently ignored.
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if val[:1] in ("'", '"'):
            quote = val[0]
            end = val.find(quote, 1)
            if end != -1:
                val = val[1:end]
        else:
            val = val.split(" #", 1)[0].strip()
        if key:
            os.environ.setdefault(key, val)


_load_dotenv(BASE_DIR / ".env")

# Ensure scratch dirs exist (single canonical creation point)
TEMP_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

# --- Hugging Face hub cache --------------------------------------------------------
# pocket-tts resolves weights through huggingface_hub's cache. Pin it under
# weights/ so weights prefetched during the Docker build are reused at runtime.
# config is imported before the engines, so this env var is set in time.
HF_HUB_CACHE = os.getenv("HF_HUB_CACHE", str(WEIGHTS_DIR / "hub"))
os.environ.setdefault("HF_HUB_CACHE", HF_HUB_CACHE)

# --- Credentials / object storage -------------------------------------------------
HF_TOKEN = os.getenv("HF_TOKEN", "")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "voice-clone-audio")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL", "")
# Base URL used to serve local files when R2 is not configured (dev fallback)
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")

# --- API auth / abuse controls ----------------------------------------------------
# If API_KEY is set, mutating/expensive endpoints require it via
# `Authorization: Bearer <key>` or `X-API-Key: <key>`.
# Set REQUIRE_AUTH=true to fail closed when no key is configured.
API_KEY = os.getenv("API_KEY", "").strip()
REQUIRE_AUTH = _env_bool("REQUIRE_AUTH", False)
AUTH_SECRET = os.getenv("AUTH_SECRET", "dev-insecure-change-me").strip() or "dev-insecure-change-me"
AUTH_TOKEN_TTL_HOURS = _env_int("AUTH_TOKEN_TTL_HOURS", 168, min_value=1, max_value=24 * 30)
EXPOSE_RESET_TOKENS = _env_bool("EXPOSE_RESET_TOKENS", False)
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = _env_int("SMTP_PORT", 587, min_value=1, max_value=65535)
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM = os.getenv("SMTP_FROM", "").strip()
SMTP_USE_TLS = _env_bool("SMTP_USE_TLS", True)
UPLOAD_SCAN_URL = os.getenv("UPLOAD_SCAN_URL", "").strip()
UPLOAD_SCAN_TIMEOUT_SEC = _env_float("UPLOAD_SCAN_TIMEOUT_SEC", 5.0, min_value=1.0, max_value=30.0)
MAX_UPLOAD_MB = _env_int("MAX_UPLOAD_MB", 25, min_value=1, max_value=500)
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
SERVE_STATIC = _env_bool("SERVE_STATIC", True)
EXPOSE_HEALTH_DETAILS = _env_bool("EXPOSE_HEALTH_DETAILS", False)
# Local-disk media fallback is for development only. Disable in production when R2 is unconfigured.
ALLOW_LOCAL_MEDIA_FALLBACK = _env_bool("ALLOW_LOCAL_MEDIA_FALLBACK", True)
REF_CACHE_MAX_FILES = _env_int("REF_CACHE_MAX_FILES", 128, min_value=8)
REF_CACHE_MAX_AGE_HOURS = _env_int("REF_CACHE_MAX_AGE_HOURS", 72, min_value=1)
APP_DB_PATH = os.getenv("APP_DB_PATH", str(BASE_DIR / "data" / "app.db"))

# --- Memory guard -----------------------------------------------------------------
# Railway $5 = ~8GB; keep headroom by unloading heavy engines before loading another.
MAX_RAM_GB = _env_float("MAX_RAM_GB", 7.0, min_value=0.5)
HEAVY_ENGINE_RAM_GB = _env_float("HEAVY_ENGINE_RAM_GB", 3.0, min_value=0.0)

# --- CORS -------------------------------------------------------------------------
# Exact origins go to allow_origins; wildcard subdomains go to allow_origin_regex
# because Starlette does not expand "*" inside allow_origins.
_raw_origins = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if o.strip()
]
CORS_ALLOW_ORIGINS = [o for o in _raw_origins if "*" not in o]
_default_cors_regex = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
_cors_regex_env = os.getenv("CORS_ORIGIN_REGEX", "").strip()
if _cors_regex_env:
    try:
        re.compile(_cors_regex_env)
        CORS_ORIGIN_REGEX = _cors_regex_env
    except re.error as e:
        logger.warning("Invalid CORS_ORIGIN_REGEX=%r (%s); falling back to localhost-only default", _cors_regex_env, e)
        CORS_ORIGIN_REGEX = _default_cors_regex
else:
    CORS_ORIGIN_REGEX = _default_cors_regex

# --- Model flags ------------------------------------------------------------------
ENABLE_KYUTAI = _env_bool("ENABLE_KYUTAI", True)
ENABLE_AFRISPEECH = _env_bool("ENABLE_AFRISPEECH", True)
ENABLE_MSINGI = _env_bool("ENABLE_MSINGI", True)
ENABLE_MMS = _env_bool("ENABLE_MMS", True)
ENABLE_AZURE = _env_bool("ENABLE_AZURE", True)
ENABLE_ELEVENLABS = _env_bool("ENABLE_ELEVENLABS", True)
KYUTAI_WARM = _env_bool("KYUTAI_WARM", True)
WARM_MMS = _env_bool("WARM_MMS", True)

# Swahili MMS checkpoint. Any VITS/MMS-shaped repo with its own tokenizer works.
# Benchmarked on a 4-sentence Swahili passage (voiced% / peak):
#   facebook/mms-tts-swh                          68% / 0.73  (default, most balanced)
#   stano03/jambogpt-swahili-tts-v1               74% / 0.80  (Apache-2.0, crisper)
#   mussacharles60/swahili-tts-female-voice       77% / 0.82  (MIT, female voice)
MMS_MODEL_ID = os.getenv("MMS_MODEL_ID", "facebook/mms-tts-swh")

# Local engine overrides (previously read with os.getenv inside the engines).
AFRISPEECH_CONFIG = os.getenv("AFRISPEECH_CONFIG", "")
MSINGI_CHECKPOINT_PATH = os.getenv("MSINGI_CHECKPOINT_PATH", "")
MSINGI_LANGUAGE = os.getenv("MSINGI_LANGUAGE", "auto").strip().lower()
SWAHILI_LOANWORDS_PATH = os.getenv("SWAHILI_LOANWORDS_PATH", "").strip()
PREFETCH_STRICT = _env_bool("PREFETCH_STRICT", False)

ENGINE_NAMES = ("kyutai", "afrispeech", "msingi", "mms", "azure", "elevenlabs")

# --- Cloud TTS (Azure Speech / ElevenLabs) ---------------------------------------
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION", "southafricanorth")
AZURE_SWAHILI_VOICE = os.getenv("AZURE_SWAHILI_VOICE", "sw-TZ-DaudiNeural")
AZURE_ENGLISH_VOICE = os.getenv("AZURE_ENGLISH_VOICE", "en-US-AriaNeural")

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")
ELEVENLABS_DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_DEFAULT_VOICE_ID", "nPczCjzI2devNBz1zQrb")
ELEVENLABS_ENABLE_CLONING = _env_bool("ELEVENLABS_ENABLE_CLONING", False)

# --- Audio processing -------------------------------------------------------------
DENOISE_REFERENCE = _env_bool("DENOISE_REFERENCE", True)

# --- Caption / video shared defaults ---------------------------------------------
DEFAULT_INTRO_SEC = _env_float("DEFAULT_INTRO_SEC", 1.5, min_value=0.0)
MAX_INTRO_SEC = _env_float("MAX_INTRO_SEC", 60.0, min_value=0.0)
DEFAULT_OUTRO_SEC = _env_float("DEFAULT_OUTRO_SEC", 2.5, min_value=0.0)
MAX_OUTRO_SEC = _env_float("MAX_OUTRO_SEC", 10.0, min_value=0.0)
DEFAULT_WORDS_PER_CHUNK = _env_int("DEFAULT_WORDS_PER_CHUNK", 3, min_value=1)
MAX_WORDS_PER_CHUNK = _env_int("MAX_WORDS_PER_CHUNK", 8, min_value=1)
DEFAULT_TRIM_END_SEC = _env_float("DEFAULT_TRIM_END_SEC", 0.5, min_value=0.0)
MAX_TRIM_END_SEC = _env_float("MAX_TRIM_END_SEC", 5.0, min_value=0.0)

# --- Packaging --------------------------------------------------------------------
DEFAULT_CLIP_LENGTH_SEC = _env_int("DEFAULT_CLIP_LENGTH_SEC", 40, min_value=1)
MIN_CLIP_LENGTH_SEC = _env_int("MIN_CLIP_LENGTH_SEC", 5, min_value=1)
MAX_CLIP_LENGTH_SEC = _env_int("MAX_CLIP_LENGTH_SEC", 180, min_value=1)

# --- Social-ready video export defaults ------------------------------------------
# Balanced for YouTube / Instagram / Facebook after platform re-compression.
SOCIAL_VIDEO_CRF = _env_int("SOCIAL_VIDEO_CRF", 22, min_value=0, max_value=51)
SOCIAL_VIDEO_PRESET = os.getenv("SOCIAL_VIDEO_PRESET", "veryfast")
SOCIAL_AUDIO_BITRATE = os.getenv("SOCIAL_AUDIO_BITRATE", "160k")
SOCIAL_AUDIO_RATE = _env_int("SOCIAL_AUDIO_RATE", 44100, min_value=8000)
SOCIAL_MAXRATE = os.getenv("SOCIAL_MAXRATE", "12M")
SOCIAL_BUFSIZE = os.getenv("SOCIAL_BUFSIZE", "24M")
