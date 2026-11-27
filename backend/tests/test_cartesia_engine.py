"""Cartesia turns delivery hints into audible speed/emotion settings."""

from pathlib import Path

from app.engines import cartesia as cartesia_module
from app.engines.cartesia import CartesiaEngine


class _FakeResponse:
    status_code = 200
    text = ""

    def __init__(self, content: bytes = b"audio bytes"):
        self.content = content


def test_generation_config_carries_speed_and_emotion(monkeypatch, tmp_path):
    captured: dict = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured.update(json or {})
        return _FakeResponse()

    monkeypatch.setattr(cartesia_module, "CARTESIA_API_KEY", "test-key")
    monkeypatch.setattr(cartesia_module.requests, "post", fake_post)

    out = CartesiaEngine().synthesize(
        text="Keep this quiet.",
        output_path=str(tmp_path / "sample.wav"),
        speaking_rate=0.92,
        emotion="calm",
    )

    assert captured["generation_config"] == {"speed": 0.92, "emotion": "calm"}
    assert captured["transcript"] == "Keep this quiet."
    assert out.endswith(".mp3")
    assert Path(out).read_bytes() == b"audio bytes"


def test_neutral_delivery_omits_generation_config(monkeypatch, tmp_path):
    captured: dict = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured.update(json or {})
        return _FakeResponse()

    monkeypatch.setattr(cartesia_module, "CARTESIA_API_KEY", "test-key")
    monkeypatch.setattr(cartesia_module.requests, "post", fake_post)

    CartesiaEngine().synthesize(
        text="Hello.", output_path=str(tmp_path / "plain.mp3"), speaking_rate=None
    )

    assert "generation_config" not in captured
