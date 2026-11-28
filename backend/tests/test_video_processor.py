"""Unit tests for audio handling in the video processor."""

import app.services.video_processor as vp


def test_trim_keeps_clip_audio_when_requested(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(vp, "get_duration", lambda _: 3.0)
    monkeypatch.setattr(vp, "_has_audio_stream", lambda _: True)
    monkeypatch.setattr(vp, "run_ffmpeg", lambda cmd, **kwargs: commands.append(cmd))

    vp.trim_and_zoom_clip(
        str(tmp_path / "input.mp4"),
        str(tmp_path / "output.mp4"),
        keep_audio=True,
    )

    cmd = commands[0]
    assert "0:a:0?" in cmd
    assert "-an" not in cmd


def test_trim_generates_silence_for_clips_without_audio(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(vp, "get_duration", lambda _: 3.0)
    monkeypatch.setattr(vp, "_has_audio_stream", lambda _: False)
    monkeypatch.setattr(vp, "run_ffmpeg", lambda cmd, **kwargs: commands.append(cmd))

    vp.trim_and_zoom_clip(
        str(tmp_path / "input.mp4"),
        str(tmp_path / "output.mp4"),
        keep_audio=True,
    )

    cmd = commands[0]
    assert "anullsrc" in " ".join(cmd)
    assert "1:a:0" in cmd
    assert "-an" not in cmd


def test_stitch_without_unified_audio_crossfades_clip_audio(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(vp, "get_duration", lambda _: 3.0)
    monkeypatch.setattr(vp, "_has_audio_stream", lambda _: True)
    monkeypatch.setattr(vp, "run_ffmpeg", lambda cmd, **kwargs: commands.append(cmd))

    vp.stitch_clips_with_audio(
        [str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")],
        None,
        str(tmp_path / "final.mp4"),
        transition_sfx="off",
    )

    join_cmd, final_cmd = commands
    assert "[0:a:0][1:a:0]acrossfade=" in " ".join(join_cmd)
    assert "-an" not in join_cmd
    assert "-stream_loop" not in final_cmd
    assert "-shortest" not in final_cmd
    assert "-map" in final_cmd and "0:a:0" in final_cmd


def test_stitch_with_unified_audio_keeps_existing_loop_and_shortest(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(vp, "get_duration", lambda _: 3.0)
    monkeypatch.setattr(vp, "run_ffmpeg", lambda cmd, **kwargs: commands.append(cmd))

    vp.stitch_clips_with_audio(
        [str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")],
        str(tmp_path / "voice.mp3"),
        str(tmp_path / "final.mp4"),
        transition_sfx="off",
    )

    final_cmd = commands[-1]
    assert "-stream_loop" in final_cmd
    assert str(tmp_path / "voice.mp3") in final_cmd
    assert "-shortest" in final_cmd
