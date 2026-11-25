"""Visual effect overlays for the video editor.

These are lightweight FFmpeg filter effects (no external assets).
"""

from __future__ import annotations

DEFAULT_OVERLAY = "none"
OVERLAY_IDS = ("none", "grain", "vignette", "lightleak", "snow")

OVERLAY_LABELS = {
    "none": "None",
    "grain": "Grain",
    "vignette": "Vignette",
    "lightleak": "Light leak",
    "snow": "Snow",
}

# Short UI notes; kept here so backend/frontend can stay aligned.
OVERLAY_NOTES = {
    "none": "No visual effect overlay.",
    "grain": "Film grain texture. Subtle, a bit slower.",
    "vignette": "Darkened edges. Fast.",
    "lightleak": "Soft warm wash. Slower.",
    "snow": "Falling noise specks. Slower.",
}


def normalize_overlay(value: str | None) -> str:
    name = str(value or DEFAULT_OVERLAY).strip().lower()
    if name not in OVERLAY_IDS:
        allowed = ", ".join(OVERLAY_IDS)
        raise ValueError(f"overlay must be one of {allowed}")
    return name


def overlay_filter(name: str | None) -> str | None:
    """Return an FFmpeg -vf filter fragment, or None for no overlay."""
    kind = normalize_overlay(name)
    if kind == "none":
        return None
    if kind == "grain":
        # Subtle luma/chroma noise; temporal flag gives film-like motion.
        return "noise=alls=12:allf=t+u"
    if kind == "vignette":
        return "vignette=angle=PI/4:mode=forward:eval=frame"
    if kind == "lightleak":
        # Soft warm wash; simple -vf compatible filter.
        return "eq=saturation=1.20:brightness=0.02,colorbalance=rs=0.08:gs=0.03:bs=-0.08:rm=0.05:gm=0.02:bm=-0.04"
    if kind == "snow":
        # Bright speckle noise; kept light so text remains readable.
        return "noise=alls=28:allf=t"
    return None