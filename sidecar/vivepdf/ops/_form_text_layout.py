import pymupdf

from vivepdf.ops._form_detect_params import (
    BOX_GLYPHS,
    BOX_SHARE,
    LEADER_MIN,
    LEADER_UNDERLINE,
    LEADER_WEIGHTS,
    PAGE_REFERENCE,
    PAGE_REFERENCE_GAP,
    SYMBOL_FONT_BOXES,
    SYMBOL_FONTS,
    DetectParams,
)

Word = tuple[float, float, float, float, str, int, int, int]


class _TextLayout:
    def __init__(self) -> None:
        self.words: list[Word] = []
        self.leaders: list[pymupdf.Rect] = []
        self.boxes: list[pymupdf.Rect] = []


def _is_box_glyph(character: str, font: str) -> bool:
    if character in BOX_GLYPHS:
        return True
    return character in SYMBOL_FONT_BOXES and any(name in font.casefold() for name in SYMBOL_FONTS)


def _leader_end(chars: list[tuple[dict, dict]], start: int) -> tuple[int, int]:
    end = start
    weight = 0
    index = start
    while index < len(chars):
        character = chars[index][0]["c"]
        if character in LEADER_WEIGHTS:
            weight += LEADER_WEIGHTS[character]
            end = index + 1
        elif not character.isspace():
            break
        index += 1
    return end, weight


def _box_rect(char: dict, size: float) -> pymupdf.Rect:
    x0, _y0, x1, _y1 = char["bbox"]
    baseline = char["origin"][1]
    side = min(x1 - x0, size) * BOX_SHARE
    middle = (x0 + x1) / 2
    return pymupdf.Rect(middle - side / 2, baseline - side, middle + side / 2, baseline)


def _leader_rect(chars: list[tuple[dict, dict]], field_height: float) -> pymupdf.Rect:
    first, span = chars[0]
    last = chars[-1][0]
    bottom = first["origin"][1] + LEADER_UNDERLINE * span["size"]
    return pymupdf.Rect(first["bbox"][0], bottom - field_height, last["bbox"][2], bottom)


def _page_reference_follows(
    chars: list[tuple[dict, dict]], end: int, run: list[tuple[dict, dict]]
) -> bool:
    if any(char["c"] == "_" for char, _span in run):
        return False
    following = "".join(char["c"] for char, _span in chars[end:]).split()
    if not following or not PAGE_REFERENCE.fullmatch(following[0].strip(".,;:")):
        return False
    start = next(char for char, _span in chars[end:] if not char["c"].isspace())
    return start["bbox"][0] - run[-1][0]["bbox"][2] <= PAGE_REFERENCE_GAP


def _close_word(words: list[Word], current: list[dict], block: int, line: int) -> None:
    if not current:
        return
    words.append(
        (
            min(char["bbox"][0] for char in current),
            min(char["bbox"][1] for char in current),
            max(char["bbox"][2] for char in current),
            max(char["bbox"][3] for char in current),
            "".join(char["c"] for char in current),
            block,
            line,
            len(words),
        )
    )
    current.clear()


def _text_layout(page: pymupdf.Page, params: DetectParams) -> _TextLayout:
    layout = _TextLayout()
    for block_number, block in enumerate(page.get_text("rawdict")["blocks"]):
        for line_number, line in enumerate(block.get("lines", [])):
            chars = [(char, span) for span in line["spans"] for char in span["chars"]]
            horizontal = abs(line["dir"][0] - 1) < 0.01
            current: list[dict] = []
            index = 0
            while index < len(chars):
                char, span = chars[index]
                character = char["c"]
                if character.isspace():
                    _close_word(layout.words, current, block_number, line_number)
                    index += 1
                    continue
                if horizontal and _is_box_glyph(character, span.get("font", "")):
                    _close_word(layout.words, current, block_number, line_number)
                    layout.boxes.append(_box_rect(char, span["size"]))
                    index += 1
                    continue
                if horizontal and character in LEADER_WEIGHTS:
                    end, weight = _leader_end(chars, index)
                    run = chars[index:end]
                    rect = _leader_rect(run, params.field_height)
                    if weight >= LEADER_MIN and rect.width >= params.min_line_width:
                        _close_word(layout.words, current, block_number, line_number)
                        if not _page_reference_follows(chars, end, run):
                            layout.leaders.append(rect)
                        index = end
                        continue
                current.append(char)
                index += 1
            _close_word(layout.words, current, block_number, line_number)
    return layout
