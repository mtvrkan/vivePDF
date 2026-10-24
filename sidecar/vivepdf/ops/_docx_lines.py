from pdf2docx.common.share import TextAlignment
from pdf2docx.text.Line import Line
from pdf2docx.text.Lines import Lines

LIST_MARKERS = frozenset("•●○◦▪▫■□◆◇◊►▸▶▹➢➤➔→✓✔✗✘❖❑❒⁃‣∙·★☆")
DASH_MARKERS = frozenset("-–—*")
PRIVATE_USE = range(0xE000, 0xF900)
JOINED_ENDINGS = frozenset("-‐‑/\u00ad")
FIRST_WIDE_CHARACTER = 0x2E80


def starts_list_item(line: Line) -> bool:
    text = line.text.lstrip()
    if not text:
        return False
    marker = text[0]
    if marker in LIST_MARKERS or ord(marker) in PRIVATE_USE:
        return True
    return marker in DASH_MARKERS and (len(text) == 1 or text[1].isspace())


_plain_parse_line_break = Lines.parse_line_break


def needs_space_between(before: str, after: str) -> bool:
    if not before or not after or before[-1].isspace() or after[0].isspace():
        return False
    if before[-1] in JOINED_ENDINGS:
        return False
    return ord(before[-1]) < FIRST_WIDE_CHARACTER or ord(after[0]) < FIRST_WIDE_CHARACTER


_plain_line_make_docx = Line.make_docx


def make_line_keeping_word_gap(line: Line, paragraph) -> None:
    _plain_line_make_docx(line, paragraph)
    if getattr(line, "soft_space", False) and not line.line_break:
        paragraph.add_run(" ")


def parse_line_break_before_list_items(
    lines: Lines, bbox, line_break_width_ratio: float, line_break_free_space_ratio: float
) -> None:
    _plain_parse_line_break(lines, bbox, line_break_width_ratio, line_break_free_space_ratio)
    rows = lines.group_by_physical_rows()
    right_aligned = lines.parent.alignment == TextAlignment.RIGHT
    for row, following in zip(rows, rows[1:], strict=False):
        end = row[0] if right_aligned else row[-1]
        if starts_list_item(following[0]):
            end.line_break = 1
        end.soft_space = needs_space_between(row[-1].text, following[0].text)
