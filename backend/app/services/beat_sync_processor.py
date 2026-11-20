"""Lightweight BPM detection and beat-synced zoom expressions.

Uses FFmpeg + NumPy only (no librosa/numba), keeping RAM usage low on the
$5 Railway container.
"""

import subprocess
import wave
from pathlib import Path

import numpy as np


def detect_bpm_lightweight(music_path: str) -> float:
    """Ultra-lightweight BPM detector using FFmpeg PCM extraction + NumPy.

    Scans the first 30s of the music track and returns the dominant BPM.
    """
    temp_wav = str(Path(music_path).with_name("temp_beat_scan.wav"))
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-t", "30", "-i", music_path,
             "-ar", "8000", "-ac", "1", temp_wav],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        )
        with wave.open(temp_wav, "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
    finally:
        Path(temp_wav).unlink(missing_ok=True)

    if audio.size == 0:
        return 120.0

    hop = 400  # 50ms at 8000Hz
    energy = np.array(
        [np.sum(audio[i:i + hop] ** 2) for i in range(0, len(audio) - hop, hop)],
        dtype=np.float64,
    )
    if energy.size < 4:
        return 120.0
    diff = np.maximum(0.0, np.diff(energy))

    autocorr = np.correlate(diff, diff, mode="full")[len(diff) - 1:]
    min_lag = int((60.0 / 160.0) / 0.05)  # 160 BPM
    max_lag = int((60.0 / 70.0) / 0.05)   # 70 BPM
    min_lag = max(1, min(min_lag, len(autocorr) - 1))
    max_lag = max(min_lag + 1, min(max_lag, len(autocorr)))
    best_lag = min_lag + int(np.argmax(autocorr[min_lag:max_lag]))
    if best_lag <= 0:
        return 120.0
    bpm = 60.0 / (best_lag * 0.05)
    return round(float(bpm), 1)


def get_beat_synced_zoom_expr(
    bpm: float, fps: int = 30, beats_per_cut: int = 4
) -> tuple[str, float]:
    """Return an FFmpeg zoompan expression synced to the music's BPM.

    Also returns the ideal clip-cut duration (clamped to 1.5s-3.0s).
    """
    sec_per_beat = 60.0 / max(bpm, 1.0)
    cycle_sec = sec_per_beat * beats_per_cut

    while cycle_sec < 1.5:
        cycle_sec *= 2
    while cycle_sec > 3.0:
        cycle_sec /= 2

    cycle_frames = max(15, int(round(cycle_sec * fps)))
    zoom_expr = f"1.0+0.14*(mod(on,{cycle_frames})/{cycle_frames})"
    return zoom_expr, round(cycle_sec, 2)
