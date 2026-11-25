"""Locally generated transition sound effects.

No stock audio, downloads or API keys: short waveforms are synthesized with the
Python standard library and written as a small WAV bed aligned to xfade events.
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

from app.services.video_transitions import transition_events

SFX_IDS: frozenset[str] = frozenset({"off", "whoosh", "pop", "click", "lift"})
DEFAULT_SFX = "off"
DEFAULT_SFX_LEVEL = 40
SAMPLE_RATE = 44100


def normalize_sfx(value: str | None) -> str:
    """Return a supported SFX id or raise a user-facing ValueError."""
    name = str(value or DEFAULT_SFX).strip().lower()
    if name not in SFX_IDS:
        allowed = ", ".join(sorted(SFX_IDS))
        raise ValueError(f"transition_sfx must be one of {allowed}")
    return name


def normalize_sfx_level(value: object) -> int:
    """Clamp the SFX level to 0–100."""
    try:
        level = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("transition_sfx_level must be a number from 0 to 100") from exc
    return max(0, min(100, level))


def _render(kind: str, duration_sec: float, seed: int) -> list[float]:
    """Render one short effect at SAMPLE_RATE."""
    count = max(1, int(max(0.02, duration_sec) * SAMPLE_RATE))
    out = [0.0] * count
    rng = random.Random(seed)

    if kind == "whoosh":
        lowpass = 0.0
        for i in range(count):
            t = i / count
            cutoff = 0.02 + 0.34 * math.sin(math.pi * t) ** 2
            lowpass += (rng.uniform(-1.0, 1.0) - lowpass) * cutoff
            envelope = math.sin(math.pi * t) ** 1.5
            out[i] = lowpass * envelope * 0.9
        return out

    if kind == "pop":
        phase = 0.0
        for i in range(count):
            t = i / count
            frequency = 110.0 + 780.0 * math.exp(-8.0 * t)
            phase += 2.0 * math.pi * frequency / SAMPLE_RATE
            envelope = math.exp(-7.0 * t) * min(1.0, i / (SAMPLE_RATE * 0.004))
            out[i] = math.sin(phase) * envelope * 0.8
        return out

    if kind == "click":
        tail = min(count, int(0.09 * SAMPLE_RATE))
        previous = 0.0
        for i in range(tail):
            t = i / (SAMPLE_RATE * 0.09)
            noise = rng.uniform(-1.0, 1.0)
            highpass = noise - previous
            previous = noise
            out[i] = highpass * math.exp(-45.0 * t) * 0.6
        return out

    # lift: a short rising two-note swell.
    phase_a = phase_b = 0.0
    for i in range(count):
        t = i / count
        phase_a += 2.0 * math.pi * (440.0 + 220.0 * t) / SAMPLE_RATE
        phase_b += 2.0 * math.pi * (660.0 + 330.0 * t) / SAMPLE_RATE
        envelope = math.sin(math.pi * t) ** 2
        out[i] = (math.sin(phase_a) + math.sin(phase_b)) * envelope * 0.35
    return out


def generate_sfx_bed(
    output_path: str | Path,
    durations: list[float],
    transitions: list[str],
    transition_duration_sec: float,
    sfx: str,
    level: int,
    loop_duration_sec: float,
) -> bool:
    """Write a looping mono WAV bed; return False when no audio is needed."""
    kind = normalize_sfx(sfx)
    volume = normalize_sfx_level(level)
    if kind == "off" or volume <= 0:
        return False

    events = transition_events(durations, transitions, transition_duration_sec)
    if not events:
        return False

    total = max(1, int(max(0.1, loop_duration_sec) * SAMPLE_RATE))
    buffer = [0.0] * total
    for index, (_name, offset, overlap) in enumerate(events):
        sound = _render(kind, overlap, 1000 + index)
        start = int(offset * SAMPLE_RATE)
        for i, sample in enumerate(sound):
            position = (start + i) % total
            buffer[position] += sample

    peak = max(1e-6, max(abs(sample) for sample in buffer))
    scale = (volume / 100.0) * 0.55 / peak
    with wave.open(str(output_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(
            b"".join(
                struct.pack("<h", int(max(-1.0, min(1.0, sample * scale)) * 32767))
                for sample in buffer
            )
        )
    return True
