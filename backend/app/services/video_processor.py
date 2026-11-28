import subprocess
from pathlib import Path

from app.services.job_context import check_cancelled, run_ffmpeg

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

__all__ = [
    "get_duration",
    "trim_and_zoom_clip",
    "stitch_clips_with_audio",
    "stitch_clips_with_clip_audio",
    "stitch_silent_clips",
]

PREVIEW_WIDTH = 480
_PREVIEW_PRESET = "ultrafast"
_PREVIEW_CRF = "28"


def preview_dims(aspect_ratio: str) -> tuple[int, int]:
    """Low-resolution dimensions for quick previews (final renders are unchanged)."""
    zone = SAFE_ZONES.get(aspect_ratio, SAFE_ZONES[DEFAULT_ASPECT_RATIO])
    height = int(round(PREVIEW_WIDTH * zone["h"] / zone["w"] / 2) * 2)
    return PREVIEW_WIDTH, max(2, height)


def _has_audio_stream(path: str) -> bool:
    """Return True when the file has at least one audio stream."""
    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "a:0",
                "-show_entries", "stream=codec_type",
                "-of", "csv=p=0",
                path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return bool(probe.stdout.strip())
    except Exception:
        return False


def trim_and_zoom_clip(
    input_path: str,
    output_path: str,
    trim_end_sec: float = DEFAULT_TRIM_END_SEC,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    fps: int = 30,
    zoom_expr: str | None = None,
    overlay: str = DEFAULT_EFFECT_OVERLAY,
    preview: bool = False,
    keep_audio: bool = False,
) -> str:
    """
    1. Cuts off the last trim_end_sec to remove AI video warping (via -t, not -sseof).
    2. Applies a smooth 2.5-second dynamic punch-in zoom for retention.
    3. Optionally applies a visual effect overlay.

    When ``keep_audio`` is True the clip's own audio is trimmed and preserved
    (silent audio is generated when the source has no audio stream) so clips can
    be joined without a separate unified audio track.
    """
    check_cancelled()
    raw_duration = get_duration(input_path)
    clean_duration = max(0.5, raw_duration - trim_end_sec)

    # Target dimensions come from the shared safe-zone table (single source of truth)
    zone = SAFE_ZONES.get(aspect_ratio, SAFE_ZONES[DEFAULT_ASPECT_RATIO])
    target_w, target_h = preview_dims(aspect_ratio) if preview else (zone["w"], zone["h"])
    source_w, source_h = (target_w, target_h) if preview else (target_w * 2, target_h * 2)

    # 75 frames = 2.5 seconds at 30fps (default). When a beat-synced
    # expression is supplied it overrides this static cycle.
    if zoom_expr is None:
        zoom_expr = "1.0+0.12*(mod(on,75)/75)"

    overlay_fx = effect_overlay_filter(overlay)
    vf_parts = [
        f"fps={fps}",
        f"scale={source_w}:{source_h}:force_original_aspect_ratio=increase",
        f"crop={source_w}:{source_h}",
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
    ]
    has_audio = keep_audio and _has_audio_stream(input_path)
    if keep_audio and not has_audio:
        cmd += [
            "-f", "lavfi", "-t", f"{clean_duration:.3f}",
            "-i", f"anullsrc=channel_layout=stereo:sample_rate={SOCIAL_AUDIO_RATE}",
        ]

    cmd += [
        "-t", f"{clean_duration:.3f}",
        "-vf", vf_filter,
        "-map", "0:v:0",
    ]
    if keep_audio:
        cmd += ["-map", "1:a:0" if not has_audio else "0:a:0?"]
        cmd += [
            "-c:a", "aac",
            "-b:a", SOCIAL_AUDIO_BITRATE,
            "-ar", str(SOCIAL_AUDIO_RATE),
        ]
    else:
        cmd += ["-an"]  # Strip silent AI video audio track

    cmd += [
        "-c:v", "libx264",
        "-preset", _PREVIEW_PRESET if preview else SOCIAL_VIDEO_PRESET,
        "-crf", _PREVIEW_CRF if preview else str(SOCIAL_VIDEO_CRF),
        "-maxrate", SOCIAL_MAXRATE,
        "-bufsize", SOCIAL_BUFSIZE,
        "-pix_fmt", "yuv420p",
        "-colorspace", "bt709",
        "-color_primaries", "bt709",
        "-color_trc", "bt709",
        "-movflags", "+faststart",
        output_path,
    ]

    run_ffmpeg(cmd)
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
    check_cancelled()

    overlay = normalize_effect_overlay(overlay)
    overlay_fx = effect_overlay_filter(overlay)
    base = normalize_transition(transition)
    gaps = [normalize_transition(t) for t in transitions] if transitions else [base] * (len(processed_clips) - 1)
    command_inputs: list[str] = []
    for clip in processed_clips:
        command_inputs += ["-i", clip]

    # A single clip needs no filtergraph; keep the old fast stream-copy path.
    if len(processed_clips) == 1 and not overlay_fx:
        run_ffmpeg(
            ["ffmpeg", "-nostdin", "-y", *command_inputs, "-an", "-c", "copy",
             "-movflags", "+faststart", final_output_path]
        )
        return final_output_path

    if len(processed_clips) == 1:
        run_ffmpeg([
            "ffmpeg", "-nostdin", "-y", *command_inputs,
            "-vf", f"{overlay_fx},format=yuv420p",
            "-an", "-c:v", "libx264", "-preset", SOCIAL_VIDEO_PRESET,
            "-crf", str(SOCIAL_VIDEO_CRF), "-maxrate", SOCIAL_MAXRATE,
            "-bufsize", SOCIAL_BUFSIZE, "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-movflags", "+faststart", final_output_path,
        ])
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

    run_ffmpeg([
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
    ])
    return final_output_path


def _stitch_video_with_clip_audio(
    processed_clips: list[str],
    final_output_path: str,
    transition: str = DEFAULT_TRANSITION,
    transition_duration_sec: float = DEFAULT_TRANSITION_DURATION_SEC,
    transitions: list[str] | None = None,
    overlay: str = DEFAULT_EFFECT_OVERLAY,
) -> str:
    """Join processed clips with xfade video and acrossfade audio (keeps clip audio)."""
    if not processed_clips:
        raise ValueError("At least one processed clip is required")
    check_cancelled()

    overlay = normalize_effect_overlay(overlay)
    overlay_fx = effect_overlay_filter(overlay)
    base = normalize_transition(transition)
    gaps = [normalize_transition(t) for t in transitions] if transitions else [base] * (len(processed_clips) - 1)

    durations = [get_duration(clip) for clip in processed_clips]
    audio_present = [_has_audio_stream(c) for c in processed_clips]
    command_inputs: list[str] = []
    audio_map: list[str] = []
    for i, clip in enumerate(processed_clips):
        command_inputs += ["-i", clip]
        if audio_present[i]:
            audio_map.append(f"{i}:a:0")
        else:
            # Insert a silent audio source; its input index is len(processed_clips) + n_silent.
            silent_idx = len(processed_clips) + sum(1 for p in audio_present[:i] if not p)
            audio_map.append(f"{silent_idx}:a:0")
    # Append silent sources for clips missing audio.
    for i, present in enumerate(audio_present):
        if not present:
            command_inputs += [
                "-f", "lavfi", "-t", f"{durations[i]:.3f}",
                "-i", f"anullsrc=channel_layout=stereo:sample_rate={SOCIAL_AUDIO_RATE}",
            ]

    if len(processed_clips) == 1:
        vf = f"{overlay_fx},format=yuv420p" if overlay_fx else None
        cmd = ["ffmpeg", "-nostdin", "-y", *command_inputs]
        if vf:
            cmd += ["-vf", vf, "-c:v", "libx264", "-preset", SOCIAL_VIDEO_PRESET,
                    "-crf", str(SOCIAL_VIDEO_CRF), "-maxrate", SOCIAL_MAXRATE,
                    "-bufsize", SOCIAL_BUFSIZE, "-pix_fmt", "yuv420p",
                    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
        else:
            cmd += ["-c:v", "copy"]
        cmd += [
            "-map", "0:v:0", "-map", audio_map[0],
            "-c:a", "aac", "-b:a", SOCIAL_AUDIO_BITRATE, "-ar", str(SOCIAL_AUDIO_RATE),
            "-movflags", "+faststart", final_output_path,
        ]
        run_ffmpeg(cmd)
        return final_output_path

    v_graph, v_label, _total = build_xfade_filtergraph(
        durations=durations, transitions=gaps, duration_sec=transition_duration_sec,
    )
    # Build acrossfade using the actual audio input mapping.
    events = transition_events(durations, gaps, transition_duration_sec)
    a_parts: list[str] = []
    current_a = f"[{audio_map[0]}]"
    for i, (_name, _offset, overlap) in enumerate(events, 1):
        out_label = f"ax{i}"
        a_parts.append(
            f"{current_a}[{audio_map[i]}]acrossfade=d={overlap:.3f}:c1=tri:c2=tri[{out_label}]"
        )
        current_a = f"[{out_label}]"
    a_graph = ";".join(a_parts)
    a_label = current_a.strip("[]")

    out_v = v_label
    if overlay_fx:
        v_graph = f"{v_graph};[{v_label}]{overlay_fx},format=yuv420p[vfx]"
        out_v = "vfx"

    filtergraph = f"{v_graph};{a_graph}"
    run_ffmpeg([
        "ffmpeg", "-nostdin", "-y",
        *command_inputs,
        "-filter_complex", filtergraph,
        "-map", f"[{out_v}]",
        "-map", f"[{a_label}]",
        "-c:v", "libx264",
        "-preset", SOCIAL_VIDEO_PRESET,
        "-crf", str(SOCIAL_VIDEO_CRF),
        "-maxrate", SOCIAL_MAXRATE,
        "-bufsize", SOCIAL_BUFSIZE,
        "-pix_fmt", "yuv420p",
        "-colorspace", "bt709",
        "-color_primaries", "bt709",
        "-color_trc", "bt709",
        "-c:a", "aac",
        "-b:a", SOCIAL_AUDIO_BITRATE,
        "-ar", str(SOCIAL_AUDIO_RATE),
        "-movflags", "+faststart",
        final_output_path,
    ])
    return final_output_path


def stitch_clips_with_audio(
    processed_clips: list[str],
    unified_audio_path: str | None,
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
    preview: bool = False,
) -> str:
    """
    Join trimmed & zoomed clips with xfade transitions, then attach audio.

    When ``unified_audio_path`` is provided, the video is looped to match that
    audio and ``-shortest`` ends at the audio. When it is ``None``, the clips'
    own audio is preserved (stitched with acrossfades) and no external audio is
    mixed in.

    If ass_path is provided, captions are burned in the same final encode pass.
    """
    check_cancelled()
    work_dir = str(Path(final_output_path).parent)
    sfx_path = ""
    keep_clip_audio = not unified_audio_path

    stitched_path = str(
        Path(final_output_path).with_name(
            "stitched_with_audio.mp4" if keep_clip_audio else "stitched_silent.mp4"
        )
    )
    try:
        if keep_clip_audio:
            _stitch_video_with_clip_audio(
                processed_clips,
                stitched_path,
                transition=transition,
                transition_duration_sec=transition_duration_sec,
                transitions=transitions,
                overlay=overlay,
            )
        else:
            _stitch_video_silent(
                processed_clips,
                stitched_path,
                transition=transition,
                transition_duration_sec=transition_duration_sec,
                transitions=transitions,
                overlay=overlay,
            )

        upscale_dims = None if preview else _upscale_dims(aspect_ratio, upscale_2k)
        preview_frame = preview_dims(aspect_ratio) if preview else None
        use_overlay = bool(overlay_image_path and Path(overlay_image_path).is_file())
        vf_parts: list[str] = []
        if ass_path:
            fontsdir = str(Path(font_path).parent) if font_path and Path(font_path).is_file() else None
            vf_parts.append(ass_filter_arg(ass_path, working_dir=work_dir, fontsdir=fontsdir))
        if preview_frame:
            vf_parts.append(f"scale={preview_frame[0]}:{preview_frame[1]}:flags=bilinear")
        elif upscale_dims:
            vf_parts.append(f"scale={upscale_dims[0]}:{upscale_dims[1]}:flags=lanczos")
        vf_parts.append("format=yuv420p")

        sfx_kind = normalize_sfx(transition_sfx)
        sfx_level_n = normalize_sfx_level(transition_sfx_level)
        use_sfx = False
        sfx_path = str(Path(final_output_path).with_name("transition_sfx.wav"))
        if sfx_kind != "off" and sfx_level_n > 0 and len(processed_clips) > 1:
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
                sfx_level_n,
                get_duration(stitched_path),
            )

        # Inputs: 0=stitched video (+clip audio when keep_clip_audio),
        # unified audio when provided, then overlay image, then SFX.
        cmd = ["ffmpeg", "-nostdin", "-y"]
        if keep_clip_audio:
            cmd += ["-i", stitched_path]
        else:
            cmd += ["-stream_loop", "-1", "-i", stitched_path, "-i", unified_audio_path]
        if use_overlay:
            cmd += ["-loop", "1", "-framerate", "30", "-i", overlay_image_path]
        if use_sfx:
            cmd += ["-stream_loop", "-1", "-i", sfx_path]

        cmd += [
            "-c:v", "libx264",
            "-preset", _PREVIEW_PRESET if preview else SOCIAL_VIDEO_PRESET,
            "-crf", _PREVIEW_CRF if preview else str(SOCIAL_VIDEO_CRF),
            "-maxrate", SOCIAL_MAXRATE,
            "-bufsize", SOCIAL_BUFSIZE,
            "-pix_fmt", "yuv420p",
            "-colorspace", "bt709",
            "-color_primaries", "bt709",
            "-color_trc", "bt709",
        ]

        filter_parts: list[str] = []
        filter_parts.append(f"[0:v]{','.join(vf_parts)}[vbase]")
        video_label = "[vbase]"

        overlay_input = (1 if keep_clip_audio else 2) if use_overlay else None
        sfx_input = (1 if keep_clip_audio else 2) + (1 if use_overlay else 0)

        if use_overlay and overlay_input is not None:
            zone = SAFE_ZONES.get(aspect_ratio, SAFE_ZONES[DEFAULT_ASPECT_RATIO])
            frame_w, frame_h = preview_frame or upscale_dims or (zone["w"], zone["h"])
            image_filter, placement_filter = build_overlay_filters(
                overlay_position, overlay_size, overlay_opacity, frame_w, frame_h
            )
            filter_parts.append(f"[{overlay_input}:v]{image_filter}")
            filter_parts.append(placement_filter)
            filter_parts.append("[vout]format=yuv420p[vfinal]")
            video_label = "[vfinal]"

        audio_src = "0:a:0" if keep_clip_audio else "1:a:0"
        if use_sfx:
            audio_filter = (
                f"[{audio_src}][{sfx_input}:a:0]amix=inputs=2:duration=first:"
                "dropout_transition=0:normalize=0"
            )
            if loudnorm:
                audio_filter += ",loudnorm=I=-16:TP=-1.5:LRA=11"
            filter_parts.append(f"{audio_filter}[aout]")
            audio_label = "[aout]"
        elif loudnorm:
            filter_parts.append(f"[{audio_src}]loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
            audio_label = "[aout]"
        else:
            audio_label = audio_src

        cmd += ["-filter_complex", ";".join(filter_parts)]
        cmd += ["-map", video_label, "-map", audio_label]

        cmd += [
            "-c:a", "aac",
            "-b:a", SOCIAL_AUDIO_BITRATE,
            "-ar", str(SOCIAL_AUDIO_RATE),
            "-movflags", "+faststart",
        ]
        if not keep_clip_audio:
            cmd += ["-shortest"]  # Stops when unified audio finishes
        cmd += [final_output_path]
        run_ffmpeg(cmd, cwd=work_dir)
    finally:
        for temp in (stitched_path, sfx_path):
            try:
                Path(temp).unlink(missing_ok=True)
            except Exception:
                pass

    return final_output_path


def stitch_clips_with_clip_audio(
    processed_clips: list[str],
    final_output_path: str,
    **kwargs,
) -> str:
    """Join clips and preserve their own audio (no unified external audio track)."""
    return stitch_clips_with_audio(processed_clips, None, final_output_path, **kwargs)


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
