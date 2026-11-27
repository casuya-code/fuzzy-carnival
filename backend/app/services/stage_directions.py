"""Interpret inline delivery directions in TTS scripts.

Supported markup (all of it is *performed*, never read out loud):

* ``[pause]``, ``[short pause]``, ``[long pause]``, ``[pause 1.2s]``,
  ``[pause:800ms]``, ``[beat]``, ``[silence]`` -> real silence in the audio.
* Any other bracketed note (``[measured, inquisitive tone]``,
  ``[serious, cautionary tone]``, ``[reflective, measured tone]`` ...) is a
  performance hint. It is stripped from the speech and, when recognised,
  nudges the speaking pace slightly.
* ``<emphasis>...</emphasis>`` / ``<em>...</emphasis>`` -> the tags are
  stripped and the words are spoken normally.

The parser degrades gracefully: malformed or unknown markup is simply dropped
from the spoken text rather than being pronounced as words like "bracket".
"""

from __future__ import annotations

import re
from dataclasses import dataclass

DEFAULT_PAUSE_MS = 700
LONG_PAUSE_MS = 1200
SHORT_PAUSE_MS = 350
MAX_PAUSE_MS = 5000

# Anything in square brackets, or an emphasis-style HTML tag.
_DIRECTIVE_RE = re.compile(
    r"\[[^\[\]]*\]|<\s*/?\s*(?:emphasis|em|strong|b)\s*>", re.IGNORECASE
)
_OPEN_TAG_RE = re.compile(r"<\s*(?:emphasis|em|strong|b)\s*>", re.IGNORECASE)
_PAUSE_VALUE_RE = re.compile(
    r"pause\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds)?", re.IGNORECASE
)

_SLOW_WORDS = frozenset({
    "measured", "reflective", "calm", "serious", "cautionary", "solemn",
    "somber", "slow", "deliberate", "thoughtful", "gentle", "quiet",
})
_FAST_WORDS = frozenset({
    "excited", "urgent", "energetic", "brisk", "lively", "hopeful",
    "warm", "inquisitive", "enthusiastic", "bright",
})


@dataclass(frozen=True)
class StageScript:
    """The spoken text plus the boundaries that must become silence."""

    spoken: str
    segments: tuple[str, ...]
    gaps_ms: tuple[int, ...]  # len == len(segments) - 1
    tone: str
    pause_count: int
    emphasis_count: int

    @property
    def has_boundaries(self) -> bool:
        return len(self.segments) > 1


def _pause_ms(content: str) -> int | None:
    """Return silence duration for a bracket note, or None if it is not a pause."""
    value = content.strip().lower()
    if not value:
        return None
    if value in {"pause", "beat", "silence", "hold", "breath"}:
        return DEFAULT_PAUSE_MS
    if value in {"short pause", "brief pause", "micro pause", "short beat"}:
        return SHORT_PAUSE_MS
    if value in {"long pause", "long beat", "dramatic pause"}:
        return LONG_PAUSE_MS
    match = _PAUSE_VALUE_RE.fullmatch(value)
    if match:
        amount = float(match.group(1))
        unit = (match.group(2) or "ms").lower()
        ms = int(round(amount * 1000)) if unit.startswith("s") else int(round(amount))
        return max(100, min(MAX_PAUSE_MS, ms))
    return None


def _clean_piece(piece: str) -> str:
    return re.sub(r"\s+", " ", piece).strip()


def parse_stage_directions(text: str) -> StageScript:
    """Split a script into spoken segments and the pauses between them."""
    raw = text or ""

    # Each part is (spoken chunk, silence before this chunk). Only [pause]
    # directives create a boundary; tone notes and emphasis tags are simply
    # dropped from the stream of words.
    parts: list[tuple[str, int]] = []
    buffer: list[str] = []
    pending_gap = 0
    tones: list[str] = []
    pause_count = 0
    emphasis_count = 0

    def flush() -> None:
        nonlocal buffer, pending_gap
        piece = _clean_piece("".join(buffer))
        buffer = []
        if piece:
            parts.append((piece, pending_gap))
            pending_gap = 0

    def joiner(following: str) -> str:
        """Keep punctuation tight; add a space only between glued-together words."""
        prefix = "".join(buffer).rstrip()
        if (
            prefix
            and following
            and not following[0].isspace()
            and prefix[-1].isalnum()
            and following[0].isalnum()
        ):
            return " "
        return ""

    cursor = 0
    for match in _DIRECTIVE_RE.finditer(raw):
        buffer.append(raw[cursor:match.start()])
        cursor = match.end()
        token = match.group(0)
        following = raw[cursor : cursor + 1]

        if token.startswith("["):
            content = token[1:-1]
            gap = _pause_ms(content)
            if gap is not None:
                flush()
                pending_gap = max(pending_gap, gap)
                pause_count += 1
            elif content.strip():
                # Tone / performance note: perform it, never pronounce it.
                tones.append(content.strip())
                buffer.append(joiner(following))
            continue

        # HTML-ish emphasis tag: keep the words, drop the markup.
        emphasis_count += 1
        if _OPEN_TAG_RE.fullmatch(token):
            tones.append("emphasis")
        buffer.append(joiner(following))

    buffer.append(raw[cursor:])
    flush()

    # A leading or trailing pause has nothing to separate; drop it.
    segments = [piece for piece, _ in parts]
    gaps = [gap for _, gap in parts[1:]]
    if not segments:
        return StageScript("", (), (), ", ".join(tones), pause_count, emphasis_count)

    return StageScript(
        spoken=" ".join(segments),
        segments=tuple(segments),
        gaps_ms=tuple(gaps),
        tone=", ".join(tones),
        pause_count=pause_count,
        emphasis_count=emphasis_count,
    )


def suggested_rate(tone: str) -> float | None:
    """Map recognised tone words to a gentle, bounded pace hint.

    Returns None when the tone is neutral or unknown, so the engine keeps its
    natural pace. An explicit ``speaking_rate`` from the caller always wins.
    """
    words = set(re.findall(r"[a-z]+", (tone or "").lower()))
    slow = len(words & _SLOW_WORDS)
    fast = len(words & _FAST_WORDS)
    if slow == fast:
        return None
    delta = 0.04 * (fast - slow)
    return round(max(0.88, min(1.12, 1.0 + delta)), 3)
