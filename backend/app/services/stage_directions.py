"""Interpret inline delivery directions in TTS scripts.

Supported markup (all of it is *performed*, never read out loud):

* ``[pause]``, ``[short pause]``, ``[long pause]``, ``[pause 1.2s]``,
  ``[pause:800ms]``, ``[beat]``, ``[silence]`` -> real silence in the audio.
* Any other bracketed note (``[measured, inquisitive tone]``,
  ``[serious, cautionary tone]``, ``[reflective, measured tone]`` ...) is a
  performance hint. It is stripped from the speech and, when recognised,
  nudges the speaking pace slightly.
* Scoped performance tags (Fish Audio style): ``<emphasis>...</emphasis>``,
  ``<whisper>...</whisper>``, ``<soft>...</soft>``, ``<fast>...</fast>``,
  ``<slow>...</slow>``, ``<stress>...</stress>``, ``<forceful>...</forceful>``.
  Tags are stripped; the wrapped words are spoken with the requested delivery.
* Fish Audio style inline tokens: ``[angry]``, ``[whispering]``, ``[excited]``,
  ``[laughing]``, and the parenthesised S1 forms ``(break)``, ``(long-break)``,
  ``(breath)``, ``(soft tone)``, ``(in a hurry tone)`` etc. are all performed,
  never read out loud.

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

# Scoped performance tags used by Fish Audio and similar editors.
_SCOPED_TAGS = (
    "whisper", "emphasis", "em", "strong", "b",
    "soft", "fast", "slow", "stress", "forceful",
)
# Parenthesised tokens are only treated as markup when they are one of these
# known performance/effect tokens, so ordinary "(hello)" stays spoken.
_PAREN_TOKENS = (
    "break", "long-break", "long break", "breath",
    "pause", "long pause", "short pause", "beat",
    "laughing", "chuckling", "sighing", "soft tone", "whispering",
    "in a hurry tone", "shouting", "excited",
    # Fish S1 node tokens
    "laugh", "cough", "lip-smacking", "lip smacking", "sigh",
)

_DIRECTIVE_RE = re.compile(
    r"\[[^\[\]]*\]"
    r"|<\s*/?\s*(?:" + "|".join(_SCOPED_TAGS) + r")\s*>"
    r"|\(\s*(?:" + "|".join(_PAREN_TOKENS) + r")\s*\)",
    re.IGNORECASE,
)
_OPEN_TAG_RE = re.compile(
    r"<\s*(?P<tag>" + "|".join(_SCOPED_TAGS) + r")\s*>", re.IGNORECASE
)
_PAUSE_VALUE_RE = re.compile(
    r"(?:pause|break)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds)?",
    re.IGNORECASE,
)

_SLOW_WORDS = frozenset({
    "measured", "reflective", "calm", "serious", "cautionary", "solemn",
    "somber", "slow", "deliberate", "thoughtful", "gentle", "quiet",
    "whisper", "whispering", "soft", "reluctant", "sad", "sympathetic",
})
_FAST_WORDS = frozenset({
    "excited", "urgent", "energetic", "brisk", "lively", "hopeful",
    "warm", "inquisitive", "enthusiastic", "bright", "fast", "hurry",
    "hurried", "shouting", "stress", "forceful",
})

# Ordered so the most specific delivery wins. Values are Cartesia Sonic-3
# emotions; other engines simply ignore the hint.
_EMOTION_HINTS: tuple[tuple[frozenset[str], str], ...] = (
    (frozenset({"angry", "mad", "outraged", "furious"}), "angry"),
    (frozenset({"anxious", "nervous", "panicked", "panic"}), "anxious"),
    (frozenset({"sad", "sorrowful", "melancholic", "dejected", "grief"}), "sad"),
    (frozenset({"laughing", "laugh", "chuckling", "joyful"}), "happy"),
    (frozenset({"euphoric", "excited", "enthusiastic", "energetic"}), "excited"),
    (frozenset({"curious", "inquisitive"}), "curious"),
    (frozenset({"sympathetic", "empathetic", "caring"}), "sympathetic"),
    (frozenset({"mysterious", "ominous"}), "mysterious"),
    (frozenset({"whisper", "whispering", "soft", "gentle", "calm",
                "serene", "peaceful", "quiet"}), "calm"),
    (frozenset({"measured", "reflective", "solemn", "serious",
                "contemplative"}), "contemplative"),
    (frozenset({"hopeful", "anticipation", "expectant"}), "anticipation"),
    (frozenset({"forceful", "determined", "shouting", "stress"}), "determined"),
    (frozenset({"tired", "weary", "sighing"}), "tired"),
    (frozenset({"happy", "content", "warm", "cheerful"}), "happy"),
)


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
    if value in {"pause", "beat", "silence", "hold", "breath", "break", "longbreak"}:
        return DEFAULT_PAUSE_MS
    if value in {"short pause", "brief pause", "micro pause", "short beat", "short break"}:
        return SHORT_PAUSE_MS
    # Non-speech sound effects: we can't synthesize the sound itself, but a
    # brief silence keeps the rhythm natural instead of speaking the token.
    if value in {"laugh", "cough", "sigh", "lip-smacking", "lip smacking"}:
        return SHORT_PAUSE_MS
    if value in {"long pause", "long beat", "dramatic pause", "long-break", "long break"}:
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

        if token.startswith(("[", "(")):
            # Square brackets (Fish S2) and parentheses (Fish S1) both carry
            # inline performance notes; pauses create a real audio boundary.
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

        # Scoped performance tag: keep the words, drop the markup, and remember
        # the requested delivery (e.g. whisper / slow / fast).
        emphasis_count += 1
        open_tag = _OPEN_TAG_RE.fullmatch(token)
        if open_tag:
            tones.append(open_tag.group("tag").lower())
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


def suggested_emotion(tone: str) -> str | None:
    """Map recognised tone words to an engine emotion (Cartesia Sonic-3).

    Returns None for neutral/unknown notes so the voice keeps its natural
    delivery. Only engines that support emotion control use this hint.
    """
    words = set(re.findall(r"[a-z]+", (tone or "").lower()))
    for candidates, emotion in _EMOTION_HINTS:
        if words & candidates:
            return emotion
    return None
