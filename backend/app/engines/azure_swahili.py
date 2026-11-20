import html
import re
import uuid
from pathlib import Path

import requests

from app.config import (
    AZURE_ENGLISH_VOICE,
    AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION,
    AZURE_SWAHILI_VOICE,
    TEMP_AUDIO_DIR,
)
from app.engines.base import BaseTTSEngine


class AzureQuotaExceededError(RuntimeError):
    """Raised when Azure Speech returns HTTP 429 / quota exceeded."""


def _strip_wav_header_to_mp3_path(path: str) -> str:
    p = Path(path)
    if p.suffix.lower() == ".mp3":
        return str(p)
    return str(p.with_suffix(".mp3"))


class AzureSwahiliEngine(BaseTTSEngine):
    name = "azure"
    ram_gb = 0.0  # cloud REST API, no local model RAM

    def load(self) -> None:
        # No local weights to load.
        self._loaded = True
        self.model = object()

    def unload(self) -> None:
        self.model = None
        self._loaded = False

    def _voice_for_language(self, language: str) -> str:
        if (language or "").lower().startswith("sw"):
            return AZURE_SWAHILI_VOICE or "sw-TZ-DaudiNeural"
        return AZURE_ENGLISH_VOICE or "en-US-AriaNeural"

    def synthesize(
        self,
        text: str,
        reference_audio_path=None,
        output_path=None,
        speaking_rate=None,
    ) -> str:
        # reference_audio_path ignored (Azure neural voices are preset; no zero-shot cloning here)
        if not AZURE_SPEECH_KEY or not AZURE_SPEECH_REGION:
            raise RuntimeError(
                "Azure Speech is not configured (set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION)"
            )

        if output_path is None:
            output_path = str(TEMP_AUDIO_DIR / f"azure_{uuid.uuid4().hex}.mp3")
        else:
            output_path = _strip_wav_header_to_mp3_path(output_path)

        # Default to Swahili voice; callers may set language context via text/lang routing.
        # Detect likely language hint from env defaults: if default voice is sw-*, assume sw unless overridden by caller conventions.
        # We accept text as-is (already normalized upstream).
        # Try to infer language from voice selection done by caller? Not passed; use sw default for this engine name.
        voice = AZURE_SWAHILI_VOICE or "sw-TZ-DaudiNeural"
        lang_tag = "sw-TZ"
        m = re.match(r"^([a-z]{2}-[A-Z]{2})-", voice)
        if m:
            lang_tag = m.group(1)

        # If the text looks like English-heavy content and English voice configured differently, keep configured voice.
        # (Router selects engine per language; this engine is primarily for Swahili.)

        url = f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
        ssml = (
            f"<speak version='1.0' xml:lang='{lang_tag}'>"
            f"<voice xml:lang='{lang_tag}' name='{voice}'>"
            f"{html.escape(text)}"
            f"</voice></speak>"
        )
        headers = {
            "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "yakodonyo-voice-studio",
        }

        try:
            resp = requests.post(url, headers=headers, data=ssml.encode("utf-8"), timeout=60)
        except requests.RequestException as e:
            raise RuntimeError(f"Azure Speech request failed: {e}")

        if resp.status_code == 429:
            raise AzureQuotaExceededError("Azure Speech quota exceeded (HTTP 429)")
        if resp.status_code >= 400:
            detail = resp.text[:300]
            raise RuntimeError(f"Azure Speech error {resp.status_code}: {detail}")

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(resp.content)
        return output_path

    def synthesize_for_language(
        self,
        text: str,
        language: str,
        output_path: str | None = None,
    ) -> str:
        """Explicit language-aware synthesis (used by router if needed)."""
        if not AZURE_SPEECH_KEY or not AZURE_SPEECH_REGION:
            raise RuntimeError(
                "Azure Speech is not configured (set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION)"
            )
        if output_path is None:
            output_path = str(TEMP_AUDIO_DIR / f"azure_{uuid.uuid4().hex}.mp3")
        else:
            output_path = _strip_wav_header_to_mp3_path(output_path)

        voice = self._voice_for_language(language)
        lang_tag = "sw-TZ" if (language or "").lower().startswith("sw") else "en-US"
        m = re.match(r"^([a-z]{2}-[A-Z]{2})-", voice)
        if m:
            lang_tag = m.group(1)

        url = f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
        ssml = (
            f"<speak version='1.0' xml:lang='{lang_tag}'>"
            f"<voice xml:lang='{lang_tag}' name='{voice}'>"
            f"{html.escape(text)}"
            f"</voice></speak>"
        )
        headers = {
            "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "yakodonyo-voice-studio",
        }
        try:
            resp = requests.post(url, headers=headers, data=ssml.encode("utf-8"), timeout=60)
        except requests.RequestException as e:
            raise RuntimeError(f"Azure Speech request failed: {e}")
        if resp.status_code == 429:
            raise AzureQuotaExceededError("Azure Speech quota exceeded (HTTP 429)")
        if resp.status_code >= 400:
            detail = resp.text[:300]
            raise RuntimeError(f"Azure Speech error {resp.status_code}: {detail}")
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(resp.content)
        return output_path
