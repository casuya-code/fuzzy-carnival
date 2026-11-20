"""
Pre-fetch model weights during Docker build so the container starts fast.
Run: python scripts/download_weights.py

Set PREFETCH_STRICT=1 to fail the build if any required prefetch fails.
"""
import os
import sys

# Local imports need the backend root on sys.path before anything else runs.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Coqui XTTS asks for license acceptance interactively on first download.
# Prefetch runs unattended (Docker build / CI), so accept it up front.
os.environ.setdefault("COQUI_TOS_AGREED", "1")

from app.config import (  # noqa: E402
    AFRISPEECH_CONFIG,
    HF_TOKEN,
    MMS_MODEL_ID,
    PREFETCH_STRICT,
    WEIGHTS_DIR,
)

if HF_TOKEN:
    os.environ.setdefault("HF_TOKEN", HF_TOKEN)


def _prefetch(name: str, download) -> None:
    try:
        download()
        print(f"Prefetched {name}")
    except Exception as e:
        if PREFETCH_STRICT:
            raise RuntimeError(f"Required prefetch failed for {name}: {e}") from e
        print(f"Skip {name}: {e}")


def prefetch_kyutai() -> None:
    """Match KyutaiPocketEngine.load(): pocket-tts 'english' via the shared HF cache."""
    from pocket_tts import TTSModel

    TTSModel.load_model("english")


def prefetch_afrispeech() -> None:
    """Match AfriSpeechPocketEngine.load() exactly (configured model or 'english')."""
    from pocket_tts import TTSModel

    if AFRISPEECH_CONFIG:
        TTSModel.load_model(config=AFRISPEECH_CONFIG)
    else:
        TTSModel.load_model("english")


def prefetch_mms() -> None:
    """Match MmsSwahiliFallbackEngine.load(): per-model cache dir under weights/mms."""
    from transformers import AutoTokenizer, VitsModel

    cache_dir = WEIGHTS_DIR / "mms" / MMS_MODEL_ID.replace("/", "__")
    cache_dir.mkdir(parents=True, exist_ok=True)
    AutoTokenizer.from_pretrained(MMS_MODEL_ID, cache_dir=str(cache_dir), token=HF_TOKEN or None)
    VitsModel.from_pretrained(MMS_MODEL_ID, cache_dir=str(cache_dir), token=HF_TOKEN or None)


def prefetch_xtts() -> None:
    """Keep the existing Coqui XTTS-v2 prefetch used by the Msingi engine."""
    from app.engines.msingi_sauti import MODEL_NAME
    from TTS.api import TTS

    TTS(MODEL_NAME, gpu=False)


_prefetch("Kyutai Pocket TTS", prefetch_kyutai)
_prefetch("AfriSpeech Pocket TTS", prefetch_afrispeech)
_prefetch("Meta MMS-TTS", prefetch_mms)
_prefetch("XTTS-v2 base (Msingi)", prefetch_xtts)

print("Weight prefetch complete.")
