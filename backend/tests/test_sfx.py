"""Stage 3: locally generated transition SFX."""

import wave

from fastapi import HTTPException
import pytest

from app.routers.video import _sfx_settings
from app.services.sfx_generator import (
    DEFAULT_SFX,
    DEFAULT_SFX_LEVEL,
    generate_sfx_bed,
    normalize_sfx,
    normalize_sfx_level,
)
from app.services.video_transitions import transition_events


def test_sfx_defaults_and_validation():
    assert normalize_sfx(None) == DEFAULT_SFX
    assert normalize_sfx(" WHOOSH ") == "whoosh"
    assert normalize_sfx_level(999) == 100
    assert normalize_sfx_level(-4) == 0
    with pytest.raises(ValueError):
        normalize_sfx("laser")
    with pytest.raises(ValueError):
        normalize_sfx_level("loud")
    with pytest.raises(HTTPException) as exc:
        _sfx_settings("laser", 40)
    assert exc.value.status_code == 400


def test_transition_events_match_xfade_offsets():
    events = transition_events([4.0, 4.0, 4.0], ["fade", "fade"], 0.5)
    assert events == [("fade", 3.5, 0.5), ("fade", 7.0, 0.5)]


def test_generated_bed_is_audible_and_level_aware(tmp_path):
    quiet = tmp_path / "quiet.wav"
    loud = tmp_path / "loud.wav"
    assert generate_sfx_bed(quiet, [4.0, 4.0], ["fade"], 0.5, "pop", 20, 7.5)
    assert generate_sfx_bed(loud, [4.0, 4.0], ["fade"], 0.5, "pop", 90, 7.5)

    def peak(path):
        with wave.open(str(path), "rb") as wav:
            assert wav.getframerate() == 44100
            assert wav.getnchannels() == 1
            frames = wav.readframes(wav.getnframes())
        samples = [abs(int.from_bytes(frames[i:i + 2], "little", signed=True)) for i in range(0, len(frames), 2)]
        return max(samples)

    assert peak(quiet) > 0
    assert peak(loud) > peak(quiet)


def test_off_or_empty_events_write_nothing(tmp_path):
    target = tmp_path / "silent.wav"
    assert not generate_sfx_bed(target, [4.0, 4.0], ["fade"], 0.5, "off", 100, 7.5)
    assert not generate_sfx_bed(target, [4.0], [], 0.5, "whoosh", 100, 4.0)
    assert not target.exists()
