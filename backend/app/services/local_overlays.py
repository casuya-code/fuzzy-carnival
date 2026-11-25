"""Local image overlays for the video editor.

Users upload their own PNG/JPG/WebP badge; it is composited in the final FFmpeg
pass. No stock catalog, download or API key is involved.
"""

from __future__ import annotations

DEFAULT_OVERLAY_POSITION = "bottom-right"
DEFAULT_OVERLAY_SIZE = 18
DEFAULT_OVERLAY_OPACITY = 100

OVERLAY_POSITIONS = frozenset({
    "top-left", "top-right", "bottom-left", "bottom-right", "center",
})

ALLOWED_IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})


def normalize_overlay_position(value: str | None) -> str:
    """Return a supported corner/center placement or raise a user-facing error."""
    name = str(value or DEFAULT_OVERLAY_POSITION).strip().lower()
    if name not in OVERLAY_POSITIONS:
        allowed = ", ".join(sorted(OVERLAY_POSITIONS))
        raise ValueError(f"overlay_position must be one of {allowed}")
    return name


def normalize_overlay_size(value: object) -> int:
    """Overlay width as a percentage of the frame, clamped to 8–40."""
    try:
        size = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("overlay_size must be a number from 8 to 40") from exc
    return max(8, min(40, size))


def normalize_overlay_opacity(value: object) -> int:
    """Overlay opacity as a percentage, clamped to 10–100."""
    try:
        opacity = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("overlay_opacity must be a number from 10 to 100") from exc
    return max(10, min(100, opacity))


def build_overlay_filters(
    position: str,
    size: int,
    opacity: int,
    frame_w: int,
    frame_h: int,
) -> tuple[str, str]:
    """Return (image filter chain, placement filter chain).

    The image chain prepares `[2:v]` as `[ov]`; the placement chain composites
    `[vbase]` with it into `[vout]`. The box keeps max height at 35% so tall
    logos never cover captions.
    """
    place = normalize_overlay_position(position)
    width = normalize_overlay_size(size)
    alpha = normalize_overlay_opacity(opacity) / 100.0
    max_w = max(16, int(frame_w * width / 100.0))
    max_h = max(16, int(frame_h * 0.35))

    image_filter = (
        f"scale={max_w}:{max_h}:force_original_aspect_ratio=decrease,"
        "scale=trunc(iw/2)*2:trunc(ih/2)*2,"
        f"format=rgba,colorchannelmixer=aa={alpha:.2f}[ov]"
    )

    margin_x = "round(W*0.05)"
    margin_y = "round(H*0.05)"
    if place == "top-left":
        x, y = margin_x, margin_y
    elif place == "top-right":
        x, y = f"W-w-{margin_x}", margin_y
    elif place == "bottom-left":
        x, y = margin_x, f"H-h-{margin_y}"
    elif place == "bottom-right":
        x, y = f"W-w-{margin_x}", f"H-h-{margin_y}"
    else:
        x, y = "(W-w)/2", "(H-h)/2"

    placement_filter = f"[vbase][ov]overlay=x={x}:y={y}:format=auto[vout]"
    return image_filter, placement_filter
