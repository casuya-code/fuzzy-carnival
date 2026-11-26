"""Language routing and fallback rules stay enforced after the metrics refactor."""

from app.routers.synthesize import (
    _fallback_engine,
    _make_cache_key,
    _remap_warning,
    _resolve_engine,
)
from app.schemas.tts import SynthesizeRequest


def _req(**overrides):
    data = {"text": "Habari za leo", "language": "sw", "engine": "azure"}
    data.update(overrides)
    return SynthesizeRequest.model_validate(data)


def test_language_remaps_keep_both_languages_supported():
    assert _resolve_engine("azure", "sw") == "azure"
    assert _resolve_engine("kyutai", "sw") == "azure"
    assert _resolve_engine("msingi", "en") == "kyutai"
    assert _resolve_engine("elevenlabs", "en") == "elevenlabs"


def test_warning_appears_only_when_engine_was_remapped():
    assert _remap_warning("kyutai", "azure", "sw") is not None
    assert _remap_warning("azure", "azure", "sw") is None
    assert _remap_warning("elevenlabs", "elevenlabs", "en") is None


def test_fallback_engine_matches_language():
    assert _fallback_engine("sw") == "mms"
    assert _fallback_engine("en") == "kyutai"


def test_cache_key_covers_effective_engine_and_quality_options():
    base = _make_cache_key("azure", _req(), "Habari za leo")
    assert base == _make_cache_key("azure", _req(), "Habari za leo")
    assert base != _make_cache_key("kyutai", _req(), "Habari za leo")
    assert base != _make_cache_key("azure", _req(speaking_rate=1.2), "Habari za leo")
