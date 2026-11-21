"""Automated YouTube release packaging: designed thumbnail + 3 vertical Shorts.

Runs on the $5 Railway CPU container with FFmpeg, Pillow and OpenCV (all
lightweight). No Canva, no CapCut, no GPU.
"""

import logging
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageStat

from app.config import (
    SOCIAL_AUDIO_BITRATE,
    SOCIAL_AUDIO_RATE,
    SOCIAL_BUFSIZE,
    SOCIAL_MAXRATE,
    SOCIAL_VIDEO_CRF,
    SOCIAL_VIDEO_PRESET,
)

ACCENTS = {
    "yellow": (255, 215, 0),
    "red": (235, 45, 45),
    "white": (255, 255, 255),
}

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
]


def resolve_font(size: int, preferred: str | None = None) -> ImageFont.FreeTypeFont:
    """Find a bold font on Linux (Railway) or Windows (local dev)."""
    for path in ([preferred] if preferred else []) + FONT_CANDIDATES:
        if path and os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def _sharpness(path: str) -> float:
    """Variance-of-Laplacian sharpness (OpenCV) with a Pillow fallback."""
    try:
        import cv2  # type: ignore
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is not None:
            return float(cv2.Laplacian(img, cv2.CV_64F).var())
    except Exception:
        pass
    try:
        img = Image.open(path).convert("L").filter(ImageFilter.FIND_EDGES)
        return float(ImageStat.Stat(img).var[0])
    except Exception:
        return 0.0


def extract_best_frame(
    video_path: str,
    out_path: str,
    width: int = 1280,
    height: int = 720,
    sample_sec: float = 5.0,
) -> str:
    """Sample frames across the video and keep the sharpest (avoids blurry transitions)."""
    work = str(Path(out_path).parent)
    prefix = Path(out_path).with_name("cand_")
    pattern = prefix.name + "%03d.jpg"
    vf = (
        f"fps=1/{sample_sec},scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}"
    )
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-i", video_path, "-vf", vf, "-q:v", "2", pattern],
            cwd=work, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        )
        candidates = sorted(Path(work).glob(prefix.name + "*.jpg"))
        if candidates:
            best = max(candidates, key=lambda p: _sharpness(str(p)))
            shutil.copyfile(best, out_path)
            for c in candidates:
                try:
                    c.unlink(missing_ok=True)
                except Exception:
                    pass
            return out_path
    except subprocess.CalledProcessError:
        pass
    # Fallback: FFmpeg's own representative-frame filter
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-i", video_path,
         "-vf", f"thumbnail=150,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}",
         "-frames:v", "1", out_path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    return out_path


def _fit_font(draw, word: str, base_size: int, max_w: int, font_path: str | None):
    size = base_size
    font = resolve_font(size, font_path)
    bbox = draw.textbbox((0, 0), word, font=font)
    while (bbox[2] - bbox[0]) > max_w and size > 18:
        size -= 4
        font = resolve_font(size, font_path)
        bbox = draw.textbbox((0, 0), word, font=font)
    return font, bbox


def generate_viral_thumbnail(
    video_path: str,
    output_thumb_path: str,
    hook_words: str = "AFRICA'S HIGHEST PEAK",
    font_path: str | None = None,
    accent: str = "yellow",
    gradient: str = "left",
    border: bool = True,
    width: int = 1280,
    height: int = 720,
) -> str:
    """Design a 1280x720 thumbnail: sharp frame + contrast boost + gradient + 3-word hook."""
    raw = str(Path(output_thumb_path).with_name("raw_best_frame.jpg"))
    extract_best_frame(video_path, raw, width=width, height=height)

    img = Image.open(raw).convert("RGBA")
    img = ImageEnhance.Contrast(img).enhance(1.22)
    img = ImageEnhance.Color(img).enhance(1.25)

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(overlay)
    if gradient == "bottom":
        band = int(height * 0.62)
        for i in range(band):
            alpha = int(210 * (i / band))  # darkest at bottom edge
            gd.line([(0, height - band + i), (width, height - band + i)], fill=(10, 10, 15, alpha))
    else:
        band = int(width * 0.62)
        for x in range(band):
            alpha = int(210 * (1 - x / band))  # darkest at left edge
            gd.line([(x, 0), (x, height)], fill=(10, 10, 15, alpha))
    img = Image.alpha_composite(img, overlay)

    draw = ImageDraw.Draw(img)
    accent_rgb = ACCENTS.get(accent, ACCENTS["yellow"])
    words = hook_words.upper().split()[:3]
    x = int(width * 0.0586)          # ~75px at 720p
    y = int(height * 0.208)          # ~150px at 720p
    base_size = int(height * 0.146)  # ~105px at 720p

    for idx, word in enumerate(words):
        font, bbox = _fit_font(draw, word, base_size, width - 2 * x, font_path)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if idx == len(words) - 1:
            pad_x, pad_y = 22, 14
            draw.rounded_rectangle(
                [x - pad_x, y - pad_y, x + tw + pad_x, y + th + pad_y + 10],
                radius=18, fill=accent_rgb + (255,),
            )
            fill = (15, 15, 15, 255) if accent != "white" else (15, 15, 15, 255)
            draw.text((x, y), word, font=font, fill=fill)
        else:
            draw.text((x + 6, y + 6), word, font=font, fill=(0, 0, 0, 230))
            draw.text((x, y), word, font=font, fill=(255, 255, 255, 255))
        y += th + int(height * 0.0625)

    if border:
        draw.rectangle([0, 0, width - 1, height - 1], outline=accent_rgb + (255,), width=8)

    Path(output_thumb_path).parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(output_thumb_path, "JPEG", quality=90, optimize=True)
    Path(raw).unlink(missing_ok=True)
    return output_thumb_path


def _has_audio(path: str) -> bool:
    try:
        res = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "csv=p=0", path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True,
        )
        return bool(res.stdout.strip())
    except Exception as e:
        # If probing fails, avoid mapping a non-existent audio stream in FFmpeg.
        logging.getLogger(__name__).warning(
            "Could not probe audio stream for %s (%s); assuming no audio", path, e
        )
        return False


def _make_banner(path: str, label: str, title: str, accent: str, font_path: str | None) -> None:
    w, h = 1080, 180
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w, h], radius=24, fill=(8, 8, 12, 205))
    f1, _ = _fit_font(d, label, 66, w - 72, font_path)
    d.text((36, 20), label, font=f1, fill=(255, 255, 255, 255))
    if title:
        f2, _ = _fit_font(d, title.upper(), 34, w - 72, font_path)
        d.text((38, 108), title.upper(), font=f2, fill=ACCENTS.get(accent, ACCENTS["yellow"]) + (255,))
    img.save(path)


def export_three_vertical_shorts(
    master_16_9_video: str,
    output_dir: str,
    clip_length_sec: int = 40,
    start_times: list[float] | None = None,
    title: str = "",
    phases: list[str] | None = None,
    accent: str = "yellow",
    font_path: str | None = None,
    banner_sec: float = 5.0,
) -> list[str]:
    """Slice a 16:9 master into 3 center-cropped 9:16 Shorts with a top hook banner."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    starts = start_times or [0, 45, 90]
    phases = phases or ["THE HOOK", "THE CLIMAX", "THE REVEAL"]
    audio = _has_audio(master_16_9_video)
    short_paths: list[str] = []

    vf = "crop=ih*9/16:ih,scale=1080:1920,setsar=1"
    for idx, start in enumerate(starts[:3], start=1):
        phase = phases[idx - 1] if idx - 1 < len(phases) else f"PART {idx}"
        label = f"PART {idx}: {phase}"
        banner = str(out_dir / f"banner_{idx}.png")
        _make_banner(banner, label, title, accent, font_path)
        out_path = str(out_dir / f"short_part_{idx}_9x16.mp4")

        filter_complex = (
            f"[0:v]{vf}[v];"
            f"[v][1:v]overlay=0:0:enable='between(t,0,{banner_sec})':"
            "eof_action=pass,format=yuv420p[out]"
        )
        cmd = [
            "ffmpeg", "-nostdin", "-y",
            "-ss", str(start), "-i", master_16_9_video,
            # Finite banner input: the overlay stays visible for banner_sec via
            # `enable`, and the output is capped by -t below.
            "-loop", "1", "-t", str(banner_sec), "-i", banner,
            "-t", str(clip_length_sec),
            "-filter_complex", filter_complex,
            "-map", "[out]",
        ]
        if audio:
            cmd += [
                "-map", "0:a:0",
                "-c:a", "aac",
                "-b:a", SOCIAL_AUDIO_BITRATE,
                "-ar", str(SOCIAL_AUDIO_RATE),
            ]
        else:
            cmd += ["-an"]
        cmd += [
            "-c:v", "libx264",
            "-preset", SOCIAL_VIDEO_PRESET,
            "-crf", str(SOCIAL_VIDEO_CRF),
            "-maxrate", SOCIAL_MAXRATE,
            "-bufsize", SOCIAL_BUFSIZE,
            "-pix_fmt", "yuv420p",
            "-colorspace", "bt709",
            "-color_primaries", "bt709",
            "-color_trc", "bt709",
            "-movflags", "+faststart",
            out_path,
        ]
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        short_paths.append(out_path)
        try:
            Path(banner).unlink(missing_ok=True)
        except Exception:
            pass

    return short_paths


def reexport_master_video(
    input_path: str,
    output_path: str,
    upscale_2k: bool = False,
    loudnorm: bool = False,
) -> str:
    """Re-export a master video with social-ready encoding and optional 2K upscale/loudness normalization."""
    vf_parts = []
    if upscale_2k:
        # YouTube-oriented 16:9 2K master
        vf_parts.append("scale=2560:1440:force_original_aspect_ratio=decrease")
        vf_parts.append("pad=2560:1440:(ow-iw)/2:(oh-ih)/2:black")
    vf_parts.append("format=yuv420p")

    has_audio = _has_audio(input_path)
    cmd = [
        "ffmpeg", "-nostdin", "-y",
        "-i", input_path,
        "-map", "0:v:0",
    ]
    if has_audio:
        cmd += ["-map", "0:a:0"]
    cmd += [
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
        output_path,
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return output_path
