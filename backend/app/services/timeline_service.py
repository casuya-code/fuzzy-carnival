import re
from typing import Any, Iterable

from app.services.captions_processor import time_words


def _round(v: float) -> float:
    return round(float(v), 3)


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _normalize_word_items(words: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for w in words:
        text = str(w.get("text") or w.get("word") or "").strip()
        if not text:
            continue
        start = float(w.get("start", 0.0) or 0.0)
        end = float(w.get("end", start) or start)
        if end < start:
            end = start
        out.append({"text": text, "start": start, "end": end})
    out.sort(key=lambda x: (x["start"], x["end"]))
    return out


def _ends_sentence(text: str) -> bool:
    return bool(re.search(r"[.!?][\"')\]]*$", text.strip()))


def _ends_clause(text: str) -> bool:
    return bool(re.search(r"[,;:][\"')\]]*$", text.strip()))


def group_words_into_segments(
    words: Iterable[dict[str, Any]],
    *,
    max_words: int = 12,
    max_duration: float = 6.0,
    min_duration: float = 1.2,
) -> list[dict[str, Any]]:
    items = _normalize_word_items(words)
    if not items:
        return []

    segments: list[dict[str, Any]] = []
    cur: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal cur
        if not cur:
            return
        start = cur[0]["start"]
        end = max(w["end"] for w in cur)
        if end < start:
            end = start
        text = _clean_text(" ".join(w["text"] for w in cur))
        segments.append(
            {
                "id": len(segments) + 1,
                "start": _round(start),
                "end": _round(end),
                "duration": _round(max(0.0, end - start)),
                "text": text,
            }
        )
        cur = []

    for i, w in enumerate(items):
        cur.append(w)
        if len(cur) == 1:
            continue

        start = cur[0]["start"]
        end = max(x["end"] for x in cur)
        dur = max(0.0, end - start)
        word_count = len(cur)
        text = " ".join(x["text"] for x in cur)
        has_next = i < len(items) - 1

        if _ends_sentence(w["text"]):
            flush()
            continue

        # Prefer natural breaks once the segment is reasonably sized.
        if dur >= max_duration or word_count >= max_words:
            flush()
            continue

        if has_next and dur >= min_duration and _ends_clause(w["text"]):
            flush()
            continue

        # If the current phrase is already fairly long and next token starts a new sentence-like chunk,
        # let duration/word-count rules handle it; otherwise keep grouping.
        if not has_next and dur > 12.0:
            flush()

    flush()
    return segments


def segments_from_forced_alignment_words(words: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for w in words:
        # Supports SDK objects or plain dicts
        text = getattr(w, "text", None) if not isinstance(w, dict) else w.get("text")
        start = getattr(w, "start", None) if not isinstance(w, dict) else w.get("start")
        end = getattr(w, "end", None) if not isinstance(w, dict) else w.get("end")
        normalized.append({"text": text or "", "start": float(start or 0.0), "end": float(end or 0.0)})
    return group_words_into_segments(normalized)


def _char_alignment_to_words(alignment: Any) -> list[dict[str, Any]]:
    if alignment is None:
        return []
    chars = getattr(alignment, "characters", None) if not isinstance(alignment, dict) else alignment.get("characters")
    starts = (
        getattr(alignment, "character_start_times_seconds", None)
        if not isinstance(alignment, dict)
        else alignment.get("character_start_times_seconds")
    )
    ends = (
        getattr(alignment, "character_end_times_seconds", None)
        if not isinstance(alignment, dict)
        else alignment.get("character_end_times_seconds")
    )
    if not chars or not starts or not ends:
        return []

    words: list[dict[str, Any]] = []
    cur_chars: list[str] = []
    cur_start: float | None = None
    cur_end: float | None = None

    def flush() -> None:
        nonlocal cur_chars, cur_start, cur_end
        if cur_chars and cur_start is not None and cur_end is not None:
            text = "".join(cur_chars).strip()
            if text:
                words.append({"text": text, "start": float(cur_start), "end": float(cur_end)})
        cur_chars = []
        cur_start = None
        cur_end = None

    for ch, st, en in zip(chars, starts, ends):
        chs = str(ch)
        stf = float(st or 0.0)
        enf = float(en or stf)
        if chs.isspace():
            flush()
            continue
        if cur_start is None:
            cur_start = stf
        cur_end = enf if cur_end is None else max(cur_end, enf)
        cur_chars.append(chs)

    flush()
    return words


def segments_from_character_alignment(alignment: Any) -> list[dict[str, Any]]:
    return group_words_into_segments(_char_alignment_to_words(alignment))


def estimate_timeline(text: str, duration_seconds: float | None) -> list[dict[str, Any]]:
    if not text or not duration_seconds or duration_seconds <= 0:
        return []
    # Heuristic fallback from script + known duration (no intro delay for TTS audio files).
    words = time_words(text, float(duration_seconds), intro_delay_sec=0.0)
    normalized = [{"text": w["word"], "start": w["start"], "end": w["end"]} for w in words]
    return group_words_into_segments(normalized)


def extract_timeline_from_elevenlabs_timestamps_response(response: Any) -> list[dict[str, Any]]:
    """Prefer normalized alignment, then alignment, for phrase segments."""
    alignment = getattr(response, "normalized_alignment", None) or getattr(response, "alignment", None)
    if alignment is None and isinstance(response, dict):
        alignment = response.get("normalized_alignment") or response.get("alignment")
    return segments_from_character_alignment(alignment)


def extract_audio_bytes_from_elevenlabs_timestamps_response(response: Any) -> bytes | None:
    audio_b64 = getattr(response, "audio_base_64", None) if not isinstance(response, dict) else response.get("audio_base_64")
    if not audio_b64:
        return None
    import base64

    try:
        return base64.b64decode(audio_b64)
    except Exception:
        return None
