"""Single source of truth for environment/config and shared defaults."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
WEIGHTS_DIR = BASE_DIR / "weights"
TEMP_AUDIO_DIR = BASE_DIR / "temp_audio"


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (no extra dependency).

    Supports ``export KEY=value``, quoted values and trailing ``# comments``.
    Existing environment variables always win (production uses real env vars).
    """
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
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

# --- Credentials / object storage -------------------------------------------------
HF_TOKEN = os.getenv("HF_TOKEN", "")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "voice-clone-audio")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL", "")
# Base URL used to serve local files when R2 is not configured (dev fallback)
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")

# --- Memory guard -----------------------------------------------------------------
# Railway $5 = ~8GB; keep headroom by unloading heavy engines before loading another.
MAX_RAM_GB = float(os.getenv("MAX_RAM_GB", "7.0"))
HEAVY_ENGINE_RAM_GB = float(os.getenv("HEAVY_ENGINE_RAM_GB", "3.0"))

# --- CORS -------------------------------------------------------------------------
# Exact origins go to allow_origins; wildcard subdomains go to allow_origin_regex
# because Starlette does not expand "*" inside allow_origins.
_raw_origins = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:3000,https://*.vercel.app"
    ).split(",")
    if o.strip()
]
CORS_ALLOW_ORIGINS = [o for o in _raw_origins if "*" not in o]
CORS_ORIGIN_REGEX = r"https://.*\.vercel\.app" if any("*" in o for o in _raw_origins) else None

# --- Model flags ------------------------------------------------------------------
ENABLE_KYUTAI = os.getenv("ENABLE_KYUTAI", "true").lower() == "true"
ENABLE_AFRISPEECH = os.getenv("ENABLE_AFRISPEECH", "true").lower() == "true"
ENABLE_MSINGI = os.getenv("ENABLE_MSINGI", "true").lower() == "true"
ENABLE_MMS = os.getenv("ENABLE_MMS", "true").lower() == "true"
ENABLE_AZURE = os.getenv("ENABLE_AZURE", "true").lower() == "true"
ENABLE_ELEVENLABS = os.getenv("ENABLE_ELEVENLABS", "true").lower() == "true"
KYUTAI_WARM = os.getenv("KYUTAI_WARM", "true").lower() == "true"
WARM_MMS = os.getenv("WARM_MMS", "true").lower() == "true"

# Swahili MMS checkpoint. Any VITS/MMS-shaped repo with its own tokenizer works.
# Benchmarked on a 4-sentence Swahili passage (voiced% / peak):
#   facebook/mms-tts-swh                          68% / 0.73  (default, most balanced)
#   stano03/jambogpt-swahili-tts-v1               74% / 0.80  (Apache-2.0, crisper)
#   mussacharles60/swahili-tts-female-voice       77% / 0.82  (MIT, female voice)
MMS_MODEL_ID = os.getenv("MMS_MODEL_ID", "facebook/mms-tts-swh")

ENGINE_NAMES = ("kyutai", "afrispeech", "msingi", "mms", "azure", "elevenlabs")

# --- Cloud TTS (Azure Speech / ElevenLabs) ---------------------------------------
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION", "southafricanorth")
AZURE_SWAHILI_VOICE = os.getenv("AZURE_SWAHILI_VOICE", "sw-TZ-DaudiNeural")
AZURE_ENGLISH_VOICE = os.getenv("AZURE_ENGLISH_VOICE", "en-US-AriaNeural")

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")
ELEVENLABS_DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_DEFAULT_VOICE_ID", "nPczCjzI2devNBz1zQrb")
ELEVENLABS_ENABLE_CLONING = os.getenv("ELEVENLABS_ENABLE_CLONING", "false").lower() == "true"

# --- Audio processing -------------------------------------------------------------
DENOISE_REFERENCE = os.getenv("DENOISE_REFERENCE", "true").lower() == "true"

# --- Caption / video shared defaults ---------------------------------------------
DEFAULT_INTRO_SEC = float(os.getenv("DEFAULT_INTRO_SEC", "1.5"))
MAX_INTRO_SEC = float(os.getenv("MAX_INTRO_SEC", "60"))
DEFAULT_OUTRO_SEC = float(os.getenv("DEFAULT_OUTRO_SEC", "2.5"))
MAX_OUTRO_SEC = float(os.getenv("MAX_OUTRO_SEC", "10"))
DEFAULT_WORDS_PER_CHUNK = int(os.getenv("DEFAULT_WORDS_PER_CHUNK", "3"))
MAX_WORDS_PER_CHUNK = 8
DEFAULT_TRIM_END_SEC = float(os.getenv("DEFAULT_TRIM_END_SEC", "0.5"))
MAX_TRIM_END_SEC = 5.0

# --- Packaging --------------------------------------------------------------------
DEFAULT_CLIP_LENGTH_SEC = int(os.getenv("DEFAULT_CLIP_LENGTH_SEC", "40"))
MIN_CLIP_LENGTH_SEC = 5
MAX_CLIP_LENGTH_SEC = 180

# --- Social-ready video export defaults ------------------------------------------
# Balanced for YouTube / Instagram / Facebook after platform re-compression.
SOCIAL_VIDEO_CRF = int(os.getenv("SOCIAL_VIDEO_CRF", "22"))
SOCIAL_VIDEO_PRESET = os.getenv("SOCIAL_VIDEO_PRESET", "veryfast")
SOCIAL_AUDIO_BITRATE = os.getenv("SOCIAL_AUDIO_BITRATE", "160k")
SOCIAL_AUDIO_RATE = int(os.getenv("SOCIAL_AUDIO_RATE", "44100"))
SOCIAL_MAXRATE = os.getenv("SOCIAL_MAXRATE", "12M")
SOCIAL_BUFSIZE = os.getenv("SOCIAL_BUFSIZE", "24M")
