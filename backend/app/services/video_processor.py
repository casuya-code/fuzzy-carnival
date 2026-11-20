import os
import subprocess
from pathlib import Path

from app.config import (
    DEFAULT_TRIM_END_SEC,
    SOCIAL_AUDIO_BITRATE,
    SOCIAL_AUDIO_RATE,
    SOCIAL_BUFSIZE,
    SOCIAL_MAXRATE,
    SOCIAL_VIDEO_CRF,
    SOCIAL_VIDEO_PRESET,
)
from app.services.audio_processor import get_duration
from app.services.captions_processor import ass_filter_arg
from app.services.media_math import (
    DEFAULT_ASPECT_RATIO,
    SAFE_ZONES,
    upscale_dims as _upscale_dims,
)

__all__ = ["get_duration", "trim_and_zoom_clip", "stitch_clips_with_audio", "stitch_silent_clips"]


def trim_and_zoom_clip(
    input_path: str,
    output_path: str,
    trim_end_sec: float = DEFAULT_TRIM_END_SEC,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    fps: int = 30,
    zoom_expr: str | None = None,
) -> str:
    """
    1. Cuts off the last trim_end_sec to remove AI video warping (via -t, not -sseof).
    2. Applies a smooth 2.5-second dynamic punch-in zoom for retention.
    """
    raw_duration = get_duration(input_path)
    clean_duration = max(0.5, raw_duration - trim_end_sec)

    # Target dimensions come from the shared safe-zone table (single source of truth)
    zone = SAFE_ZONES.get(aspect_ratio, SAFE_ZONES[DEFAULT_ASPECT_RATIO])
    target_w, target_h = zone["w"], zone["h"]

    # 75 frames = 2.5 seconds at 30fps (default). When a beat-synced
    # expression is supplied it overrides this static cycle.
    if zoom_expr is None:
        zoom_expr = "1.0+0.12*(mod(on,75)/75)"

    vf_filter = (
        f"fps={fps},"
        f"scale={target_w*2}:{target_h*2}:force_original_aspect_ratio=increase,"
        f"crop={target_w*2}:{target_h*2},"
        f"zoompan=z='{zoom_expr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d=1:s={target_w}x{target_h}:fps={fps},"
        f"format=yuv420p"
    )

    cmd = [
        "ffmpeg", "-nostdin", "-y",
        "-i", input_path,
        "-t", f"{clean_duration:.3f}",
        "-vf", vf_filter,
        "-an",  # Strip silent AI video audio track
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
        output_path,
    ]

    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return output_path


def stitch_clips_with_audio(
    processed_clips: list[str],
    unified_audio_path: str,
    final_output_path: str,
    ass_path: str | None = None,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    upscale_2k: bool = False,
    loudnorm: bool = False,
) -> str:
    """
    Concatenates all trimmed & zoomed clips and attaches the mixed voiceover + music.
    Loops the video sequence if the narration is slightly longer than total clips.

    If ass_path is provided, the captions are burned in the SAME final pass
    (libass via -vf) instead of re-encoding the video a second time afterwards.
    """
    work_dir = str(Path(final_output_path).parent)
    concat_list_path = str(Path(final_output_path).with_suffix(".txt"))
    with open(concat_list_path, "w", encoding="utf-8") as f:
        for clip in processed_clips:
            safe = os.path.abspath(clip).replace("\\", "/")
            f.write(f"file '{safe}'\n")

    # Step 1: Concatenate video clips seamlessly without re-encoding
    stitched_silent = str(Path(final_output_path).with_name("stitched_silent.mp4"))
    try:
        subprocess.run([
            "ffmpeg", "-nostdin", "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_list_path,
            "-c", "copy",
            stitched_silent,
        ], cwd=work_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

        # Step 2: Combine stitched video with unified audio track.
        # With captions/upscale we must re-encode video; audio can be loudness-normalized.
        upscale_dims = _upscale_dims(aspect_ratio, upscale_2k)
        vf_parts: list[str] = []
        if ass_path:
            vf_parts.append(ass_filter_arg(ass_path, working_dir=work_dir))
        if upscale_dims:
            vf_parts.append(f"scale={upscale_dims[0]}:{upscale_dims[1]}:flags=lanczos")
        vf_parts.append("format=yuv420p")
        must_encode_video = bool(ass_path or upscale_dims)

        cmd = [
            "ffmpeg", "-nostdin", "-y",
            "-stream_loop", "-1", "-i", stitched_silent,
            "-i", unified_audio_path,
            "-map", "0:v:0",
            "-map", "1:a:0",
        ]
        if must_encode_video:
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
        else:
            cmd += ["-c:v", "copy"]

        if loudnorm:
            cmd += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]

        cmd += [
            "-c:a", "aac",
            "-b:a", SOCIAL_AUDIO_BITRATE,
            "-ar", str(SOCIAL_AUDIO_RATE),
            "-movflags", "+faststart",
            "-shortest",  # Stops when audio (voiceover + outro) finishes
            final_output_path,
        ]
        subprocess.run(cmd, cwd=work_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    finally:
        for p in (concat_list_path, stitched_silent):
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass

    return final_output_path


def stitch_silent_clips(processed_clips: list[str], final_output_path: str) -> str:
    """Concatenate trimmed/zoomed clips into one silent intermediate video (stream-copy)."""
    if not processed_clips:
        raise ValueError("At least one processed clip is required")

    work_dir = str(Path(final_output_path).parent)
    concat_list_path = str(Path(final_output_path).with_suffix(".txt"))
    with open(concat_list_path, "w", encoding="utf-8") as f:
        for clip in processed_clips:
            safe = os.path.abspath(clip).replace("\\", "/")
            f.write(f"file '{safe}'\n")

    try:
        subprocess.run([
            "ffmpeg", "-nostdin", "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_list_path,
            "-c", "copy",
            "-movflags", "+faststart",
            final_output_path,
        ], cwd=work_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    finally:
        try:
            Path(concat_list_path).unlink(missing_ok=True)
        except Exception:
            pass

    return final_output_path
