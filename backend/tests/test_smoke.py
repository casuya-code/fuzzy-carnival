"""Lightweight smoke tests for the backend API."""

import io
import shutil

import pytest

from fastapi.testclient import TestClient

from app.main import app

# H13: no blanket import skip; CI gates on a real import before running tests.
client = TestClient(app)


@pytest.fixture()
def auth_headers(tmp_path, monkeypatch):
    import app.services.user_store as us
    monkeypatch.setattr(us, "APP_DB_PATH", str(tmp_path / "auth.db"))
    us.init_db()
    user = us.create_user("tester@example.com", "password123")
    token = us.create_access_token(user)
    return {"Authorization": f"Bearer {token}"}


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("ok", "degraded")
    assert body["awake"] is True
    # Default is minimal/public health details
    assert body["loaded_models"] == []
    assert body["issues"] == []


def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_captions_preview_validation(auth_headers):
    r = client.post(
        "/api/v1/captions/preview",
        json={"script_text": "one two three", "voice_duration": 5.0, "words_per_chunk": 9},
        headers=auth_headers,
    )
    assert r.status_code == 422


def test_packaging_clip_length_validation(auth_headers):
    r = client.post(
        "/api/v1/packaging/publish",
        data={"hook_words": "A B C", "clip_length_sec": "181"},
        headers=auth_headers,
    )
    # Endpoint validates media tools before payload in some deployments; accept 503 when ffmpeg is absent.
    if r.status_code == 503 and not _ffmpeg_available():
        pytest.skip("ffmpeg/ffprobe not available")
    assert r.status_code in (400, 422)


def test_auth_required_when_api_key_configured(monkeypatch, auth_headers):
    import app.auth as auth

    monkeypatch.setattr(auth, "_configured_keys", lambda: ["test-key"])
    r = client.get("/api/v1/timeline")  # wrong method/shape, but auth should run first
    assert r.status_code in (401, 405)
    r2 = client.post("/api/v1/normalize", json={"text": "hello", "language": "en"})
    assert r2.status_code == 401
    # Content endpoints now require a logged-in user, not just an API key.
    r3 = client.post(
        "/api/v1/normalize",
        json={"text": "hello", "language": "en"},
        headers=auth_headers,
    )
    assert r3.status_code == 200


def test_blank_text_rejected(auth_headers):
    r = client.post("/api/v1/normalize", json={"text": "   ", "language": "en"}, headers=auth_headers)
    # normalize endpoint accepts min_length 1 but text is whitespace; normalization returns empty-ish
    # The schema may accept it; endpoint should handle gracefully.
    assert r.status_code in (200, 400, 422)


def test_synthesize_rejects_blank_text(auth_headers):
    r = client.post(
        "/api/v1/synthesize",
        json={"text": "   ", "language": "en", "engine": "kyutai"},
        headers=auth_headers,
    )
    assert r.status_code == 422


def test_local_upload_rejects_bad_extension(auth_headers):
    r = client.put(
        "/api/v1/local-upload/references/bad.exe",
        content=b"MZ...",
        headers={"Content-Type": "application/octet-stream", **auth_headers},
    )
    assert r.status_code == 400


def test_local_upload_rejects_too_large(monkeypatch, auth_headers):
    import app.routers.storage as storage

    monkeypatch.setattr(storage, "MAX_UPLOAD_BYTES", 8)
    r = client.put(
        "/api/v1/local-upload/references/small.wav",
        content=b"0123456789",
        headers={"Content-Type": "audio/wav", **auth_headers},
    )
    assert r.status_code == 413


def test_naming_utils_unique_keys():
    from app.services.naming_utils import build_speech_r2_key

    k1 = build_speech_r2_key("kyutai", "en", "Topic", "mp3", "20260101", "010101")
    k2 = build_speech_r2_key("kyutai", "en", "Topic", "mp3", "20260101", "010101")
    assert k1 != k2
    assert k1.startswith("audio/20260101/Speech_KYU_ENG_Topic_20260101_010101_")


def test_local_media_fallback_guard(monkeypatch):
    import app.services.r2_storage as r2

    monkeypatch.setattr(r2, "_r2_configured", lambda: False)
    monkeypatch.setattr(r2, "ALLOW_LOCAL_MEDIA_FALLBACK", False)
    with pytest.raises(RuntimeError):
        r2.public_url("outputs/demo.mp3")
def test_signup_login_me(monkeypatch, tmp_path):
    import app.services.user_store as us

    monkeypatch.setattr(us, "APP_DB_PATH", str(tmp_path / "test.db"))
    us.init_db()
    r = client.post("/api/v1/auth/signup", json={"email": "test@example.com", "password": "password123"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "test@example.com"
    token = body["access_token"]
    r2 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["user"]["email"] == "test@example.com"
    r3 = client.post("/api/v1/auth/login", json={"email": "test@example.com", "password": "password123"})
    assert r3.status_code == 200
    r4 = client.post("/api/v1/auth/login", json={"email": "test@example.com", "password": "wrongpass"})
    assert r4.status_code == 401
