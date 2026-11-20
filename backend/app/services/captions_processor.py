"""Animated word-by-word captions (ASS / libass) with social-media safe zones.

Zero extra AI: the website already knows the narration script and the intro music
delay, so word timings are derived from character weights + punctuation pauses.
FFmpeg's libass renderer burns the generated .ass file into the video.
"""

import os
import re
import subprocess
from pathlib import Path

from app.config import (
    DEFAULT_INTRO_SEC,
    MAX_WORDS_PER_CHUNK,
    SOCIAL_AUDIO_BITRATE,
    SOCIAL_AUDIO_RATE,
    SOCIAL_BUFSIZE,
    SOCIAL_MAXRATE,
    SOCIAL_VIDEO_CRF,
    SOCIAL_VIDEO_PRESET,
)

# Safe-zone presets (PlayRes + margins). For 9:16 the bottom ~380-450px are
# covered by platform UI and the right ~150px by like/share buttons, so captions
# are locked into the clean center-lower zone via MarginV=520 / MarginR=160.
SAFE_ZONES = {
    "9:16": {"w": 1080, "h": 1920, "font": 78, "ml": 90, "mr": 160, "mv": 520, "align": 2},
    "1:1": {"w": 1080, "h": 1080, "font": 72, "ml": 80, "mr": 80, "mv": 180, "align": 2},
    "16:9": {"w": 1920, "h": 1080, "font": 68, "ml": 140, "mr": 140, "mv": 120, "align": 2},
}

DEFAULT_ASPECT_RATIO = "9:16"

HIGHLIGHT = "&H00FFFF&"  # ASS BGR -> bright yellow
BASE = "&HFFFFFF&"       # white


def format_ass_time(seconds: float) -> str:
    """Seconds -> ASS timestamp H:MM:SS.cs (with correct minute/second rollover)."""
    total_cs = max(0, int(round(float(seconds) * 100)))
    hrs, rem = divmod(total_cs, 360000)
    mins, rem = divmod(rem, 6000)
    secs, cs = divmod(rem, 100)
    return f"{hrs}:{mins:02d}:{secs:02d}.{cs:02d}"


def _weight(word: str) -> int:
    """Character-weighted duration with small pauses for punctuation."""
    core = re.sub(r"[^\w]", "", word, flags=re.UNICODE)
    w = max(2, len(core))
    if word.endswith((",", ";", ":")):
        w += 3
    elif word.endswith((".", "!", "?")):
        w += 5
    return w


def time_words(
    script_text: str,
    voice_duration: float,
    intro_delay_sec: float = DEFAULT_INTRO_SEC,
):
    """Distribute voice_duration across words, proportional to character weight."""
    words = script_text.strip().split()
    if not words:
        return []
    weights = [_weight(w) for w in words]
    total = float(sum(weights)) or 1.0
    voice_duration = max(0.1, float(voice_duration))
    out = []
    cursor = max(0.0, float(intro_delay_sec))
    for w, weight in zip(words, weights):
        dur = (weight / total) * voice_duration
        out.append({
            "word": w,
            "start": cursor,
            "end": cursor + dur,
            "duration": dur,
            "weight": weight,
        })
        cursor += dur
    return out


def _ass_style(zone: dict, font_size: int | None, outline: int) -> str:
    font = int(font_size or zone["font"])
    return (
        "Style: ViralCap,DejaVu Sans,{font},&H00FFFFFF,&H0000FFFF,&H00000000,"
        "&H80000000,-1,0,0,0,100,100,0,0,1,{outline},2,{align},{ml},{mr},{mv},1"
    ).format(
        font=font,
        outline=outline,
        align=zone["align"],
        ml=zone["ml"],
        mr=zone["mr"],
        mv=zone["mv"],
    )


def chunk_count(word_count: int, words_per_chunk: int) -> int:
    """Number of caption chunks for a given word count."""
    n = max(1, min(int(words_per_chunk), MAX_WORDS_PER_CHUNK))
    return (max(0, int(word_count)) + n - 1) // n


def generate_word_by_word_ass(
    script_text: str,
    voice_duration: float,
    ass_output_path: str,
    intro_delay_sec: float = DEFAULT_INTRO_SEC,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    words_per_chunk: int = 3,
    font_size: int | None = None,
    outline: int = 5,
    highlight_color: str = HIGHLIGHT,
    base_color: str = BASE,
) -> str:
    """Generate a timed .ass file with karaoke-style active-word highlighting."""
    zone = SAFE_ZONES.get(aspect_ratio, SAFE_ZONES[DEFAULT_ASPECT_RATIO])
    words_per_chunk = max(1, min(int(words_per_chunk), MAX_WORDS_PER_CHUNK))

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {zone['w']}\n"
        f"PlayResY: {zone['h']}\n"
        "WrapStyle: 2\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding\n"
        f"{_ass_style(zone, font_size, outline)}\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    timings = time_words(script_text, voice_duration, intro_delay_sec)
    lines = []
    for i in range(0, len(timings), words_per_chunk):
        chunk = timings[i:i + words_per_chunk]
        for active_idx, tw in enumerate(chunk):
            styled = []
            for j, item in enumerate(chunk):
                display = item["word"].upper()
                if j == active_idx:
                    styled.append(f"{{\\c{highlight_color}}}{display}{{\\c{base_color}}}")
                else:
                    styled.append(display)
            text = " ".join(styled)
            lines.append(
                f"Dialogue: 0,{format_ass_time(tw['start'])},{format_ass_time(tw['end'])},"
                f"ViralCap,,0,0,0,,{text}"
            )

    dest = Path(ass_output_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(header + "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return str(dest)


def ass_filter_arg(ass_path: str, working_dir: str | None = None) -> str:
    """Return a libass filter argument, escaped for FFmpeg's filtergraph parser.

    Running FFmpeg with cwd=the .ass directory lets us pass a bare filename,
    which avoids Windows drive-letter/colon escaping issues entirely.
    """
    if working_dir:
        name = os.path.basename(ass_path)
    else:
        name = os.path.abspath(ass_path).replace("\\", "/").replace(":", "\\:")
    name = name.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return f"ass='{name}'"


def _upscale_dims(aspect_ratio: str | None, upscale_2k: bool) -> tuple[int, int] | None:
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


def burn_captions_onto_video(
    input_video_path: str,
    ass_path: str,
    output_video_path: str,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    upscale_2k: bool = False,
    loudnorm: bool = False,
) -> str:
    """Burn the .ass file into the video with libass and export social-ready audio/video."""
    in_abs = os.path.abspath(input_video_path)
    out_abs = os.path.abspath(output_video_path)
    ass_abs = os.path.abspath(ass_path)
    work_dir = os.path.dirname(ass_abs)

    vf_parts = [ass_filter_arg(ass_abs, working_dir=work_dir)]
    dims = _upscale_dims(aspect_ratio, upscale_2k)
    if dims:
        vf_parts.append(f"scale={dims[0]}:{dims[1]}:flags=lanczos")
    vf_parts.append("format=yuv420p")

    # Detect audio stream to avoid failing on silent videos.
    has_audio = False
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", in_abs],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        has_audio = bool(probe.stdout.strip())
    except Exception:
        has_audio = True

    cmd = [
        "ffmpeg", "-nostdin", "-y",
        "-i", in_abs,
        "-vf", ",".join(vf_parts),
        "-c:v", "libx264",
        "-preset", SOCIAL_VIDEO_PRESET,
        "-crf", str(SOCIAL_VIDEO_CRF),
        "-maxrate", SOCIAL_MAXRATE,
        "-bufsize", SOCIAL_BUFSIZE,
        "-pix_fmt", "yuv420p",
        "-colorspace", "bt709",
        "-color_primaries", "bt709",
        "-color_trc", "bt709",
    ]
    if has_audio:
        if loudnorm:
            cmd += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
        cmd += [
            "-c:a", "aac",
            "-b:a", SOCIAL_AUDIO_BITRATE,
            "-ar", str(SOCIAL_AUDIO_RATE),
        ]
    else:
        cmd += ["-an"]
    cmd += [
        "-movflags", "+faststart",
        out_abs,
    ]
    subprocess.run(cmd, cwd=work_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return output_video_path
