"""
Pre-fetch model weights during Docker build so the container starts fast.
Run: python scripts/download_weights.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Coqui XTTS asks for license acceptance interactively on first download.
# Prefetch runs unattended (Docker build / CI), so accept it up front.
os.environ.setdefault("COQUI_TOS_AGREED", "1")

from app.config import WEIGHTS_DIR, HF_TOKEN

if HF_TOKEN:
    os.environ.setdefault("HF_TOKEN", HF_TOKEN)

# Kyutai Pocket TTS
try:
    from transformers import AutoModelForTextToWaveform, AutoProcessor
    AutoProcessor.from_pretrained("kyutai/pocket-tts", cache_dir=str(WEIGHTS_DIR / "kyutai"), token=HF_TOKEN or None)
    AutoModelForTextToWaveform.from_pretrained("kyutai/pocket-tts", cache_dir=str(WEIGHTS_DIR / "kyutai"), token=HF_TOKEN or None)
    print("Downloaded Kyutai Pocket TTS")
except Exception as e:
    print(f"Skip Kyutai: {e}")

# AfriSpeech
try:
    from transformers import AutoModelForTextToWaveform, AutoProcessor
    AutoProcessor.from_pretrained("afrispeech/pocket-tts-african", cache_dir=str(WEIGHTS_DIR / "afrispeech"), token=HF_TOKEN or None)
    AutoModelForTextToWaveform.from_pretrained("afrispeech/pocket-tts-african", cache_dir=str(WEIGHTS_DIR / "afrispeech"), token=HF_TOKEN or None)
    print("Downloaded AfriSpeech")
except Exception as e:
    print(f"Skip AfriSpeech: {e}")

# Meta MMS-TTS Swahili
try:
    from transformers import VitsModel, AutoTokenizer
    AutoTokenizer.from_pretrained("facebook/mms-tts-swh", cache_dir=str(WEIGHTS_DIR / "mms"), token=HF_TOKEN or None)
    VitsModel.from_pretrained("facebook/mms-tts-swh", cache_dir=str(WEIGHTS_DIR / "mms"), token=HF_TOKEN or None)
    print("Downloaded Meta MMS-TTS")
except Exception as e:
    print(f"Skip MMS: {e}")

# Msingi-AI Sauti (XTTS-v2) via Coqui TTS
try:
    from TTS.api import TTS
    TTS("tts_models/multilingual/multi-dataset/xtts_v2", gpu=False)
    print("Downloaded XTTS-v2 base (Msingi uses fine-tune checkpoint if provided)")
except Exception as e:
    print(f"Skip XTTS: {e}")

print("Weight prefetch complete.")