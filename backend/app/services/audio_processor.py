import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
from math import gcd

from app.config import TEMP_AUDIO_DIR


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _ffprobe_available() -> bool:
    return shutil.which("ffprobe") is not None


def _media_tools_available() -> bool:
    """True when both ffmpeg and ffprobe are installed (media pipelines need both)."""
    return _ffmpeg_available() and _ffprobe_available()


def _resample(data: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr:
        return data
    g = gcd(orig_sr, target_sr)
    up = target_sr // g
    down = orig_sr // g
    if data.ndim == 1:
        return resample_poly(data, up, down).astype(data.dtype)
    # resample along time axis (assume shape (channels, samples) or (samples, channels))
    if data.shape[0] <= 8 and data.shape[0] < data.shape[1]:
        # (channels, samples)
        return resample_poly(data, up, down, axis=1).astype(data.dtype)
    return resample_poly(data, up, down, axis=0).astype(data.dtype)


def _to_mono_s16(data: np.ndarray) -> np.ndarray:
    if data.ndim > 1:
        if data.shape[0] <= 8 and data.shape[0] < data.shape[1]:
            data = np.mean(data, axis=0)
        else:
            data = np.mean(data, axis=1)
    data = np.squeeze(data)
    # normalize float to int16
    if np.issubdtype(data.dtype, np.floating):
        peak = float(np.max(np.abs(data))) if data.size else 1.0
        if peak > 1.0:
            data = data / peak
        data = (data * 32767.0).clip(-32768, 32767).astype(np.int16)
    elif data.dtype != np.int16:
        # scale integer types
        info = np.iinfo(data.dtype) if np.issubdtype(data.dtype, np.integer) else None
        if info:
            data = (data.astype(np.float32) / max(info.max, 1) * 32767.0).clip(-32768, 32767).astype(np.int16)
        else:
            data = data.astype(np.int16)
    return data


def _trim_silence(data: np.ndarray, sr: int, threshold: float = 0.015, pad_ms: int = 120) -> np.ndarray:
    """Trim leading/trailing silence so voice conditioning focuses on speech."""
    if data.size == 0:
        return data
    x = data.astype(np.float32)
    if np.issubdtype(data.dtype, np.integer):
        x = x / 32768.0
    # smoothed energy envelope
    win = max(int(sr * 0.02), 1)
    energy = np.abs(x)
    if len(energy) > win:
        kernel = np.ones(win) / win
        smooth = np.convolve(energy, kernel, mode="same")
    else:
        smooth = energy
    mask = smooth > threshold
    if not mask.any():
        return data
    idx = np.where(mask)[0]
    pad = int(sr * pad_ms / 1000)
    start = max(0, int(idx[0]) - pad)
    end = min(len(data), int(idx[-1]) + pad)
    # keep at least 1s if possible
    if end - start < sr and len(data) >= sr:
        return data
    return data[start:end]


def _peak_normalize(data: np.ndarray, target: float = 0.92) -> np.ndarray:
    """Normalize peak level for consistent conditioning (avoid too quiet/loud)."""
    if data.size == 0:
        return data
    x = data.astype(np.float64)
    peak = float(np.max(np.abs(x)))
    if peak == 0:
        return data
    if np.issubdtype(data.dtype, np.integer):
        target_val = 32767.0 * target
    else:
        target_val = target
    # always scale to target for consistency (both quiet and hot inputs)
    x = x * (target_val / peak)
    if np.issubdtype(data.dtype, np.integer):
        return np.clip(x, -32768, 32767).astype(np.int16)
    return x.astype(np.float32)


def _denoise(data: np.ndarray, sr: int) -> np.ndarray:
    """Reduce stationary background noise for cleaner voice conditioning."""
    if data.size == 0:
        return data
    try:
        import noisereduce as nr
        # work in float32 for quality, preserve int16 if input was int16
        is_int16 = np.issubdtype(data.dtype, np.integer)
        y = data.astype(np.float32)
        if is_int16:
            y = y / 32768.0
        reduced = nr.reduce_noise(y=y, sr=sr, stationary=True, prop_decrease=0.8)
        if is_int16:
            reduced = np.clip(reduced * 32768.0, -32768, 32767).astype(np.int16)
        else:
            reduced = reduced.astype(np.float32)
        return reduced
    except Exception:
        # If denoise fails or lib unavailable, return original
        return data


def _clean_reference(data: np.ndarray, sr: int, denoise: bool = True) -> np.ndarray:
    data = _to_mono_s16(data)
    data = _trim_silence(data, sr)
    if denoise:
        data = _denoise(data, sr)
    data = _peak_normalize(data)
    return data


def _convert_with_av(input_path: str, output_path: str, sr: int = 24000, denoise: bool = True) -> str:
    import av

    container = av.open(input_path)
    audio_stream = next((s for s in container.streams if s.type == "audio"), None)
    if audio_stream is None:
        container.close()
        raise ValueError("No audio stream found")

    resampler = av.AudioResampler(format="s16", layout="mono", rate=sr)
    chunks = []
    for frame in container.decode(audio_stream):
        for rframe in resampler.resample(frame):
            arr = rframe.to_ndarray()
            # arr shape typically (1, samples) for mono s16
            chunks.append(np.asarray(arr).reshape(-1))
    # flush
    for rframe in resampler.resample(None):
        arr = rframe.to_ndarray()
        chunks.append(np.asarray(arr).reshape(-1))
    container.close()

    if not chunks:
        raise ValueError("No audio decoded")
    data = np.concatenate(chunks).astype(np.int16)
    data = _clean_reference(data, sr, denoise=denoise)
    wavfile.write(output_path, sr, data)
    return output_path


def _convert_with_soundfile(input_path: str, output_path: str, sr: int = 24000, denoise: bool = True) -> str:
    import soundfile as sf

    data, orig_sr = sf.read(input_path, always_2d=False)
    data = np.asarray(data)
    if data.ndim > 1:
        data = np.mean(data, axis=1)
    if orig_sr != sr:
        data = _resample(data.astype(np.float32), orig_sr, sr)
    data = _clean_reference(data, sr, denoise=denoise)
    wavfile.write(output_path, sr, data)
    return output_path


def normalize_reference(input_path: str, output_path: str, sr: int = 24000, denoise: bool = True) -> str:
    """Normalize reference audio to mono 24kHz 16-bit WAV with silence trim, optional denoise, and peak normalization."""
    if _ffmpeg_available():
        try:
            cmd = [
                "ffmpeg", "-nostdin", "-y", "-i", input_path,
                "-ac", "1", "-ar", str(sr), "-sample_fmt", "s16",
                output_path,
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            # Post-process: trim silence, denoise, and peak-normalize for stable conditioning
            try:
                rate, data = wavfile.read(output_path)
                data = _clean_reference(data, rate, denoise=denoise)
                wavfile.write(output_path, rate, data)
            except Exception:
                pass
            return output_path
        except Exception:
            pass

    # Fallback: PyAV (handles webm/opus from browser) - includes cleaning
    try:
        return _convert_with_av(input_path, output_path, sr, denoise=denoise)
    except Exception:
        pass

    # Fallback: soundfile - includes cleaning
    try:
        return _convert_with_soundfile(input_path, output_path, sr, denoise=denoise)
    except Exception:
        pass

    # Last resort: copy (may fail downstream if format unsupported)
    shutil.copyfile(input_path, output_path)
    return output_path


def to_mp3(input_path: str, output_path: str, bitrate: str = "128k") -> str:
    """Convert audio to mp3 for delivery."""
    if _ffmpeg_available():
        try:
            cmd = [
                "ffmpeg", "-nostdin", "-y", "-i", input_path,
                "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
                "-codec:a", "libmp3lame", "-b:a", bitrate,
                output_path,
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return output_path
        except Exception:
            pass
    # No ffmpeg: keep as-is (caller handles wav fallback)
    shutil.copyfile(input_path, output_path)
    return output_path


def analyze_reference(path: str) -> dict:
    """Analyze reference clip quality and return metrics + hints (non-throwing except unreadable).

    Accepts any container FFmpeg can decode: non-WAV input is converted to a
    temporary 16-bit WAV first (wavfile only reads WAV).
    """
    converted: str | None = None
    try:
        rate, data = wavfile.read(path)
    except Exception as first_error:
        if not _ffmpeg_available():
            raise ValueError(f"Could not read reference audio: {first_error}")
        fd, converted = tempfile.mkstemp(suffix=".wav", dir=str(TEMP_AUDIO_DIR))
        os.close(fd)
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-y", "-i", path, "-ac", "1", "-sample_fmt", "s16", converted],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            rate, data = wavfile.read(converted)
        except Exception:
            raise ValueError(f"Could not read reference audio: {first_error}")
        finally:
            try:
                Path(converted).unlink(missing_ok=True)
            except Exception:
                pass

    n = data.shape[0] if hasattr(data, "shape") else len(data)
    duration = n / float(rate) if rate else 0.0

    arr = data.astype(np.float64)
    if np.issubdtype(data.dtype, np.integer):
        denom = max(np.iinfo(data.dtype).max, 1)
        arr = arr / denom
    if arr.ndim > 1:
        arr = np.mean(arr, axis=1 if arr.shape[0] > arr.shape[1] else 0)
    arr = np.squeeze(arr)

    rms = float(np.sqrt(np.mean(arr ** 2))) if arr.size else 0.0
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    crest_db = float(20 * np.log10(peak / rms)) if rms > 1e-9 and peak > 0 else 0.0

    # Approx noise floor from quietest 10% frame energies
    snr_db = None
    if arr.size and rate:
        frame = max(int(rate * 0.02), 1)
        if len(arr) >= frame:
            nframes = len(arr) // frame
            energies = np.mean(arr[: nframes * frame].reshape(nframes, frame) ** 2, axis=1)
            energies = np.sort(energies)
            noise = float(np.mean(energies[: max(1, nframes // 10)]))
            sig = float(np.mean(energies))
            if noise > 1e-12:
                snr_db = float(10 * np.log10(max(sig, noise) / noise))

    clipping = peak >= 0.99
    hints = []
    score = 100
    if duration < 3:
        hints.append("Too short: record at least 10–15s for stable cloning.")
        score -= 40
    elif duration < 10:
        hints.append("Short sample: 10–15s recommended for best stability.")
        score -= 15
    if duration > 60:
        hints.append("Very long: 10–30s is usually sufficient.")
        score -= 10
    if rms < 0.005:
        hints.append("Too quiet/silent: move closer and speak with normal energy.")
        score -= 40
    elif rms < 0.02:
        hints.append("Low level: speak a bit louder or closer to the mic.")
        score -= 15
    if clipping:
        hints.append("Clipping detected: reduce input gain to avoid distortion.")
        score -= 20
    if snr_db is not None and snr_db < 12:
        hints.append("High background noise: record in a quieter space (denoise helps).")
        score -= 20
    elif snr_db is not None and snr_db < 20:
        hints.append("Some background noise present: quieter room will improve clones.")
        score -= 8
    if not hints:
        hints.append("Good sample quality: clear level and duration.")

    score = max(0, min(100, score))
    return {
        "duration": duration,
        "rms": rms,
        "peak": peak,
        "crest_db": crest_db,
        "snr_db": snr_db,
        "clipping": clipping,
        "quality_score": score,
        "hints": hints,
        "sample_rate": rate,
    }


def validate_reference(path: str, min_seconds: float = 3.0, max_seconds: float = 60.0) -> dict:
    """Quality gate for reference clips: length + not-silent.

    Returns analysis dict. Raises ValueError with a human-readable reason if unusable.
    """
    info = analyze_reference(path)
    duration = info["duration"]
    rms = info["rms"]

    if duration < min_seconds:
        raise ValueError(
            f"Reference clip is too short ({duration:.1f}s). Record at least "
            f"{int(min_seconds)} seconds of natural, energetic speech."
        )
    if duration > max_seconds:
        raise ValueError(
            f"Reference clip is too long ({duration:.0f}s). Keep it under "
            f"{int(max_seconds)} seconds."
        )
    if rms < 0.005:
        raise ValueError(
            "Reference clip appears silent or too quiet. Record closer to the "
            "microphone and speak with your normal energy."
        )
    return info


def get_duration(path: str) -> float:
    """Return media duration in seconds (ffprobe, then WAV header, else 0)."""
    if _ffprobe_available():
        try:
            out = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                capture_output=True, text=True, check=True,
            )
            return float(out.stdout.strip())
        except Exception:
            pass
    # Fallback: read wav header
    try:
        rate, data = wavfile.read(path)
        n = data.shape[0] if hasattr(data, "shape") else len(data)
        return float(n) / float(rate) if rate else 0.0
    except Exception:
        return 0.0


def _atempo_chain(speed: float) -> str | None:
    """Build ffmpeg atempo filter chain for tempo-preserving speed (supports 0.25-4.0)."""
    if abs(speed - 1.0) < 1e-3:
        return None
    speed = max(0.25, min(4.0, speed))
    factors = []
    s = speed
    # atempo supports 0.5..2.0 per filter
    while s > 2.0 + 1e-9:
        factors.append(2.0)
        s /= 2.0
    while s < 0.5 - 1e-9:
        factors.append(0.5)
        s /= 0.5
    factors.append(s)
    return ",".join(f"atempo={f:.5f}" for f in factors)


def transform_audio(
    input_path: str,
    output_path: str,
    speed: float = 1.0,
    volume: float = 1.0,
    output_format: str = "mp3",
) -> str:
    """Apply expert post-processing: tempo-preserving speed and volume; export as mp3/wav."""
    if not _ffmpeg_available():
        raise RuntimeError("FFmpeg required for audio transform")
    speed = float(max(0.25, min(4.0, speed)))
    volume = float(max(0.0, min(4.0, volume)))
    filters = []
    tempo = _atempo_chain(speed)
    if tempo:
        filters.append(tempo)
    if abs(volume - 1.0) > 1e-3:
        filters.append(f"volume={volume:.4f}")

    cmd = ["ffmpeg", "-nostdin", "-y", "-i", input_path]
    if filters:
        cmd += ["-af", ",".join(filters)]
    if output_format == "wav":
        cmd += ["-c:a", "pcm_s16le", "-ar", "44100", output_path]
    else:
        cmd += ["-c:a", "libmp3lame", "-b:a", "128k", output_path]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return output_path


def mix_voice_with_music(
    voice_path: str,
    output_path: str,
    music_path: str | None = None,
    music_volume: float = 0.18,
    intro_ms: int = 1500,
    outro_sec: float = 2.5,
    ambient_path: str | None = None,
    ambient_volume: float = 0.08,
) -> str:
    """
    Mix/master speech (Layer 1) with optional ambient texture (Layer 2, steady)
    and/or background music bed (Layer 3, sidechain auto-ducked by voice).
    Voice-only mastering (intro/outro + loudnorm) is supported when no backing layers.
    Loudness-normalized to ~ -16 LUFS. Requires FFmpeg.
    """
    if not _ffmpeg_available():
        raise RuntimeError("FFmpeg required for mixing")

    voice_dur = get_duration(voice_path)
    if voice_dur <= 0:
        raise RuntimeError("Could not determine voice track duration")
    total_dur = (intro_ms / 1000.0) + voice_dur + outro_sec
    fade_in_d = min(1.0, total_dur * 0.25) if total_dur > 0 else 0.0
    fade_out_d = min(2.0, total_dur * 0.25) if total_dur > 0 else 0.0
    fade_out_start = max(0.0, total_dur - fade_out_d)

    # Layer 1 (foreground): voice, clear/upfront
    filter_parts = [
        f"[0:a]aresample=44100,aformat=channel_layouts=stereo,"
        f"adelay={intro_ms}|{intro_ms},apad=pad_dur={outro_sec}[voice_padded]",
    ]
    if music_path:
        filter_parts.append(f"[voice_padded]asplit=2[voice_out][voice_trigger]")
    else:
        filter_parts.append(f"[voice_padded]anull[voice_out]")

    inputs = ["-i", voice_path]
    mix_inputs = ["[voice_out]"]
    next_idx = 1

    # Layer 3 (music bed): looped, ducked by voice via sidechaincompress
    if music_path:
        inputs += ["-stream_loop", "-1", "-i", music_path]
        filter_parts += [
            f"[{next_idx}:a]aresample=44100,aformat=channel_layouts=stereo,"
            f"volume={music_volume},atrim=0:{total_dur:.2f},"
            f"afade=t=in:st=0:d={fade_in_d:.3f},afade=t=out:st={fade_out_start:.3f}:d={fade_out_d:.3f}[music_base]",
            f"[music_base][voice_trigger]sidechaincompress="
            f"threshold=0.015:ratio=6:attack=40:release=350[music_ducked]",
        ]
        mix_inputs.append("[music_ducked]")
        next_idx += 1

    # Layer 2 (texture/atmosphere): looped, steady low level (no ducking)
    if ambient_path:
        inputs += ["-stream_loop", "-1", "-i", ambient_path]
        filter_parts += [
            f"[{next_idx}:a]aresample=44100,aformat=channel_layouts=stereo,"
            f"volume={ambient_volume},atrim=0:{total_dur:.2f},"
            f"afade=t=in:st=0:d={fade_in_d:.3f},afade=t=out:st={fade_out_start:.3f}:d={fade_out_d:.3f}[ambient]",
        ]
        mix_inputs.append("[ambient]")
        next_idx += 1

    fade = 0.020
    fade_out_start = max(0.0, total_dur - fade)
    filter_parts.append(
        f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:duration=first:normalize=0,"
        f"afade=t=in:st=0:d={fade:.3f},afade=t=out:st={fade_out_start:.3f}:d={fade:.3f},"
        f"loudnorm=I=-14:TP=-1.5:LRA=11[final]"
    )

    cmd = [
        "ffmpeg", "-nostdin", "-y",
        *inputs,
        "-filter_complex", ";".join(filter_parts),
        "-map", "[final]",
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        output_path,
    ]

    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return output_path


def stitch_audio_with_pauses(
    chunks: list[str],
    output_path: str,
    pause_ms: int = 400,
    gaps_ms: list[int] | None = None,
) -> str:
    """Concatenate audio chunks with a silence gap between them.

    Used for engines (e.g. MMS-TTS) that do not insert natural breaths, so
    long Swahili passages get audible pauses between sentences.

    ``gaps_ms`` optionally gives a per-boundary duration (len == len(chunks)-1)
    so pauses can follow punctuation: short at commas, long at sentence ends.
    """
    if not chunks:
        raise ValueError("No audio chunks to stitch")
    if len(chunks) == 1:
        import shutil

        shutil.copyfile(chunks[0], output_path)
        return output_path

    rate, first = wavfile.read(chunks[0])
    arrays = [np.asarray(first)]
    for i, c in enumerate(chunks[1:]):
        _, data = wavfile.read(c)
        data = np.asarray(data)
        if data.dtype != first.dtype:
            data = data.astype(first.dtype)
        if data.ndim != first.ndim:
            data = data.reshape(-1) if first.ndim == 1 else data
        this_pause = gaps_ms[i] if gaps_ms and i < len(gaps_ms) else pause_ms
        gap = np.zeros(int(rate * this_pause / 1000.0), dtype=first.dtype)
        arrays.append(gap)
        arrays.append(data)
    wavfile.write(output_path, rate, np.concatenate(arrays))
    return output_path


def stitch_voice_with_crossfades(
    voice_chunks: list[str],
    output_path: str,
    pause_ms: int = 220,
    crossfade_sec: float = 0.020,
) -> str:
    """Stitch TTS voice segments with natural pauses and 20ms micro-crossfades.

    Uses FFmpeg's native acrossfade filter directly on disk, keeping RAM usage
    near zero even for long 2.5-minute scripts.
    """
    if not voice_chunks:
        raise ValueError("No voice chunks to stitch")
    if len(voice_chunks) == 1:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-i", voice_chunks[0],
             "-c:a", "libmp3lame", "-b:a", "128k", output_path],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return output_path

    inputs: list[str] = []
    filter_parts: list[str] = []
    for idx, chunk in enumerate(voice_chunks):
        inputs.extend(["-i", chunk])
        if idx < len(voice_chunks) - 1:
            filter_parts.append(
                f"[{idx}:a]aresample=24000,apad=pad_dur={pause_ms / 1000.0}[a{idx}];"
            )
        else:
            filter_parts.append(f"[{idx}:a]aresample=24000[a{idx}];")

    prev_label = "a0"
    for idx in range(1, len(voice_chunks)):
        out_label = f"m{idx}" if idx < len(voice_chunks) - 1 else "out"
        filter_parts.append(
            f"[{prev_label}][a{idx}]acrossfade=d={crossfade_sec}:c1=tri:c2=tri[{out_label}];"
        )
        prev_label = out_label

    filter_complex = "".join(filter_parts).rstrip(";")
    cmd = [
        "ffmpeg", "-nostdin", "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        output_path,
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return output_path