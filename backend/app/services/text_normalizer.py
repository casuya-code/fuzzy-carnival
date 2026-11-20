import re

_SW_DIGITS = {
    "0": "sifuri", "1": "moja", "2": "mbili", "3": "tatu", "4": "nne",
    "5": "tano", "6": "sita", "7": "saba", "8": "nane", "9": "tisa",
}

_SW_TENS = {
    "10": "kumi", "20": "ishirini", "30": "thelathini", "40": "arobaini",
    "50": "hamsini", "60": "sitini", "70": "sabini", "80": "themanini",
    "90": "tisini", "100": "mia", "1000": "elfu",
}


def _en_number_to_words(n: int) -> str:
    try:
        from num2words import num2words
        return num2words(n, lang="en")
    except Exception:
        return str(n)


def _sw_number_to_words(n: int) -> str:
    if n < 10:
        return _SW_DIGITS[str(n)]
    if str(n) in _SW_TENS:
        return _SW_TENS[str(n)]
    if n < 20:
        return "kumi na " + _SW_DIGITS[str(n - 10)]
    if n < 100:
        tens = (n // 10) * 10
        ones = n % 10
        base = _SW_TENS.get(str(tens), str(tens))
        return base if ones == 0 else base + " na " + _SW_DIGITS[str(ones)]
    if n < 1000:
        hundreds = n // 100
        rest = n % 100
        base = (_SW_DIGITS[str(hundreds)] + " mia") if hundreds > 1 else "mia"
        return base if rest == 0 else base + " " + _sw_number_to_words(rest)
    # Fallback for large numbers
    return str(n)


def normalize_numbers(text: str, language: str = "en") -> str:
    def repl(m):
        num = int(m.group(0))
        if language == "sw":
            return _sw_number_to_words(num)
        return _en_number_to_words(num)

    return re.sub(r"\b\d+\b", repl, text)


def normalize_text(text: str, language: str = "en") -> str:
    text = text.strip()
    # Expand common abbreviations
    if language == "en":
        text = text.replace("Dr.", "Doctor").replace("Mr.", "Mister").replace("Mrs.", "Missus")
    # Try the dedicated Swahili text normalizer (numbers, dates, times, decimals)
    if language == "sw":
        try:
            from kiswahili_text_normalizer import normalize_text as sw_normalize

            text = sw_normalize(text, profile="tts")
        except Exception:
            pass
    # Normalize numbers (fallback / English)
    text = normalize_numbers(text, language)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)
    # Ensure Swahili sentences end with punctuation so MMS-TTS inserts pauses
    if language == "sw":
        if text and text[-1] not in ".!?":
            text = text + "."
        text = text.replace(";", ".").replace(":", ",")
    return text