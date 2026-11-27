"""Audio join service and endpoint tests."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import storage
from app.services import audio_processor


client = TestClient(app)


@pytest.fixture(autouse=True)
def _auth_override():
    # Bypass auth/rate-limit for this router test; endpoint logic is under test.
    from app.auth import require_user
    from app.rate_limit import rate_limit

    app.dependency_overrides[require_user] = lambda: {"id": 1, "email": "t@example.com"}
    app.dependency_overrides[rate_limit] = lambda: None
    yield
    app.dependency_overrides.clear()


def test_join_audio_files_builds_ffmpeg_command(monkeypatch, tmp_path):
    calls: list[list[str]] = []

    def fake_run(cmd, stdout=None, stderr=None, check=None):
        calls.append(cmd)
        Path(cmd[-1]).write_bytes(b"joined")
        class R:
            returncode = 0
        return R()

    monkeypatch.setattr(audio_processor, "_ffmpeg_available", lambda: True)
    monkeypatch.setattr(audio_processor.subprocess, "run", fake_run)

    out = str(tmp_path / "joined.mp3")
    result = audio_processor.join_audio_files(
        ["a.mp3", "b.wav", "c.mp3"], out, gap_ms=500, crossfade_ms=0
    )

    assert result == out
    assert Path(out).exists()
    assert len(calls) == 1
    cmd = calls[0]
    assert cmd[0] == "ffmpeg"
    assert "concat=n=3:v=0:a=1[out]" in " ".join(cmd)
    assert "apad=pad_dur=0.5" in " ".join(cmd)
    assert cmd[-1] == out


def test_join_audio_files_rejects_empty():
    with pytest.raises(ValueError):
        audio_processor.join_audio_files([], "out.mp3")


def test_join_endpoint_validates_min_items():
    r = client.post("/api/v1/audio/join", json={"audio_keys": ["only-one.mp3"]})
    assert r.status_code == 422  # pydantic min_length=2


def test_join_endpoint_happy_path(monkeypatch, tmp_path):
    created = tmp_path / "joined.mp3"
    created.write_bytes(b"fake-mp3")

    def fake_resolve(key, dest=None):
        p = tmp_path / Path(key).name
        p.write_bytes(b"audio")
        return str(p)

    def fake_join(paths, output_path, gap_ms=0, crossfade_ms=0):
        Path(output_path).write_bytes(b"joined")
        return output_path

    monkeypatch.setattr(storage, "_ffmpeg_available", lambda: True)
    monkeypatch.setattr(storage, "_resolve_audio_key", fake_resolve)
    monkeypatch.setattr(storage, "join_audio_files", fake_join)
    monkeypatch.setattr(storage, "upload_output", lambda path, key: f"https://cdn.example/{key}")
    monkeypatch.setattr(storage, "get_duration", lambda path: 12.34)

    r = client.post("/api/v1/audio/join", json={
        "audio_keys": ["a.mp3", "b.mp3"],
        "gap_ms": 250,
        "crossfade_ms": 0,
        "output_format": "mp3",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["audio_url"] == "https://cdn.example/outputs/" + body["audio_r2_key"].split("/")[-1]
    assert body["duration_seconds"] == 12.34
    assert body["parts"] == 2
