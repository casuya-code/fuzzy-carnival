"""Shared, validated text styling for captions, titles and publish assets.

The frontend sends the resolved style object as JSON. Keeping validation here
means the ASS renderer and the Pillow thumbnail renderer use the same values,
while unknown/malformed fields fall back safely instead of reaching FFmpeg.
"""

from __future__ import annotations

import json
import re
from typing import Any

COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
FONT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .'_-]{0,59}$")

PRESET_IDS = {
    "default", "creator", "neon", "vintage", "bubble", "cute", "stencil",
    "boho", "custom",
}

DEFAULT_TEXT_STYLE: dict[str, Any] = {
    "preset": "default",
    "font_family": "DejaVu Sans",
    "font_scale": 100,
    "bold": True,
    "italic": False,
    "highlight_color": "#FFFF00",
    "base_color": "#FFFFFF",
    "outline_color": "#000000",
    "outline_width": 5,
    "background_color": "#000000",
    "background_opacity": 0,
    "alignment": "center",
    "position": "bottom",
    "rotation": 0,
    "letter_spacing": 0,
}

TEXT_STYLE_PRESETS: dict[str, dict[str, Any]] = {
    "default": DEFAULT_TEXT_STYLE,
    "creator": {
        **DEFAULT_TEXT_STYLE,
        "preset": "creator",
        "font_scale": 105,
        "highlight_color": "#FFD700",
        "outline_width": 6,
        "background_opacity": 55,
        "letter_spacing": 1,
    },
    "neon": {
        **DEFAULT_TEXT_STYLE,
        "preset": "neon",
        "font_scale": 108,
        "highlight_color": "#00FFFF",
        "base_color": "#FF66FF",
        "outline_color": "#101020",
        "outline_width": 7,
        "background_opacity": 65,
        "letter_spacing": 2,
    },
    "vintage": {
        **DEFAULT_TEXT_STYLE,
        "preset": "vintage",
        "font_family": "DejaVu Serif",
        "font_scale": 96,
        "bold": False,
        "highlight_color": "#F4C542",
        "base_color": "#F5E6C8",
        "outline_color": "#2B1B0E",
        "outline_width": 4,
        "background_color": "#1A1208",
        "background_opacity": 45,
    },
    "bubble": {
        **DEFAULT_TEXT_STYLE,
        "preset": "bubble",
        "font_scale": 112,
        "highlight_color": "#FF7AB8",
        "base_color": "#FFFFFF",
        "outline_color": "#6A1B4A",
        "outline_width": 8,
        "background_color": "#FFFFFF",
        "background_opacity": 25,
        "letter_spacing": 1,
    },
    "cute": {
        **DEFAULT_TEXT_STYLE,
        "preset": "cute",
        "font_scale": 103,
        "highlight_color": "#FFB3C7",
        "base_color": "#FFF7D6",
        "outline_color": "#5B3A29",
        "outline_width": 5,
        "background_color": "#FFF0D0",
        "background_opacity": 35,
    },
    "stencil": {
        **DEFAULT_TEXT_STYLE,
        "preset": "stencil",
        "font_family": "DejaVu Sans Mono",
        "font_scale": 100,
        "bold": True,
        "highlight_color": "#FF5A1F",
        "base_color": "#F2F2F2",
        "outline_color": "#000000",
        "outline_width": 6,
        "background_opacity": 60,
        "letter_spacing": 3,
    },
    "boho": {
        **DEFAULT_TEXT_STYLE,
        "preset": "boho",
        "font_family": "DejaVu Serif",
        "font_scale": 98,
        "bold": False,
        "italic": True,
        "highlight_color": "#E8B86D",
        "base_color": "#F7EFE2",
        "outline_color": "#3E2A1E",
        "outline_width": 4,
        "background_color": "#2A1B12",
        "background_opacity": 50,
        "letter_spacing": 1,
    },
}


def _as_dict(raw: Any, label: str) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{label} must be valid JSON") from exc
        raw = parsed
    if not isinstance(raw, dict):
        raise ValueError(f"{label} must be an object")
    return raw


def _number(value: Any, default: float, lo: float, hi: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float(default)
    if number != number:  # NaN
        return float(default)
    return max(lo, min(hi, number))


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value) if value is not None else default


def _color(value: Any, default: str) -> str:
    text = str(value or "").strip()
    if not COLOR_RE.match(text):
        return default
    return text.upper()


def normalize_text_style(raw: Any = None) -> dict[str, Any]:
    """Return a safe style object. Invalid fields fall back to defaults."""
    data = _as_dict(raw, "text_style")
    preset = str(data.get("preset") or "custom").strip().lower()
    if preset not in PRESET_IDS:
        preset = "custom"
    base = TEXT_STYLE_PRESETS.get(preset, DEFAULT_TEXT_STYLE)

    font_family = str(data.get("font_family", base["font_family"]) or "").strip()
    if not FONT_RE.match(font_family):
        font_family = base["font_family"]

    alignment = str(data.get("alignment", base["alignment"]) or "").strip().lower()
    if alignment not in {"left", "center", "right"}:
        alignment = base["alignment"]
    position = str(data.get("position", base["position"]) or "").strip().lower()
    if position not in {"top", "middle", "bottom"}:
        position = base["position"]

    return {
        "preset": preset,
        "font_family": font_family,
        "font_scale": int(_number(data.get("font_scale", base["font_scale"]), base["font_scale"], 70, 140)),
        "bold": _bool(data.get("bold", base["bold"]), base["bold"]),
        "italic": _bool(data.get("italic", base["italic"]), base["italic"]),
        "highlight_color": _color(data.get("highlight_color", base["highlight_color"]), base["highlight_color"]),
        "base_color": _color(data.get("base_color", base["base_color"]), base["base_color"]),
        "outline_color": _color(data.get("outline_color", base["outline_color"]), base["outline_color"]),
        "outline_width": int(_number(data.get("outline_width", base["outline_width"]), base["outline_width"], 0, 12)),
        "background_color": _color(data.get("background_color", base["background_color"]), base["background_color"]),
        "background_opacity": int(_number(data.get("background_opacity", base["background_opacity"]), base["background_opacity"], 0, 100)),
        "alignment": alignment,
        "position": position,
        "rotation": int(_number(data.get("rotation", base["rotation"]), base["rotation"], -30, 30)),
        "letter_spacing": int(_number(data.get("letter_spacing", base["letter_spacing"]), base["letter_spacing"], -10, 20)),
    }


def normalize_lower_third(raw: Any = None) -> dict[str, str]:
    """Return short, single-line lower-third fields."""
    data = _as_dict(raw, "lower_third")
    out: dict[str, str] = {}
    for key in ("speaker", "location", "topic"):
        value = str(data.get(key, "") or "").strip()
        value = re.sub(r"[\r\n]+", " ", value)
        value = re.sub(r"[{}\\]", "", value)
        out[key] = value[:80]
    return out


def has_lower_third(lower_third: dict[str, str] | None) -> bool:
    return bool(lower_third and any(lower_third.get(k) for k in ("speaker", "location", "topic")))


def ass_color(hex_color: str, alpha: int | None = None) -> str:
    """#RRGGBB -> ASS &HBBGGRR& (or &HAABBGGRR& when alpha is supplied)."""
    text = _color(hex_color, "#FFFFFF")
    r, g, b = (int(text[i:i + 2], 16) for i in (1, 3, 5))
    if alpha is None:
        return f"&H{b:02X}{g:02X}{r:02X}&"
    return f"&H{max(0, min(255, int(alpha))):02X}{b:02X}{g:02X}{r:02X}&"


def hex_rgb(hex_color: str) -> tuple[int, int, int]:
    text = _color(hex_color, "#FFFFFF")
    return (int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16))


def _alignment_code(position: str, alignment: str) -> int:
    row = {"top": 7, "middle": 4, "bottom": 1}[position]
    col = {"left": 0, "center": 1, "right": 2}[alignment]
    return row + col


def computed_font_size(style: dict[str, Any], zone: dict[str, Any], multiplier: float = 1.0) -> int:
    base = float(zone.get("font", 70))
    return max(10, int(round(base * style["font_scale"] / 100.0 * multiplier)))


def background_alpha(style: dict[str, Any]) -> int:
    """ASS alpha: 0 = opaque, 255 = transparent. Hidden boxes keep the legacy 0x80."""
    opacity = int(style["background_opacity"])
    if opacity <= 0:
        return 128
    if opacity >= 100:
        return 0
    return int(round(255 * (1 - opacity / 100.0)))


def style_to_ass_style(
    name: str,
    style: dict[str, Any],
    zone: dict[str, Any],
    *,
    font_multiplier: float = 1.0,
    position: str | None = None,
    alignment: str | None = None,
    background_opacity: int | None = None,
    margin_v: int | None = None,
) -> str:
    """Build one ASS Style line from a normalized shared style object."""
    pos = position or style["position"]
    align = alignment or style["alignment"]
    opacity = style["background_opacity"] if background_opacity is None else background_opacity
    render_style = {**style, "background_opacity": opacity}
    border_style = 3 if opacity > 0 else 1
    fields = [
        name,
        style["font_family"],
        str(computed_font_size(style, zone, font_multiplier)),
        ass_color(style["base_color"], 0),
        ass_color(style["highlight_color"], 0),
        ass_color(style["outline_color"], 0),
        ass_color(style["background_color"], background_alpha(render_style)),
        "-1" if style["bold"] else "0",
        "-1" if style["italic"] else "0",
        "0",  # underline
        "0",  # strikeout
        "100",  # scale X
        "100",  # scale Y
        str(style["letter_spacing"]),
        str(style["rotation"]),
        str(border_style),
        str(style["outline_width"]),
        "2",  # shadow
        str(_alignment_code(pos, align)),
        str(zone["ml"]),
        str(zone["mr"]),
        str(zone["mv"] if margin_v is None else margin_v),
        "1",  # encoding
    ]
    return "Style: " + ",".join(fields)


def style_summary(style: dict[str, Any], zone: dict[str, Any]) -> dict[str, Any]:
    """Style values returned by the preview endpoint (no ASS internals)."""
    return {
        "preset": style["preset"],
        "font_family": style["font_family"],
        "font_scale": style["font_scale"],
        "font_size": computed_font_size(style, zone),
        "bold": style["bold"],
        "italic": style["italic"],
        "play_res": [zone["w"], zone["h"]],
        "margin_l": zone["ml"],
        "margin_r": zone["mr"],
        "margin_v": zone["mv"],
        "highlight": ass_color(style["highlight_color"]),
        "base": ass_color(style["base_color"]),
        "outline_color": ass_color(style["outline_color"]),
        "outline": style["outline_width"],
        "background_color": style["background_color"],
        "background_opacity": style["background_opacity"],
        "alignment": style["alignment"],
        "position": style["position"],
        "rotation": style["rotation"],
        "letter_spacing": style["letter_spacing"],
    }
