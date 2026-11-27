"""Bracketed stage directions are performed, not pronounced."""

from pathlib import Path

from app.routers import synthesize as synth
from app.routers.synthesize import _make_cache_key
from app.schemas.tts import SynthesizeRequest
from app.services.stage_directions import (
    DEFAULT_PAUSE_MS,
    LONG_PAUSE_MS,
    parse_stage_directions,
    suggested_rate,
)


def test_tone_notes_and_emphasis_are_stripped_from_speech():
    script = parse_stage_directions(
        "[measured, inquisitive tone] A road cuts through a dry landscape. "
        "For wildlife, roads can bring <emphasis>danger</emphasis> and divide habitats."
    )
    assert script.spoken == (
        "A road cuts through a dry landscape. For wildlife, roads can bring "
        "danger and divide habitats."
    )
    assert "inquisitive" not in script.spoken
    assert "emphasis" not in script.spoken
    assert script.pause_count == 0
    assert script.emphasis_count == 2
    assert len(script.segments) == 1


def test_pause_creates_a_real_boundary_with_gap():
    script = parse_stage_directions(
        "A road cuts through a dry landscape. [pause] But what is beyond the roadside?"
    )
    assert script.segments == (
        "A road cuts through a dry landscape.",
        "But what is beyond the roadside?",
    )
    assert script.gaps_ms == (DEFAULT_PAUSE_MS,)
    assert script.pause_count == 1
    assert "pause" not in script.spoken


def test_explicit_and_long_pauses():
    short = parse_stage_directions("One. [pause:250ms] Two.")
    assert short.gaps_ms == (250,)
    long = parse_stage_directions("One. [long pause] Two.")
    assert long.gaps_ms == (LONG_PAUSE_MS,)
    timed = parse_stage_directions("One. [pause 1.2s] Two.")
    assert timed.gaps_ms == (1200,)


def test_script_with_many_tone_changes_and_emphasis():
    raw = (
        "[serious, cautionary tone] For wildlife, roads can bring "
        "<emphasis>danger</emphasis> and divide the places animals use."
        "[reflective, measured tone] The road is only one part of the story."
        "[clear, explanatory tone] Here, a channel cuts through the slope. [pause] "
        "To understand <emphasis>why it formed</emphasis>, we would need to look closer."
    )
    script = parse_stage_directions(raw)
    assert script.pause_count == 1
    assert script.emphasis_count == 4
    assert len(script.segments) == 2
    assert script.gaps_ms == (DEFAULT_PAUSE_MS,)
    assert "tone" not in script.spoken
    assert "<" not in script.spoken
    assert "danger and divide" in script.spoken
    assert "why it formed" in script.spoken


def test_tone_hints_nudge_pace_neutrally():
    assert suggested_rate("serious, cautionary tone") == 0.92
    assert suggested_rate("measured, inquisitive tone") is None
    assert suggested_rate("reflective, measured tone") == 0.92
    assert suggested_rate("warm, informative tone") == 1.04
    assert suggested_rate("") is None


def test_pause_timing_is_part_of_cache_identity():
    req = SynthesizeRequest(text="One. Two.", language="en", engine="kyutai")
    plain = _make_cache_key("kyutai", req, "One. Two.")
    paused = _make_cache_key("kyutai", req, "One. Two.", ((DEFAULT_PAUSE_MS,), None))
    paced = _make_cache_key("kyutai", req, "One. Two.", ((), 0.92))
    assert plain != paused
    assert plain != paced
    assert paused != paced


def test_fish_style_scoped_tags_are_performed_not_spoken():
    quiet = parse_stage_directions("<whisper>Keep this quiet.</whisper>")
    assert quiet.spoken == "Keep this quiet."
    assert "<" not in quiet.spoken and "whisper" not in quiet.spoken
    assert suggested_rate(quiet.tone) == 0.96

    quick = parse_stage_directions("<fast>Say this faster.</fast>")
    assert quick.spoken == "Say this faster."
    assert suggested_rate(quick.tone) == 1.04

    mixed = parse_stage_directions(
        "<soft>Soft words.</soft> <forceful>Loud words.</forceful>"
    )
    assert mixed.spoken == "Soft words. Loud words."


def test_fish_style_parenthesised_tokens():
    script = parse_stage_directions("Hello. (break) Next part. (long-break) Final part.")
    assert script.segments == ("Hello.", "Next part.", "Final part.")
    assert script.gaps_ms == (DEFAULT_PAUSE_MS, LONG_PAUSE_MS)
    assert "break" not in script.spoken

    effects = parse_stage_directions("(laughing) Good morning. (whispering) It is a secret.")
    assert effects.spoken == "Good morning. It is a secret."
    assert "laughing" not in effects.spoken

    # Ordinary parentheses are part of the sentence and stay spoken.
    assert parse_stage_directions("Meet me (at noon).").spoken == "Meet me (at noon)."


def test_run_synthesis_sends_segments_and_explicit_pause_gaps(monkeypatch, tmp_path):
    monkeypatch.setattr(synth, "_ffmpeg_available", lambda: True)
    routed: list[str] = []

    def fake_single(engine, engine_name, text, language, ref_path, out, job_id,
                    speaking_rate=None, cancel_event=None):
        routed.append(text)
        Path(out).write_bytes(b"fake audio")
        return out

    stitched: dict = {}

    def fake_stitch(chunks, out_path, pause_ms, cancel_event, gaps_ms=None):
        stitched["chunks"] = list(chunks)
        stitched["gaps"] = gaps_ms
        Path(out_path).write_bytes(b"fake mp3")
        return out_path

    monkeypatch.setattr(synth, "_synthesize_single", fake_single)
    monkeypatch.setattr(synth, "_stitch_crossfade_cancellable", fake_stitch)

    raw_out = str(tmp_path / "out.wav")
    result = synth._run_synthesis(
        object(), "azure", "One. Two.", "en", None, raw_out, "job-1",
        segments=("One.", "Two."), gaps_ms=(900,),
    )

    assert routed == ["One.", "Two."]
    assert stitched["gaps"] == [900]
    assert len(stitched["chunks"]) == 2
    assert result.endswith(".mp3")
