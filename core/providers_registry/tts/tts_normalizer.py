"""
TTS text normalizer for Vietnamese voice agent.

Converts numbers and special characters to speakable Vietnamese text
before sending to TTS. The original LLM output and form data are unchanged.

Usage:
    from core.providers_registry.tts.tts_normalizer import normalize_for_tts

    spoken_text = normalize_for_tts("CCCD: 070809112233, sinh 15/09/1990")
    # → "CCCD 070809112233, sinh ngày 15 tháng 9 năm 1990"
    # (digits are spelled out, dates are spoken naturally)
"""

from __future__ import annotations

import re

# Vietnamese digit words
_DIGIT_WORDS = {
    "0": "không",
    "1": "một",
    "2": "hai",
    "3": "ba",
    "4": "bốn",
    "5": "năm",
    "6": "sáu",
    "7": "bảy",
    "8": "tám",
    "9": "chín",
}

_ONES = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]


def _digits_to_words(digits: str) -> str:
    """Spell each digit individually: '070809' → 'không bảy không tám không chín'."""
    return " ".join(_DIGIT_WORDS.get(d, d) for d in digits if d.isdigit())


def _number_to_words(n: int) -> str:
    """Convert a number 0–999 to Vietnamese words."""
    if n == 0:
        return "không"
    if n < 10:
        return _ONES[n]
    if n == 10:
        return "mười"
    if n < 20:
        ones = n % 10
        if ones == 5:
            return "mười lăm"
        if ones == 1:
            return "mười một"
        return f"mười {_ONES[ones]}"
    if n < 100:
        tens = n // 10
        ones = n % 10
        if ones == 0:
            return f"{_ONES[tens]} mươi"
        if ones == 1:
            return f"{_ONES[tens]} mươi mốt"
        if ones == 5:
            return f"{_ONES[tens]} mươi lăm"
        return f"{_ONES[tens]} mươi {_ONES[ones]}"
    if n < 1000:
        hundreds = n // 100
        remainder = n % 100
        if remainder == 0:
            return f"{_ONES[hundreds]} trăm"
        if remainder < 10:
            return f"{_ONES[hundreds]} trăm lẻ {_ONES[remainder]}"
        return f"{_ONES[hundreds]} trăm {_number_to_words(remainder)}"
    return str(n)


def _date_match_to_words(match: re.Match) -> str:
    """Convert DD/MM/YYYY → 'ngày ... tháng ... năm ...'."""
    day_n = int(match.group(1))
    month_n = int(match.group(2))
    year_str = match.group(3)
    day_word = _number_to_words(day_n)
    month_word = _number_to_words(month_n)
    year_word = _digits_to_words(year_str)
    return f"ngày {day_word} tháng {month_word} năm {year_word}"


# Regex patterns
_DATE_PATTERN = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
_LONG_DIGITS = re.compile(r"\d{4,}")
_SHORT_DIGITS = re.compile(r"\b(\d{1,3})\b")


def normalize_for_tts(text: str) -> str:
    """
    Normalize Vietnamese text for TTS consumption.

    Transformations applied in order:
      1. Dates (DD/MM/YYYY) → spoken form ('ngày ... tháng ... năm ...')
      2. Long digit sequences (4+ digits, e.g. CCCD, phone) → digit-by-digit
      3. Short numbers (1–3 digits) → Vietnamese number words
    """
    # 1. Dates first — before digit replacement eats the slashes
    text = _DATE_PATTERN.sub(_date_match_to_words, text)

    # 2. Long digit sequences → spell digit by digit
    text = _LONG_DIGITS.sub(lambda m: _digits_to_words(m.group(0)), text)

    # 3. Short standalone numbers → Vietnamese words
    def _short_to_words(m: re.Match) -> str:
        n = int(m.group(1))
        if n <= 999:
            return _number_to_words(n)
        return m.group(0)

    text = _SHORT_DIGITS.sub(_short_to_words, text)

    return text
