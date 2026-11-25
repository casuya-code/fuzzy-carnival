"""Stage 0/1: shared text styles, presets and lower thirds."""

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.main import app
from app.routers.captions import _lower_third_or_400, _text_style_or_400
from app.services.captions_processor import generate_word_by_word_ass
from app.services.media_math import SAFE_ZONES
from app.services.packaging_processor import _make_banner
from app.services.text_styles import (
    DEFAULT_TEXT_STYLE,
    TEXT_STYLE_PRESETS,
    ass_color,
    normalize_lower_third,
    normalize_text_style,
    style_to_ass_style,
)

client = TestClient(app)


def test_default_style_stays_visually_compatible():
    zone = SAFE_ZONES["9:16"]
    line = style_to_ass_style("ViralCap", normalize_text_style(DEFAULT_TEXT_STYLE), zone)
    assert line == (
        f"Style: ViralCap,DejaVu Sans,{zone['font']},&H00FFFFFF&,&H0000FFFF&,"
        f"&H00000000&,&H80000000&,-1,0,0,0,100,100,0,0,1,5,2,"
        f"{zone['align']},{zone['ml']},{zone['mr']},{zone['mv']},1"
    )


def test_default_ass_dialogue_uses_legacy_colors(tmp_path):
    path = tmp_path / "default.ass"
    generate_word_by_word_ass(
        "one two", 2.0, str(path), intro_delay_sec=0.0,
        aspect_ratio="9:16", caption_style=DEFAULT_TEXT_STYLE,
    )
    text = path.read_text(encoding="utf-8")
    assert "{\\c&H00FFFF&}ONE{\\c&HFFFFFF&}" in text
    assert "Style: LowerThird" not in text


@pytest.mark.parametrize("preset", ["creator", "neon", "vintage", "bubble", "cute", "stencil", "boho"])
def test_presets_change_the_rendered_ass(preset, tmp_path):
    path = tmp_path / f"{preset}.ass"
    generate_word_by_word_ass(
        "one two", 2.0, str(path), intro_delay_sec=0.0,
        aspect_ratio="9:16", caption_style=TEXT_STYLE_PRESETS[preset],
    )
    text = path.read_text(encoding="utf-8")
    style = TEXT_STYLE_PRESETS[preset]
    assert f"Style: ViralCap,{style['font_family']}," in text
    expected_font = round(SAFE_ZONES["9:16"]["font"] * style["font_scale"] / 100)
    assert f",{expected_font}," in text
    assert f"\\c{ass_color(style['highlight_color'])}" in text


def test_invalid_style_fields_fall_back_and_bad_json_is_rejected():
    style = normalize_text_style({
        "font_family": "Bad,Font",
        "font_scale": 999,
        "outline_width": -4,
        "highlight_color": "red",
        "alignment": "sideways",
        "position": "somewhere",
        "bold": "yes",
    })
    assert style["font_family"] == "DejaVu Sans"
    assert style["font_scale"] == 140
    assert style["outline_width"] == 0
    assert style["highlight_color"] == "#FFFF00"
    assert style["alignment"] == "center"
    assert style["position"] == "bottom"
    assert style["bold"] is True
    with pytest.raises(ValueError):
        normalize_text_style("{not json")


def test_bad_style_json_becomes_400_at_the_api_boundary():
    for helper in (_text_style_or_400, _lower_third_or_400):
        with pytest.raises(HTTPException) as exc:
            helper("{not json")
        assert exc.value.status_code == 400


def test_lower_third_is_sanitized_and_rendered(tmp_path):
    lower = normalize_lower_third({
        "speaker": "  A {bold}\nB  ",
        "location": "Kili\\x",
        "topic": "Story" * 40,
    })
    assert lower["speaker"] == "A bold B"
    assert lower["location"] == "Kilix"
    assert len(lower["topic"]) == 80

    path = tmp_path / "lower.ass"
    generate_word_by_word_ass(
        "", 2.0, str(path), intro_delay_sec=0.0,
        aspect_ratio="9:16", lower_third=lower,
    )
    text = path.read_text(encoding="utf-8")
    assert "Style: LowerThird," in text
    assert "Dialogue: 0,0:00:00.00,0:00:05.00,LowerThird" in text
    assert "A bold B" in text
    assert "Kilix" in text


def test_preview_endpoint_accepts_style_and_lower_third():
    r = client.post(
        "/api/v1/captions/preview",
        json={
            "script_text": "one two three",
            "voice_duration": 5.0,
            "caption_style": TEXT_STYLE_PRESETS["neon"],
            "lower_third": {"speaker": "Amina", "topic": "Summit"},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["style"]["preset"] == "neon"
    assert body["style"]["font_family"] == "DejaVu Sans"
    assert body["lower_third"]["speaker"] == "Amina"
    assert body["lower_third"]["location"] == ""


def test_shorts_banner_reuses_shared_style_and_labels(tmp_path):
    plain = tmp_path / "plain.png"
    styled = tmp_path / "styled.png"
    _make_banner(str(plain), "PART 1: HOOK", "TITLE", "yellow", None)
    _make_banner(
        str(styled), "PART 1: HOOK", "TITLE", "yellow", None,
        style=TEXT_STYLE_PRESETS["neon"],
        lower_third={"speaker": "Amina", "location": "Kilimanjaro"},
    )
    assert plain.read_bytes() != styled.read_bytes()
    with Image.open(styled) as img:
        assert img.size == (1080, 180)
