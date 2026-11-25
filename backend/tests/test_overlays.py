"""Stage 4: local image overlay validation and FFmpeg placement."""

import io
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.routers.video import _save_overlay_upload
from app.services.local_overlays import (
    DEFAULT_OVERLAY_OPACITY,
    DEFAULT_OVERLAY_POSITION,
    DEFAULT_OVERLAY_SIZE,
    build_overlay_filters,
    normalize_overlay_opacity,
    normalize_overlay_position,
    normalize_overlay_size,
)


def test_overlay_defaults_and_validation():
    assert normalize_overlay_position(None) == DEFAULT_OVERLAY_POSITION
    assert normalize_overlay_position(" TOP-LEFT ") == "top-left"
    assert normalize_overlay_size(999) == 40
    assert normalize_overlay_size(1) == 8
    assert normalize_overlay_opacity(999) == 100
    assert normalize_overlay_opacity(1) == 10
    with pytest.raises(ValueError):
        normalize_overlay_position("sideways")
    with pytest.raises(ValueError):
        normalize_overlay_size("wide")
    with pytest.raises(ValueError):
        normalize_overlay_opacity("clear")


def test_overlay_filters_are_placed_and_scaled():
    image, placement = build_overlay_filters("bottom-right", 20, 50, 1080, 1920)
    assert "scale=216:672:force_original_aspect_ratio=decrease" in image
    assert "format=rgba,colorchannelmixer=aa=0.50[ov]" in image
    assert "overlay=x=W-w-round(W*0.05):y=H-h-round(H*0.05)" in placement
    assert placement.endswith("[vout]")

    _image, center = build_overlay_filters("center", 18, 100, 1920, 1080)
    assert "overlay=x=(W-w)/2:y=(H-h)/2" in center


def test_overlay_upload_rejects_wrong_files(tmp_path: Path):
    bad = UploadFile(
        filename="notes.txt",
        file=io.BytesIO(b"not an image"),
        headers=Headers({"content-type": "text/plain"}),
    )
    with pytest.raises(HTTPException) as exc:
        _save_overlay_upload(bad, tmp_path, "job")
    assert exc.value.status_code == 400


def test_overlay_upload_saves_valid_image(tmp_path: Path):
    good = UploadFile(
        filename="badge.PNG",
        file=io.BytesIO(b"\x89PNG\r\n\x1a\n"),
        headers=Headers({"content-type": "image/png"}),
    )
    saved = _save_overlay_upload(good, tmp_path, "job")
    assert saved is not None
    assert Path(saved).name == "overlay_job.png"
    assert Path(saved).read_bytes() == b"\x89PNG\r\n\x1a\n"
