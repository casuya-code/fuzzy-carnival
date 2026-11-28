"""Background video jobs keep every render option while adding progress/cancel."""

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.video_jobs import VideoJobStore
from app.services.video_processor import preview_dims
import app.routers.video as video
import app.routers.video_jobs as vj


@pytest.fixture()
def client():
    # Entering the context keeps a single event-loop portal alive, so the
    # asyncio.create_task() background render is not cancelled between requests.
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers(tmp_path, monkeypatch):
    import app.services.user_store as us

    monkeypatch.setattr(us, "APP_DB_PATH", str(tmp_path / "auth.db"))
    us.init_db()
    user = us.create_user("video@example.com", "password123")
    return {"Authorization": f"Bearer {us.create_access_token(user)}"}


@pytest.fixture()
def fake_render(monkeypatch):
    captured: dict = {}
    store = VideoJobStore()

    monkeypatch.setattr(vj, "_media_tools_available", lambda: True)
    monkeypatch.setattr(vj, "get_video_job_store", lambda: store)
    monkeypatch.setattr(video, "_media_tools_available", lambda: True)
    monkeypatch.setattr(video, "_beat_sync_zoom", lambda **kwargs: (None, None))

    def trim(**kwargs):
        captured.setdefault("trim", []).append(kwargs)
        Path(kwargs["output_path"]).write_bytes(b"clip")
        return kwargs["output_path"]

    def stitch(paths, *rest, **kwargs):
        final = rest[-1] if rest else str(Path(paths[0]).with_name("final.mp4"))
        audio_path = rest[0] if len(rest) >= 2 else None
        call = {"paths": list(paths), "audio_path": audio_path, **kwargs}
        captured["stitch"] = call
        captured.setdefault("stitch_calls", []).append(call)
        Path(final).write_bytes(b"final")
        return final

    def upload(path, key):
        captured["upload_key"] = key
        return f"https://example.test/{key}"

    def download(key, dest=None):
        if dest is None:
            return f"https://example.test/{key}"
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(b"segment")
        return str(dest)

    monkeypatch.setattr(video, "trim_and_zoom_clip", trim)
    monkeypatch.setattr(video, "stitch_clips_with_audio", stitch)
    monkeypatch.setattr(video, "stitch_clips_with_clip_audio", stitch)
    monkeypatch.setattr(video, "stitch_silent_clips", stitch)
    monkeypatch.setattr(video, "upload_output", upload)
    monkeypatch.setattr(video, "download_reference", download)
    monkeypatch.setattr(video, "get_duration", lambda _: 1.0)
    return captured, store


def _clip_files():
    return [
        ("clips", ("a.mp4", b"a", "video/mp4")),
        ("clips", ("b.mp4", b"b", "video/mp4")),
    ]


def _files():
    return _clip_files() + [
        ("audio", ("voice.mp3", b"v", "audio/mpeg")),
    ]


def _wait(client, job_id, headers, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/v1/video/jobs/{job_id}", headers=headers).json()
        if body["status"] in ("succeeded", "failed", "cancelled"):
            return body
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_process_job_forwards_every_option(client, fake_render, auth_headers):
    captured, _ = fake_render
    r = client.post(
        "/api/v1/video/jobs/process",
        files=_files(),
        data={
            "aspect_ratio": "1:1",
            "trim_end_sec": "0.5",
            "topic": "Test",
            "language": "sw",
            "upscale_2k": "false",
            "preview": "true",
            "loudnorm": "true",
            "transition": "fade",
            "transition_sfx": "whoosh",
            "transition_sfx_level": "55",
            "overlay": "vignette",
            "overlay_position": "center",
            "overlay_size": "20",
            "overlay_opacity": "80",
        },
        headers=auth_headers,
    )
    assert r.status_code == 202, r.text
    body = _wait(client, r.json()["job_id"], auth_headers)
    assert body["status"] == "succeeded", body
    assert body["result"]["preview"] is True
    assert captured["trim"][0]["preview"] is True
    assert captured["trim"][0]["aspect_ratio"] == "1:1"
    assert captured["stitch"]["preview"] is True
    assert captured["stitch"]["upscale_2k"] is False
    assert captured["stitch"]["loudnorm"] is True
    assert captured["stitch"]["transition_sfx"] == "whoosh"
    assert captured["stitch"]["transition_sfx_level"] == 55
    assert captured["stitch"]["overlay"] == "vignette"
    assert captured["stitch"]["overlay_position"] == "center"
    assert captured["stitch"]["overlay_size"] == 20
    assert captured["stitch"]["overlay_opacity"] == 80
    assert captured["stitch"]["transition"] == "fade"


def test_batch_job_returns_reusable_intermediate(client, fake_render, auth_headers):
    captured, _ = fake_render
    r = client.post(
        "/api/v1/video/jobs/process-batch",
        files=_files(),
        data={"aspect_ratio": "9:16", "transition": "fade", "overlay": "none", "preview": "true"},
        headers=auth_headers,
    )
    assert r.status_code == 202, r.text
    body = _wait(client, r.json()["job_id"], auth_headers)
    assert body["status"] == "succeeded", body
    assert body["result"]["intermediate"] is True
    assert body["result"]["video_r2_key"]
    assert captured["trim"][0]["preview"] is True


def test_process_job_allows_clips_without_unified_audio(client, fake_render, auth_headers):
    captured, _ = fake_render
    r = client.post(
        "/api/v1/video/jobs/process",
        files=_clip_files(),
        data={"aspect_ratio": "9:16", "transition": "fade"},
        headers=auth_headers,
    )
    assert r.status_code == 202, r.text
    body = _wait(client, r.json()["job_id"], auth_headers)
    assert body["status"] == "succeeded", body
    assert all(call["keep_audio"] is True for call in captured["trim"])
    assert captured["stitch"]["audio_path"] is None


def test_batch_job_keep_audio_preserves_clip_audio(client, fake_render, auth_headers):
    captured, _ = fake_render
    r = client.post(
        "/api/v1/video/jobs/process-batch",
        files=_clip_files(),
        data={
            "aspect_ratio": "9:16",
            "transition": "fade",
            "keep_audio": "true",
        },
        headers=auth_headers,
    )
    assert r.status_code == 202, r.text
    body = _wait(client, r.json()["job_id"], auth_headers)
    assert body["status"] == "succeeded", body
    assert all(call["keep_audio"] is True for call in captured["trim"])
    assert captured["stitch"]["audio_path"] is None


def test_finalize_job_allows_segments_without_unified_audio(client, fake_render, auth_headers):
    captured, _ = fake_render
    r = client.post(
        "/api/v1/video/jobs/finalize",
        data={"video_r2_keys": '["a.mp4", "b.mp4"]', "transition": "fade"},
        headers=auth_headers,
    )
    assert r.status_code == 202, r.text
    body = _wait(client, r.json()["job_id"], auth_headers)
    assert body["status"] == "succeeded", body
    assert captured["stitch"]["audio_path"] is None


def test_invalid_options_fail_before_job_creation(client, fake_render, auth_headers):
    r = client.post(
        "/api/v1/video/jobs/process",
        files=_files(),
        data={"aspect_ratio": "4:3"},
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_cancel_queued_job(client, fake_render, monkeypatch, auth_headers):
    async def no_execute(*args, **kwargs):
        return None

    monkeypatch.setattr(vj, "_execute", no_execute)
    r = client.post("/api/v1/video/jobs/process", files=_files(), headers=auth_headers)
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    cancelled = client.delete(f"/api/v1/video/jobs/{job_id}", headers=auth_headers)
    assert cancelled.status_code == 200
    status = client.get(f"/api/v1/video/jobs/{job_id}", headers=auth_headers)
    assert status.json()["status"] == "cancelled"


def test_concurrency_cap_returns_429(client, fake_render, monkeypatch, auth_headers):
    _, store = fake_render
    monkeypatch.setattr(store, "acquire_slot", lambda: False)
    r = client.post("/api/v1/video/jobs/process", files=_files(), headers=auth_headers)
    assert r.status_code == 429


def test_preview_dimensions_are_low_res_but_keep_aspect_ratio():
    assert preview_dims("16:9")[0] == 480
    assert preview_dims("9:16")[0] == 480
    assert preview_dims("16:9")[1] < preview_dims("9:16")[1]
