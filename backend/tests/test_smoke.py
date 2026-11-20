"""Lightweight smoke tests for the backend API."""

import os

os.environ["PATH"] = r"C:\Users\Admin\ffmpeg;" + os.environ.get("PATH", "")

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["awake"] is True


def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_captions_preview_validation():
    r = client.post(
        "/api/v1/captions/preview",
        json={"script_text": "one two three", "voice_duration": 5.0, "words_per_chunk": 9},
    )
    assert r.status_code == 422


def test_packaging_clip_length_validation():
    r = client.post(
        "/api/v1/packaging/publish",
        data={"hook_words": "A B C", "clip_length_sec": "181"},
    )
    assert r.status_code in (400, 422)
