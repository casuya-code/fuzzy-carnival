"""FFmpeg ``xfade`` transitions for the video editor.

Phase 1 uses FFmpeg's built-in xfade names. Phase 2 adds stylized effects
through ``xfade=transition=custom:expr=...`` so they stay in one efficient
filter instead of adding extra overlay/geq passes on the CPU container.
"""

from __future__ import annotations

import json

DEFAULT_TRANSITION = "fade"
DEFAULT_TRANSITION_DURATION_SEC = 0.5
MIN_TRANSITION_DURATION_SEC = 0.1
MAX_TRANSITION_DURATION_SEC = 1.5

_PI = "3.141592653589793"
_S = f"sin({_PI}*P)"
_BASE = "A*(1-P)+B*P"


def _src_a(x: str, y: str = "Y") -> str:
    """Sample first input with the plane-aware component accessor."""
    return f"if(eq(PLANE,0),a0({x},{y}),if(eq(PLANE,1),a1({x},{y}),a2({x},{y})))"


def _src_b(x: str, y: str = "Y") -> str:
    """Sample second input with the plane-aware component accessor."""
    return f"if(eq(PLANE,0),b0({x},{y}),if(eq(PLANE,1),b1({x},{y}),b2({x},{y})))"


_FLARE = f"exp(-20*pow(hypot(X/W-0.5,Y/H-0.5)-0.24*{_S},2))*{_S}"
_BURN_S = f"{_S}*exp(-14*pow(Y/H-P,2))"
_GLITCH_SX = f"26*{_S}*(random(floor(Y/12)+floor(P*24)*31)-0.5)"
_REVEAL_JAG = f"P+0.18*(random(floor(Y/14)+floor(P*22)*17)-0.5)*{_S}"
_REVEAL_SX = f"18*{_S}*(random(floor(Y/8)+floor(P*30))-0.5)"
_BAND_OFF = f"34*{_S}*(random(floor(Y/20)+floor(P*18)*7)-0.5)"
_BAND_LINE = f"{_S}*exp(-30*pow(Y/H-P,2))"
_FIRE_F = (
    f"{_S}*exp(-9*pow(X/W-0.5-0.13*sin(12*Y/H+P*18),2))"
    f"*(0.6+0.4*random(floor(X/10)+floor(P*36)*11))"
)
_FIRE_EDGE = f"P+0.16*sin(10*Y/H+P*14)+0.08*(random(floor(Y/8)+floor(P*24))-0.5)"
_WARP = f"0.10*sin(12*Y/H+P*7)+0.05*sin(25*Y/H-P*11)"
_STREAK_EDGE = f"P+{_WARP}*{_S}"
# Grow the drops well past the frame edges so P=1 fully reveals clip B
# (including corners) instead of leaving the old uncovered patches (M17).
_DROP_RADIUS_SCALE = 2.4
_DROPS = (
    f"lt(hypot(X/W-0.28,Y/H-0.32),{0.45 * _DROP_RADIUS_SCALE:.3f}*P)"
    f"+lt(hypot(X/W-0.72,Y/H-0.58),{0.38 * _DROP_RADIUS_SCALE:.3f}*P)"
    f"+lt(hypot(X/W-0.50,Y/H-0.82),{0.30 * _DROP_RADIUS_SCALE:.3f}*P)"
)
# Start tiny, grow past the frame edges so the final frame is entirely clip B.
_HEART_SCALE = "0.001+2.999*P"
_HEART_X = f"(X/W-0.5)*2.6/({_HEART_SCALE})"
_HEART_Y = f"(0.5-Y/H)*2.6/({_HEART_SCALE})"
_HEART = (
    f"pow({_HEART_X}*{_HEART_X}+{_HEART_Y}*{_HEART_Y}-1,3)"
    f"-{_HEART_X}*{_HEART_X}*{_HEART_Y}*{_HEART_Y}*{_HEART_Y}"
)
# sin(pi*P) fades the mirrored sampling in and back out, so P=0 is clip A
# unflipped and P=1 is clip B unflipped.
_EXCHANGE_MIRROR = f"sin({_PI}*P)"
_EXCHANGE_B_X = f"X+{_EXCHANGE_MIRROR}*(P*W-2*X)"
_EXCHANGE_A_X = f"X+{_EXCHANGE_MIRROR}*((1+P)*W-2*X)"
# Custom xfade expressions. All are plain FFmpeg eval expressions with no
# single quotes so they can be wrapped safely inside the filtergraph.
CUSTOM_TRANSITION_EXPRS: dict[str, str] = {
    "bloom": f"if(eq(PLANE,0),{_BASE}+85*{_FLARE},{_BASE})",
    "burn": (
        f"if(eq(PLANE,0),{_BASE}+80*{_BURN_S},"
        f"if(eq(PLANE,1),{_BASE}-28*{_BURN_S},{_BASE}+38*{_BURN_S}))"
    ),
    "glitch": f"{_src_a(f'X+{_GLITCH_SX}')}*(1-P)+{_src_b(f'X-{_GLITCH_SX}')}*P",
    "glitchreveal": (
        f"if(lt(X/W,{_REVEAL_JAG}),{_src_b(f'X-{_REVEAL_SX}')},{_src_a(f'X+{_REVEAL_SX}')})"
    ),
    "banding": (
        f"if(eq(PLANE,0),{_src_a(f'X+{_BAND_OFF}')}*(1-P)"
        f"+{_src_b(f'X-{_BAND_OFF}')}*P+45*{_BAND_LINE},"
        f"{_src_a(f'X+{_BAND_OFF}')}*(1-P)+{_src_b(f'X-{_BAND_OFF}')}*P)"
    ),
    "fire": (
        f"if(lt(X/W,{_FIRE_EDGE}),"
        f"{_BASE}+if(eq(PLANE,0),70*{_FIRE_F},if(eq(PLANE,1),-25*{_FIRE_F},45*{_FIRE_F})),"
        f"{_BASE})"
    ),
    "liquidstreaks": (
        f"if(lt(X/W,{_STREAK_EDGE}),"
        f"{_src_b(f'X-{_WARP}*{_S}*25')},{_src_a(f'X+{_WARP}*{_S}*25')})"
    ),
    "liquiddrops": f"if({_DROPS},B,A)",
    "heart": f"if(lt({_HEART},0),B,A)",
    "exchange": f"if(lt(X,P*W),{_src_b(_EXCHANGE_B_X)},{_src_a(_EXCHANGE_A_X)})",
}

CUSTOM_TRANSITION_IDS: frozenset[str] = frozenset(CUSTOM_TRANSITION_EXPRS)

# (filter name, short UI label). Built-in xfade names are used verbatim.
TRANSITION_GROUPS: dict[str, tuple[tuple[str, str], ...]] = {
    "Fades & blurs": (
        ("fade", "Cross fade"),
        ("dissolve", "Dissolve"),
        ("fadeblack", "Fade through black"),
        ("fadewhite", "Fade through white"),
        ("hblur", "Blur fade"),
        ("fadegrays", "Fade to gray"),
        ("fadefast", "Fast fade"),
        ("fadeslow", "Slow fade"),
        ("bloom", "Bloom"),
        ("burn", "Burn"),
    ),
    "Wipes & pushes": (
        ("smoothleft", "Soft wipe left"),
        ("smoothright", "Soft wipe right"),
        ("smoothup", "Soft wipe up"),
        ("smoothdown", "Soft wipe down"),
        ("wipeleft", "Wipe left"),
        ("wiperight", "Wipe right"),
        ("wipeup", "Wipe up"),
        ("wipedown", "Wipe down"),
        ("slideleft", "Push left"),
        ("slideright", "Push right"),
        ("slideup", "Push up"),
        ("slidedown", "Push down"),
        ("circleopen", "Circle open"),
        ("circleclose", "Circle close"),
        ("vertopen", "Barn doors (vertical)"),
        ("vertclose", "Barn doors close"),
        ("horzopen", "Barn doors (horizontal)"),
        ("horzclose", "Barn doors close"),
    ),
    "Geometric & slices": (
        ("diagtl", "Diagonal TL→BR"),
        ("diagtr", "Diagonal TR→BL"),
        ("diagbl", "Diagonal BL→TR"),
        ("diagbr", "Diagonal BR→TL"),
        ("hlslice", "Half-left slice"),
        ("hrslice", "Half-right slice"),
        ("vuslice", "Vertical up slice"),
        ("vdslice", "Vertical down slice"),
        ("pixelize", "Pixelate"),
        ("radial", "Radial wipe"),
        ("squeezeh", "Squeeze horizontal"),
        ("squeezev", "Squeeze vertical"),
        ("circlecrop", "Circle crop"),
        ("rectcrop", "Rectangle crop"),
        ("distance", "Distance"),
        ("heart", "Heart"),
    ),
    "Motion & reveal": (
        ("zoomin", "Zoom in"),
        ("coverleft", "Cover left"),
        ("coverright", "Cover right"),
        ("coverup", "Cover up"),
        ("coverdown", "Cover down"),
        ("revealleft", "Reveal left"),
        ("revealright", "Reveal right"),
        ("revealup", "Reveal up"),
        ("revealdown", "Reveal down"),
        ("hlwind", "Wind left"),
        ("hrwind", "Wind right"),
        ("vuwind", "Wind up"),
        ("vdwind", "Wind down"),
        ("exchange", "Exchange"),
    ),
    "Glitch, retro & stylized": (
        ("glitch", "Glitch"),
        ("glitchreveal", "Glitch reveal"),
        ("banding", "Horizontal banding"),
        ("fire", "Fire"),
        ("liquidstreaks", "Liquid streaks"),
        ("liquiddrops", "Liquid drops"),
    ),
    # Corner wipes (extra Clipchamp-style diagonal options).
    "Corner wipes": (
        ("wipetl", "Wipe from top-left"),
        ("wipetr", "Wipe from top-right"),
        ("wipebl", "Wipe from bottom-left"),
        ("wipebr", "Wipe from bottom-right"),
    ),
}

ALLOWED_TRANSITIONS: frozenset[str] = frozenset(
    name for group in TRANSITION_GROUPS.values() for name, _label in group
)
TRANSITION_LABELS: dict[str, str] = {
    name: label for group in TRANSITION_GROUPS.values() for name, label in group
}


def normalize_transition(value: str | None, default: str = DEFAULT_TRANSITION) -> str:
    """Validate a transition name and return its canonical xfade name."""
    name = str(value or default).strip().lower()
    if name not in ALLOWED_TRANSITIONS:
        raise ValueError(
            f"Unsupported transition '{value}'. "
            f"Choose one of: {', '.join(sorted(ALLOWED_TRANSITIONS))}"
        )
    return name


def parse_transitions(raw: str | None, count: int, default: str = DEFAULT_TRANSITION) -> list[str]:
    """Parse a JSON array of per-gap transitions, padding with ``default``."""
    if count <= 0:
        return []
    base = normalize_transition(default)
    if not raw or not str(raw).strip():
        return [base] * count
    try:
        parsed = json.loads(raw)
    except Exception as exc:
        raise ValueError("transitions must be a JSON array of transition names") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise ValueError("transitions must be a JSON array of transition names")
    values = [normalize_transition(item) for item in parsed[:count]]
    while len(values) < count:
        values.append(base)
    return values


def _xfade_filter(name: str, overlap: float, offset: float) -> str:
    """Return the xfade filter string for a native or custom transition."""
    timing = f"duration={overlap:.3f}:offset={offset:.3f}"
    if name in CUSTOM_TRANSITION_EXPRS:
        expr = CUSTOM_TRANSITION_EXPRS[name]
        return f"xfade=transition=custom:expr='{expr}':{timing}"
    return f"xfade=transition={name}:{timing}"


def transition_events(
    durations: list[float],
    transitions: list[str],
    duration_sec: float,
) -> list[tuple[str, float, float]]:
    """Return (transition, start offset, overlap) for every clip gap.

    Uses the same clamping as the xfade filtergraph so generated SFX land on
    the exact frame where each transition starts.
    """
    if len(durations) < 2:
        return []
    if len(transitions) != len(durations) - 1:
        raise ValueError("One transition is required per clip gap")

    requested = max(MIN_TRANSITION_DURATION_SEC, min(float(duration_sec), MAX_TRANSITION_DURATION_SEC))
    events: list[tuple[str, float, float]] = []
    elapsed = float(durations[0])

    for i in range(1, len(durations)):
        name = normalize_transition(transitions[i - 1])
        max_overlap = min(float(durations[i - 1]), float(durations[i])) * 0.5
        if max_overlap < 0.05:
            raise ValueError(
                "Transition duration exceeds the available clip duration; "
                "clips must be at least 0.1 seconds long"
            )
        overlap = min(requested, max_overlap)
        offset = max(0.0, elapsed - overlap)
        events.append((name, offset, overlap))
        elapsed += float(durations[i]) - overlap

    return events


def build_xfade_filtergraph(
    durations: list[float],
    transitions: list[str],
    duration_sec: float,
) -> tuple[str, str, float]:
    """Build an ``xfade`` chain and return (filtergraph, final_label, duration).

    Each transition is clamped to half of the shorter adjacent clip so ffmpeg
    never receives an overlap longer than either input.
    """
    if len(durations) < 2:
        raise ValueError("At least two clips are required for a transition")
    events = transition_events(durations, transitions, duration_sec)

    parts: list[str] = []
    current_label = "0:v"
    elapsed = float(durations[0])

    for i, (name, _offset, overlap) in enumerate(events, 1):
        # Recompute the offset here so the filtergraph and SFX bed stay identical.
        offset = max(0.0, elapsed - overlap)
        out_label = f"x{i}"
        parts.append(
            f"[{current_label}][{i}:v]{_xfade_filter(name, overlap, offset)}[{out_label}]"
        )
        current_label = out_label
        elapsed += float(durations[i]) - overlap

    return ";".join(parts), current_label, elapsed


# Readable alias for callers that no longer think of every effect as "xfade".
build_transition_filtergraph = build_xfade_filtergraph
