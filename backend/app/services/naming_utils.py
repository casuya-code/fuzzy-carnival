import re
from datetime import datetime
from zoneinfo import ZoneInfo

EAT_TZ = ZoneInfo("Africa/Dar_es_Salaam")

ENGINE_CODES = {
    "kyutai": "KYU",
    "fluent": "KYU",
    "afrispeech": "AFR",
    "afr": "AFR",
    "msingi": "MSI",
    "mms": "MMS",
}

LANG_CODES = {
    "en": "ENG",
    "english": "ENG",
    "sw": "SWA",
    "swahili": "SWA",
}


def sanitize_topic(topic: str, max_len: int = 24) -> str:
    if not topic or not topic.strip():
        return "Untitled"
    words = re.sub(r"[^a-zA-Z0-9\s]", "", topic).split()
    camel = "".join(w.capitalize() for w in words)
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
    filename = f"Speech_{eng_code}_{lang_code}_{clean_topic}_{date_str}_{time_str}.{ext}"
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
    filename = f"{variant}_{lang_code}_{clean_topic}_{date_str}_{time_str}.{ext}"
    return f"{folder}/{date_str}/{filename}"
