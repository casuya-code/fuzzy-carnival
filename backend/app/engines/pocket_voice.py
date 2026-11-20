"""Shared voice-state handling for PocketTTS-based engines.

PocketTTS can load a reduced model when the gated voice-cloning weights are
unavailable. In that case a reference sample cannot be honoured, so we fall
back to a built-in catalog voice and return a notice for the UI instead of
failing the whole request.
"""

import copy
import hashlib
from typing import Any

CATALOG_VOICE = "alba"

CLONING_UNAVAILABLE_WARNING = (
    "Voice cloning is unavailable for this engine, so the built-in 'alba' voice was used. "
    "To enable cloning, accept the Kyutai Pocket TTS terms on Hugging Face and log in locally."
)


def get_voice_state(
    model: Any,
    reference_audio_path: str | None,
    cache: dict,
    catalog_voice: str = CATALOG_VOICE,
) -> tuple[Any, str | None]:
    """Return a PocketTTS voice state and an optional non-fatal warning."""
    warning: str | None = None

    if reference_audio_path and getattr(model, "has_voice_cloning", True):
        with open(reference_audio_path, "rb") as f:
            content_hash = hashlib.md5(f.read()).hexdigest()
        if content_hash in cache:
            return copy.deepcopy(cache[content_hash]), None
        voice_state = model.get_state_for_audio_prompt(reference_audio_path)
        if len(cache) >= 4:
            cache.pop(next(iter(cache)))
        cache[content_hash] = copy.deepcopy(voice_state)
        return voice_state, None

    if reference_audio_path:
        warning = CLONING_UNAVAILABLE_WARNING

    # Cache the catalog voice so repeated no-cloning generations are instant.
    cache_key = f"__default_{catalog_voice}__"
    if cache_key in cache:
        return copy.deepcopy(cache[cache_key]), warning
    voice_state = model.get_state_for_audio_prompt(catalog_voice)
    cache[cache_key] = copy.deepcopy(voice_state)
    return voice_state, warning
