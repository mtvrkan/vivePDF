import html
import io
import math
import re
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from vivepdf.ops._studio_models import StudioTextItem
from vivepdf.ops._studio_text import MIN_SHRINK_SIZE, SHRINK_STEP, TextFaces, upper
from vivepdf.ops.create_bulk import fill_placeholders
from vivepdf.ops.fonts import resolve_face

COMPLEX_RANGES = (
    (0x0590, 0x08FF),
    (0x0900, 0x0DFF),
    (0x0E00, 0x0FFF),
    (0x1000, 0x109F),
    (0x1780, 0x17FF),
    (0xFB1D, 0xFDFF),
    (0xFE70, 0xFEFF),
)
RTL_RANGES = ((0x0590, 0x08FF), (0xFB1D, 0xFDFF), (0xFE70, 0xFEFF))
WIDE_RANGES = ((0x2E80, 0x9FFF), (0xAC00, 0xD7AF), (0xF900, 0xFAFF), (0xFF00, 0xFFEF))


def _escape(code: int) -> str:
    return re.escape(chr(code))


def _class(ranges: tuple[tuple[int, int], ...]) -> re.Pattern[str]:
    return re.compile(
        "[" + "".join(f"{_escape(low)}-{_escape(high)}" for low, high in ranges) + "]"
    )


COMPLEX_SCRIPT = _class(COMPLEX_RANGES)
WIDE_SCRIPT = _class(WIDE_RANGES)
RTL_SCRIPT = _class(RTL_RANGES)
MIRRORED_ALIGN = {"left": "right", "right": "left"}
FAMILY = "vpface"
MEASURE_FACTOR = 50
FIT_TOLERANCE = 0.01
VARIANTS = ((False, False), (True, False), (False, True), (True, True))


def run_texts(item: StudioTextItem, values: dict[str, str], language: str) -> list[str]:
    texts = []
    for run in item.runs:
        text = fill_placeholders(run.text, values) if values else run.text
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        texts.append(upper(text, language) if item.uppercase else text)
    return texts


def needs_shaping(item: StudioTextItem, faces: TextFaces, texts: list[str]) -> bool:
    for run, text in zip(item.runs, texts, strict=True):
        if COMPLEX_SCRIPT.search(text):
            return True
        wide = {char for char in WIDE_SCRIPT.findall(text)}
        if wide:
            font = faces.get(run.bold, run.italic).font
            if any(not font.has_glyph(ord(char)) for char in wide):
                return True
    return False


def _archive(font_id: str | None) -> tuple[pymupdf.Archive, str]:
    archive = pymupdf.Archive()
    rules = []
    seen: dict[Path, str] = {}
    for bold, italic in VARIANTS:
        path, real_italic = resolve_face(font_id, bold, italic)
        if italic and not real_italic:
            continue
        name = seen.get(path)
        if name is None:
            name = f"face{len(seen)}{path.suffix.lower()}"
            seen[path] = name
            archive.add(path.read_bytes(), name)
        weight = "bold" if bold else "normal"
        style = "italic" if italic else "normal"
        rules.append(
            f"@font-face {{font-family: {FAMILY}; src: url({name}); "
            f"font-weight: {weight}; font-style: {style};}}"
        )
    return archive, "\n".join(rules)


def direction(text: str) -> str:
    for char in text:
        if char.isalpha():
            return "rtl" if RTL_SCRIPT.match(char) else "ltr"
    return "ltr"


def _align(item: StudioTextItem, flow: str) -> str:
    return MIRRORED_ALIGN.get(item.align, item.align) if flow == "rtl" else item.align


def _markup(item: StudioTextItem, texts: list[str], flow: str) -> str:
    paragraphs: list[list[str]] = [[]]
    for run, text in zip(item.runs, texts, strict=True):
        style = (
            f"font-weight: {'bold' if run.bold else 'normal'}; "
            f"font-style: {'italic' if run.italic else 'normal'}; "
            f"text-decoration: {'underline' if run.underline else 'none'}; "
            f"color: {run.color};"
        )
        for index, part in enumerate(text.split("\n")):
            if index:
                paragraphs.append([])
            if part:
                paragraphs[-1].append(f'<span style="{style}">{html.escape(part)}</span>')
    return "".join(
        f'<p dir="{flow}">{"".join(spans) if spans else "&#160;"}</p>' for spans in paragraphs
    )


@dataclass
class Prepared:
    item: StudioTextItem
    body: str
    faces_css: str
    archive: pymupdf.Archive
    flow: str

    def css(self, size: float) -> str:
        item = self.item
        spacing = item.letter_spacing * size / item.font_size
        letter = f" letter-spacing: {spacing:.3f}px;" if spacing else ""
        return (
            f"{self.faces_css} "
            f"body {{margin: 0; padding: 0; font-family: {FAMILY}; font-size: {size:.3f}px; "
            f"line-height: {item.line_height * size:.3f}px; "
            f"text-align: {_align(item, self.flow)};{letter}}} "
            "p {margin: 0; padding: 0;}"
        )

    def story(self, size: float) -> pymupdf.Story:
        return pymupdf.Story(html=self.body, user_css=self.css(size), archive=self.archive)

    def height_at(self, size: float) -> float:
        limit = max(self.item.height, size) * MEASURE_FACTOR
        _more, filled = self.story(size).place(pymupdf.Rect(0, 0, self.item.width, limit))
        return pymupdf.Rect(filled).y1


def _fitted(prepared: Prepared) -> tuple[float, float]:
    item = prepared.item
    size = item.font_size
    while True:
        height = prepared.height_at(size)
        fits = height <= item.height + FIT_TOLERANCE
        if not item.shrink_to_fit or fits or size <= MIN_SHRINK_SIZE:
            return size, height
        size = max(MIN_SHRINK_SIZE, size - SHRINK_STEP)


def _rendered(prepared: Prepared, size: float, height: float) -> tuple[pymupdf.Document, float]:
    item = prepared.item
    page_height = max(item.height, height)
    top = {"top": 0.0, "middle": (item.height - height) / 2, "bottom": item.height - height}[
        item.vertical_align
    ]
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    device = writer.begin_page(pymupdf.Rect(0, 0, item.width, page_height))
    story = prepared.story(size)
    story.place(pymupdf.Rect(0, max(0.0, top), item.width, page_height))
    story.draw(device)
    writer.end_page()
    writer.close()
    source = pymupdf.open("pdf", buffer.getvalue())
    if item.opacity < 1:
        page = source[0]
        state = page._set_opacity(CA=item.opacity, ca=item.opacity)  # noqa: SLF001
        pymupdf.TOOLS._insert_contents(page, f"/{state} gs ".encode(), 0)  # noqa: SLF001
    return source, page_height


def _target(item: StudioTextItem, page_height: float) -> pymupdf.Rect:
    angle = math.radians(item.rotation % 360)
    cos, sin = abs(math.cos(angle)), abs(math.sin(angle))
    width = item.width * cos + page_height * sin
    height = item.width * sin + page_height * cos
    cx, cy = item.x + item.width / 2, item.y + page_height / 2
    return pymupdf.Rect(cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2)


def draw_shaped(page: pymupdf.Page, item: StudioTextItem, texts: list[str]) -> None:
    if not any(text.strip() for text in texts):
        return
    archive, faces_css = _archive(item.font_id)
    flow = direction("".join(texts))
    prepared = Prepared(item, _markup(item, texts, flow), faces_css, archive, flow)
    size, height = _fitted(prepared)
    source, page_height = _rendered(prepared, size, height)
    try:
        page.show_pdf_page(_target(item, page_height), source, 0, rotate=-item.rotation)
    finally:
        source.close()
