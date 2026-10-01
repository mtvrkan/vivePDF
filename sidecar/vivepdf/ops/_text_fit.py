import pymupdf

MIN_FONT_SIZE = 4.0
ELLIPSIS = "\u2026"
MAX_REPORTED_GLYPHS = 20


def fit_line(font: pymupdf.Font, text: str, size: float, room: float) -> tuple[str, float]:
    width = font.text_length(text, fontsize=size)
    if width > room:
        size = max(MIN_FONT_SIZE, size * room / width)
    while text and font.text_length(text, fontsize=size) > room:
        text = text[:-2] + ELLIPSIS if len(text) > 1 else ""
    return text, size
