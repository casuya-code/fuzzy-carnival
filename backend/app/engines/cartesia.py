import uuid
from pathlib import Path

import requests

from app.config import (
    CARTESIA_API_KEY,
    CARTESIA_MODEL_ID,
    CARTESIA_VOICE_ID,
    TEMP_AUDIO_DIR,
)
from app.engines.base import BaseTTSEngine


class CartesiaQuotaExceededError(RuntimeError):
    """Raised when Cartesia returns HTTP 429 / quota exceeded."""


_DEFAULT_VOICE_ID = "6385d6e7-e385-4693-b2b6-c76260452d71"


class CartesiaEngine(BaseTTSEngine):
    name = "cartesia"
    ram_gb = 0.0  # cloud REST API, no local model RAM

    def load(self) -> None:
        self._loaded = True
        self.model = object()

    def unload(self) -> None:
        self.model = None
        self._loaded = False

    def synthesize(
        self,
        text: str,
        reference_audio_path=None,
        output_path=None,
        speaking_rate=None,
    ) -> str:
        if not CARTESIA_API_KEY:
            raise RuntimeError(
                "Cartesia is not configured (set CARTESIA_API_KEY)"
            )
        if output_path is None:
            output_path = str(TEMP_AUDIO_DIR / f"cartesia_{uuid.uuid4().hex}.mp3")
        else:
            output_path = str(Path(output_path).with_suffix(".mp3"))

        voice_id = CARTESIA_VOICE_ID or _DEFAULT_VOICE_ID
        url = "https://api.cartesia.ai/tts/bytes"
        headers = {
            "X-API-Key": CARTESIA_API_KEY,
            "Cartesia-Version": "2024-06-10",
            "Content-Type": "application/json",
        }
        payload = {
            "model_id": CARTESIA_MODEL_ID,
            "transcript": text,
            "voice": {"mode": "id", "id": voice_id},
            "output_format": {
                "container": "mp3",
                "encoding": "mp3",
                "sample_rate": 44100,
            },
        }
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=120)
        except requests.RequestException as e:
            raise RuntimeError(f"Cartesia request failed: {e}")
        if resp.status_code == 429:
            raise CartesiaQuotaExceededError("Cartesia quota exceeded (HTTP 429)")
        if resp.status_code >= 400:
            detail = resp.text[:300]
            raise RuntimeError(f"Cartesia error {resp.status_code}: {detail}")
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(resp.content)
        return output_path
