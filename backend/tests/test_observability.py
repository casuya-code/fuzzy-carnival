"""Timing metrics are stored in-process and exposed without leaking user data."""

import pytest
from fastapi.testclient import TestClient

from app import observability
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_metrics():
    observability.reset()
    yield
    observability.reset()


@pytest.fixture()
def auth_headers(tmp_path, monkeypatch):
    import app.services.user_store as us

    monkeypatch.setattr(us, "APP_DB_PATH", str(tmp_path / "auth.db"))
    us.init_db()
    user = us.create_user("metrics@example.com", "password123")
    return {"Authorization": f"Bearer {us.create_access_token(user)}"}


def test_record_logs_and_aggregates():
    observability.record("tts.model_load", 12.5, engine="kyutai")
    observability.record("tts.model_load", 7.5, engine="kyutai")
    data = observability.summary()["tts.model_load"]
    assert data["count"] == 2
    assert data["avg_ms"] == 10.0
    assert data["max_ms"] == 12.5
    assert data["last_ms"] == 7.5


def test_metrics_endpoint_ingests_sanitized_samples(auth_headers):
    r = client.post(
        "/api/v1/metrics",
        json={
            "event": "page.load",
            "duration_ms": 321.5,
            "fields": {"kind": "navigate", "secret": "drop-me", "engine": "kyutai"},
        },
        headers=auth_headers,
    )
    assert r.status_code == 200
    summary = observability.summary()["page.load"]
    assert summary["count"] == 1
    # Only allow-listed fields are stored.
    assert "secret" not in repr(observability._samples)


def test_metrics_summary_endpoint(auth_headers):
    observability.record("video.render", 100, kind="process", status="ok")
    r = client.get("/api/v1/metrics", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["metrics"]["video.render"]["count"] == 1
