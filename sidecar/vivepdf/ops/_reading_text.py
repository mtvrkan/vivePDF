import pymupdf

BULLET = "•"
PRIVATE_USE_FIRST = 0xE000
PRIVATE_USE_LAST = 0xF8FF
SYMBOL_FONT_BASE = 0xF000
SYMBOL_UPPER = "ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ"
SYMBOL_LOWER = "αβχδεφγηιϕκλμνοπθρστυϖωξψζ"
SYMBOL_EXTRA = {
    0xB7: BULLET,
    0xA5: "∞",
    0xB1: "±",
    0xB4: "×",
    0xB8: "÷",
    0xB9: "≠",
    0xA3: "≤",
    0xB3: "≥",
    0xBB: "≈",
    0xD6: "√",
    0xE5: "∑",
    0xF2: "∫",
    0xB6: "∂",
    0xAE: "→",
    0xAC: "←",
}


def _is_private_use(char: str) -> bool:
    return PRIVATE_USE_FIRST <= ord(char) <= PRIVATE_USE_LAST


def _symbol_char(code: int) -> str:
    if 0x41 <= code <= 0x5A:
        return SYMBOL_UPPER[code - 0x41]
    if 0x61 <= code <= 0x7A:
        return SYMBOL_LOWER[code - 0x61]
    if code in SYMBOL_EXTRA:
        return SYMBOL_EXTRA[code]
    if 0x20 <= code <= 0x3F:
        return chr(code)
    return BULLET


def _readable(char: str, symbol_font: bool) -> str:
    if not _is_private_use(char):
        return char
    code = ord(char)
    if symbol_font and SYMBOL_FONT_BASE <= code <= SYMBOL_FONT_BASE + 0xFF:
        return _symbol_char(code - SYMBOL_FONT_BASE)
    return BULLET


def _span_text(span: dict) -> str:
    symbol_font = "symbol" in str(span.get("font", "")).lower()
    return "".join(_readable(char, symbol_font) for char in span.get("text", ""))


def _block_text(block: dict) -> str:
    lines = (
        "".join(_span_text(span) for span in line.get("spans", ()))
        for line in block.get("lines", ())
    )
    return "\n".join(line.rstrip() for line in lines if line.strip())


def reading_text(page: pymupdf.Page) -> str:
    content = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
    blocks = (_block_text(block) for block in content.get("blocks", ()) if block.get("type") == 0)
    return "\n\n".join(text.strip() for text in blocks if text.strip())
