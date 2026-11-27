import re
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

EAT_TZ = ZoneInfo("Africa/Dar_es_Salaam")

ENGINE_CODES = {
    "kyutai": "KYU",
    "afrispeech": "AFR",
    "msingi": "MSI",
    "mms": "MMS",
    "azure": "AZR",
    "elevenlabs": "ELV",
    "cartesia": "CRT",
}

LANG_CODES = {
    "en": "ENG",
    "sw": "SWA",
}


def sanitize_topic(topic: str, max_len: int = 24) -> str:
    if not topic or not topic.strip():
        return "Untitled"
    # Unicode-aware: keep accented/non-Latin names and the author's casing.
    words = re.sub(r"[^\w\s]", "", topic, flags=re.UNICODE).split()
    camel = "".join(w[:1].upper() + w[1:] for w in words)
    return camel[:max_len] or "Untitled"


def get_eat_parts() -> tuple[str, str]:
    now = datetime.now(EAT_TZ)
    return now.strftime("%Y%m%d"), now.strftime("%H%M%S")


def build_speech_r2_key(
    engine: str,
    language: str,
    topic: str = "Untitled",
    ext: str = "mp3",
    date_str: str | None = None,
    time_str: str | None = None,
) -> str:
    eng_code = ENGINE_CODES.get(engine.lower().strip(), "UNK")
    lang_code = LANG_CODES.get(language.lower().strip(), "UNK")
    clean_topic = sanitize_topic(topic)
    if date_str is None or time_str is None:
        date_str, time_str = get_eat_parts()
    suffix = uuid.uuid4().hex[:8]
    filename = f"Speech_{eng_code}_{lang_code}_{clean_topic}_{date_str}_{time_str}_{suffix}.{ext}"
    return f"audio/{date_str}/{filename}"


def build_video_r2_key(
    variant: str,
    language: str,
    topic: str = "Untitled",
    ext: str = "mp4",
    date_str: str | None = None,
    time_str: str | None = None,
) -> str:
    lang_code = LANG_CODES.get(language.lower().strip(), "UNK")
    clean_topic = sanitize_topic(topic)
    if date_str is None or time_str is None:
        date_str, time_str = get_eat_parts()
    folder = "thumbs" if ext.lower() in ("jpg", "jpeg", "png") else "video"
    suffix = uuid.uuid4().hex[:8]
    filename = f"{variant}_{lang_code}_{clean_topic}_{date_str}_{time_str}_{suffix}.{ext}"
    return f"{folder}/{date_str}/{filename}"
