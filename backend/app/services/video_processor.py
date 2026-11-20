import os
import subprocess
from pathlib import Path

from app.config import DEFAULT_TRIM_END_SEC
from app.services.audio_processor import get_duration
from app.services.captions_processor import DEFAULT_ASPECT_RATIO, SAFE_ZONES, ass_filter_arg

__all__ = ["get_duration", "trim_and_zoom_clip", "stitch_clips_with_audio"]


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
        "-preset", "ultrafast",  # Fast CPU rendering
        "-crf", "23",
        "-maxrate", "4M",
        "-bufsize", "8M",
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
        # With captions we must re-encode video once (libass), done here in the
        # same pass as the mux; otherwise we can stream-copy the video.
        cmd = [
            "ffmpeg", "-nostdin", "-y",
            "-stream_loop", "-1", "-i", stitched_silent,
            "-i", unified_audio_path,
            "-map", "0:v:0",
            "-map", "1:a:0",
        ]
        if ass_path:
            cmd += ["-vf", ass_filter_arg(ass_path, working_dir=work_dir),
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                    "-maxrate", "4M", "-bufsize", "8M",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart"]
        else:
            cmd += ["-c:v", "copy", "-movflags", "+faststart"]
        cmd += [
            "-c:a", "aac", "-b:a", "128k",
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
