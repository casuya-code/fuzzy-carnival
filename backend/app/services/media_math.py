"""Shared video geometry helpers for the caption and video processors."""

# Safe-zone presets (PlayRes + margins). For 9:16 the bottom ~380-450px are
# covered by platform UI and the right ~150px by like/share buttons, so captions
# are locked into the clean center-lower zone via MarginV=520 / MarginR=160.
SAFE_ZONES = {
    "9:16": {"w": 1080, "h": 1920, "font": 78, "ml": 90, "mr": 160, "mv": 520, "align": 2},
    "1:1": {"w": 1080, "h": 1080, "font": 72, "ml": 80, "mr": 80, "mv": 180, "align": 2},
    "16:9": {"w": 1920, "h": 1080, "font": 68, "ml": 140, "mr": 140, "mv": 120, "align": 2},
}

DEFAULT_ASPECT_RATIO = "9:16"


def upscale_dims(aspect_ratio: str | None, upscale_2k: bool) -> tuple[int, int] | None:
    """Target (width, height) for a 2K social export, or None when not upscaling."""
    if not upscale_2k:
        return None
    ar = aspect_ratio or DEFAULT_ASPECT_RATIO
    if ar == "16:9":
        return (2560, 1440)
    if ar == "9:16":
        return (1440, 2560)
    if ar == "1:1":
        return (1440, 1440)
    zone = SAFE_ZONES.get(ar, SAFE_ZONES[DEFAULT_ASPECT_RATIO])
    return (zone["w"], zone["h"])
