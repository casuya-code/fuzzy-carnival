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
from app.services.local_overlays import (
    DEFAULT_OVERLAY_OPACITY,
    DEFAULT_OVERLAY_POSITION,
    DEFAULT_OVERLAY_SIZE,
    build_overlay_filters,
    normalize_overlay_opacity,
    normalize_overlay_position,
    normalize_overlay_size,
)
from app.services.video_overlays import (
    DEFAULT_OVERLAY as DEFAULT_EFFECT_OVERLAY,
    normalize_overlay as normalize_effect_overlay,
    overlay_filter as effect_overlay_filter,
)
from app.services.media_math import (
    DEFAULT_ASPECT_RATIO,
    SAFE_ZONES,
    upscale_dims as _upscale_dims,
)
from app.services.sfx_generator import (
    DEFAULT_SFX,
    DEFAULT_SFX_LEVEL,
    generate_sfx_bed,
    normalize_sfx,
    normalize_sfx_level,
)
from app.services.video_transitions import (
    DEFAULT_TRANSITION,
    DEFAULT_TRANSITION_DURATION_SEC,
    build_xfade_filtergraph,
    normalize_transition,
    transition_events,
)

__all__ = ["get_duration", "trim_and_zoom_clip", "stitch_clips_with_audio", "stitch_silent_clips"]


def trim_and_zoom_clip(
    input_path: str,
    output_path: str,
    trim_end_sec: float = DEFAULT_TRIM_END_SEC,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    fps: int = 30,
    zoom_expr: str | None = None,
    overlay: str = DEFAULT_EFFECT_OVERLAY,
) -> str:
    """
    1. Cuts off the last trim_end_sec to remove AI video warping (via -t, not -sseof).
    2. Applies a smooth 2.5-second dynamic punch-in zoom for retention.
    3. Optionally applies a visual effect overlay.
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

    overlay_fx = effect_overlay_filter(overlay)
    vf_parts = [
        f"fps={fps}",
        f"scale={target_w*2}:{target_h*2}:force_original_aspect_ratio=increase",
        f"crop={target_w*2}:{target_h*2}",
        (
            f"zoompan=z='{zoom_expr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d=1:s={target_w}x{target_h}:fps={fps}"
        ),
    ]
    if overlay_fx:
        vf_parts.append(overlay_fx)
    vf_parts.append("format=yuv420p")
    vf_filter = ",".join(vf_parts)

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


def _stitch_video_silent(
    processed_clips: list[str],
    final_output_path: str,
    transition: str = DEFAULT_TRANSITION,
    transition_duration_sec: float = DEFAULT_TRANSITION_DURATION_SEC,
    transitions: list[str] | None = None,
    overlay: str = DEFAULT_EFFECT_OVERLAY,
) -> str:
    """Join processed clips with native xfade transitions into one silent MP4."""
    if not processed_clips:
        raise ValueError("At least one processed clip is required")

    overlay = normalize_effect_overlay(overlay)
    overlay_fx = effect_overlay_filter(overlay)
    base = normalize_transition(transition)
    gaps = [normalize_transition(t) for t in transitions] if transitions else [base] * (len(processed_clips) - 1)
    command_inputs: list[str] = []
    for clip in processed_clips:
        command_inputs += ["-i", clip]

    # A single clip needs no filtergraph; keep the old fast stream-copy path.
    if len(processed_clips) == 1 and not overlay_fx:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", *command_inputs, "-an", "-c", "copy",
             "-movflags", "+faststart", final_output_path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        )
        return final_output_path

    if len(processed_clips) == 1:
        subprocess.run([
            "ffmpeg", "-nostdin", "-y", *command_inputs,
            "-vf", f"{overlay_fx},format=yuv420p",
            "-an", "-c:v", "libx264", "-preset", SOCIAL_VIDEO_PRESET,
            "-crf", str(SOCIAL_VIDEO_CRF), "-maxrate", SOCIAL_MAXRATE,
            "-bufsize", SOCIAL_BUFSIZE, "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-movflags", "+faststart", final_output_path,
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return final_output_path

    durations = [get_duration(clip) for clip in processed_clips]
    filtergraph, final_label, _total = build_xfade_filtergraph(
        durations=durations,
        transitions=gaps,
        duration_sec=transition_duration_sec,
    )
    out_label = final_label
    if overlay_fx:
        filtergraph = f"{filtergraph};[{final_label}]{overlay_fx},format=yuv420p[vfx]"
        out_label = "vfx"

    subprocess.run([
        "ffmpeg", "-nostdin", "-y",
        *command_inputs,
        "-filter_complex", filtergraph,
        "-map", f"[{out_label}]",
        "-an",
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
        final_output_path,
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return final_output_path


def stitch_clips_with_audio(
    processed_clips: list[str],
    unified_audio_path: str,
    final_output_path: str,
    ass_path: str | None = None,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    upscale_2k: bool = False,
    loudnorm: bool = False,
    transition: str = DEFAULT_TRANSITION,
    transition_duration_sec: float = DEFAULT_TRANSITION_DURATION_SEC,
    transitions: list[str] | None = None,
    transition_sfx: str = DEFAULT_SFX,
    transition_sfx_level: int = DEFAULT_SFX_LEVEL,
    overlay_image_path: str | None = None,
    overlay_position: str = DEFAULT_OVERLAY_POSITION,
    overlay_size: int = DEFAULT_OVERLAY_SIZE,
    overlay_opacity: int = DEFAULT_OVERLAY_OPACITY,
    overlay: str = DEFAULT_EFFECT_OVERLAY,
    font_path: str | None = None,
) -> str:
    """
    Joins trimmed & zoomed clips with xfade transitions, then attaches audio.
    Loops the video sequence if the narration is slightly longer than total clips.

    If ass_path is provided, the captions are burned in the SAME final pass
    (libass via -vf) instead of re-encoding the video a second time afterwards.
    """
    work_dir = str(Path(final_output_path).parent)
    sfx_path = ""

    # Step 1: Join clips with selected transitions into one silent MP4.
    stitched_silent = str(Path(final_output_path).with_name("stitched_silent.mp4"))
    try:
        _stitch_video_silent(
            processed_clips,
            stitched_silent,
            transition=transition,
            transition_duration_sec=transition_duration_sec,
            transitions=transitions,
            overlay=overlay,
        )

        # Step 2: Combine stitched video, local overlay, and unified audio in one pass.
        upscale_dims = _upscale_dims(aspect_ratio, upscale_2k)
        use_overlay = bool(overlay_image_path and Path(overlay_image_path).is_file())
        vf_parts: list[str] = []
        if ass_path:
            fontsdir = str(Path(font_path).parent) if font_path and Path(font_path).is_file() else None
            vf_parts.append(ass_filter_arg(ass_path, working_dir=work_dir, fontsdir=fontsdir))
        if upscale_dims:
            vf_parts.append(f"scale={upscale_dims[0]}:{upscale_dims[1]}:flags=lanczos")
        vf_parts.append("format=yuv420p")
        must_encode_video = bool(ass_path or upscale_dims or use_overlay)

        sfx_path = str(Path(final_output_path).with_name("transition_sfx.wav"))
        sfx_kind = normalize_sfx(transition_sfx)
        sfx_level = normalize_sfx_level(transition_sfx_level)
        use_sfx = False
        if sfx_kind != "off" and sfx_level > 0 and len(processed_clips) > 1:
            gaps = (
                [normalize_transition(t) for t in transitions]
                if transitions
                else [normalize_transition(transition)] * (len(processed_clips) - 1)
            )
            durations = [get_duration(clip) for clip in processed_clips]
            use_sfx = generate_sfx_bed(
                sfx_path,
                durations,
                gaps,
                transition_duration_sec,
                sfx_kind,
                sfx_level,
                get_duration(stitched_silent),
            )

        # Inputs: 0=video, 1=voice/music, 2=overlay image, 3=SFX bed.
        cmd = [
            "ffmpeg", "-nostdin", "-y",
            "-stream_loop", "-1", "-i", stitched_silent,
            "-i", unified_audio_path,
        ]
        if use_overlay:
            cmd += ["-loop", "1", "-framerate", "30", "-i", overlay_image_path]
        if use_sfx:
            cmd += ["-stream_loop", "-1", "-i", sfx_path]

        if must_encode_video:
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
            ]
        else:
            cmd += ["-c:v", "copy"]

        filter_parts: list[str] = []
        video_label = "0:v:0"
        if must_encode_video:
            filter_parts.append(f"[0:v]{','.join(vf_parts)}[vbase]")
            video_label = "[vbase]"

        if use_overlay:
            zone = SAFE_ZONES.get(aspect_ratio, SAFE_ZONES[DEFAULT_ASPECT_RATIO])
            frame_w, frame_h = upscale_dims or (zone["w"], zone["h"])
            image_filter, placement_filter = build_overlay_filters(
                overlay_position, overlay_size, overlay_opacity, frame_w, frame_h
            )
            filter_parts.append(f"[2:v]{image_filter}")
            filter_parts.append(placement_filter)
            filter_parts.append("[vout]format=yuv420p[vfinal]")
            video_label = "[vfinal]"

        sfx_index = 3 if use_overlay else 2
        if use_sfx:
            audio_filter = (
                f"[1:a:0][{sfx_index}:a:0]amix=inputs=2:duration=first:"
                "dropout_transition=0:normalize=0"
            )
            if loudnorm:
                audio_filter += ",loudnorm=I=-16:TP=-1.5:LRA=11"
            filter_parts.append(f"{audio_filter}[aout]")
            audio_label = "[aout]"
        elif loudnorm and filter_parts:
            filter_parts.append("[1:a:0]loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
            audio_label = "[aout]"
        else:
            audio_label = "1:a:0"

        if filter_parts:
            cmd += ["-filter_complex", ";".join(filter_parts)]
        cmd += ["-map", video_label, "-map", audio_label]
        if not filter_parts and loudnorm:
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
        for temp in (stitched_silent, sfx_path):
            try:
                Path(temp).unlink(missing_ok=True)
            except Exception:
                pass

    return final_output_path


def stitch_silent_clips(
    processed_clips: list[str],
    final_output_path: str,
    transition: str = DEFAULT_TRANSITION,
    transition_duration_sec: float = DEFAULT_TRANSITION_DURATION_SEC,
    transitions: list[str] | None = None,
    overlay: str = DEFAULT_EFFECT_OVERLAY,
) -> str:
    """Join trimmed/zoomed clips into one silent intermediate video."""
    return _stitch_video_silent(
        processed_clips,
        final_output_path,
        transition=transition,
        transition_duration_sec=transition_duration_sec,
        transitions=transitions,
        overlay=overlay,
    )
