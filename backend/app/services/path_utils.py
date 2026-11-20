"""Shared filesystem path helpers used by the cloud TTS engines."""

from pathlib import Path


def mp3_output_path(path: str) -> str:
    """Return the .mp3 filename for an output path (already-mp3 paths pass through)."""
    p = Path(path)
    if p.suffix.lower() == ".mp3":
        return str(p)
    return str(p.with_suffix(".mp3"))
