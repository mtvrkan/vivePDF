import html
import io
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from vivepdf.ops._studio_models import StudioTextItem
from vivepdf.ops._studio_text import (
    LIST_INDENT,
    MIN_SHRINK_SIZE,
    REGULAR_WEIGHT,
    SHRINK_STEP,
    Band,
    Paragraph,
    Style,
    TextFaces,
    case_texts,
    draw_bands,
    item_language,
    run_style,
    text_paragraphs,
)
from vivepdf.ops._studio_vector import mirror
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
MEASURE_FACTOR = 50
FIT_TOLERANCE = 0.01
NO_BREAK_SPACE = " "


def run_texts(item: StudioTextItem, values: dict[str, str], language: str) -> list[str]:
    texts = []
    for run in item.runs:
        text = fill_placeholders(run.text, values) if values else run.text
        texts.append(text.replace("\r\n", "\n").replace("\r", "\n"))
    return case_texts(texts, item.case, item_language(item, language))


def needs_shaping(item: StudioTextItem, faces: TextFaces, texts: list[str]) -> bool:
    for run, text in zip(item.runs, texts, strict=True):
        if COMPLEX_SCRIPT.search(text):
            return True
        wide = set(WIDE_SCRIPT.findall(text))
        if wide:
            font = faces.of(run_style(item, run)).font
            if any(not font.has_glyph(ord(char)) for char in wide):
                return True
    return False


def direction(text: str) -> str:
    for char in text:
        if char.isalpha():
            return "rtl" if RTL_SCRIPT.match(char) else "ltr"
    return "ltr"


def _align(item: StudioTextItem, flow: str) -> str:
    return MIRRORED_ALIGN.get(item.align, item.align) if flow == "rtl" else item.align


@dataclass
class FontTable:
    families: dict[str | None, str] = field(default_factory=dict)
    used: set[tuple[str | None, int, bool]] = field(default_factory=set)

    def family(self, font_id: str | None) -> str:
        return self.families.setdefault(font_id, f"vpface{len(self.families)}")

    def use(self, style: Style) -> str:
        self.used.add((style.font_id, style.weight, False))
        if style.italic:
            self.used.add((style.font_id, style.weight, True))
        return self.family(style.font_id)

    def archive(self) -> tuple[pymupdf.Archive, str]:
        archive = pymupdf.Archive()
        rules = []
        names: dict[Path, str] = {}
        for font_id, weight, italic in sorted(self.used, key=repr):
            explicit = None if weight in (REGULAR_WEIGHT, 700) else weight
            path, real_italic = resolve_face(font_id, weight >= 600, italic, explicit)
            if italic and not real_italic:
                continue
            name = names.get(path)
            if name is None:
                name = f"face{len(names)}{path.suffix.lower()}"
                names[path] = name
                archive.add(path.read_bytes(), name)
            rules.append(
                f"@font-face {{font-family: {self.family(font_id)}; src: url({name}); "
                f"font-weight: {weight}; font-style: {'italic' if italic else 'normal'};}}"
            )
        return archive, "\n".join(rules)


def _span_css(
    item: StudioTextItem, style: Style, fonts: FontTable, colour: str | None, decorate: bool
) -> str:
    lines = [
        kind for kind, on in (("underline", style.underline), ("line-through", style.strike)) if on
    ]
    decoration = " ".join(lines) if decorate and lines else "none"
    return (
        f"font-family: {fonts.use(style)}; font-weight: {style.weight}; "
        f"font-style: {'italic' if style.italic else 'normal'}; "
        f"font-size: {style.size / item.font_size:.4f}em; "
        f"text-decoration: {decoration}; color: {colour or style.color};"
    )


def _marker(
    item: StudioTextItem,
    paragraph: Paragraph,
    faces: TextFaces,
    fonts: FontTable,
    colour: str | None,
) -> str:
    marker = paragraph.marker or ""
    style = paragraph.marker_style
    width = faces.of(style).font.text_length(marker, fontsize=1)
    gap_width = faces.face(item.font_id, REGULAR_WEIGHT, False).font.text_length(
        NO_BREAK_SPACE, fontsize=1
    )
    gap = max(0.0, LIST_INDENT - width - gap_width)
    return (
        f'<span style="{_span_css(item, style, fonts, colour, False)}">{html.escape(marker)}</span>'
        f'<span style="letter-spacing: {gap:.4f}em;">&#160;</span>'
    )


def _markup(
    item: StudioTextItem,
    paragraphs: list[Paragraph],
    flow: str,
    faces: TextFaces,
    fonts: FontTable,
    colour: str | None = None,
    decorate: bool = True,
) -> str:
    start = "right" if flow == "rtl" else "left"
    blocks = []
    for paragraph in paragraphs:
        attributes = ""
        if paragraph.kind != "none":
            attributes = (
                f' style="padding-{start}: {(paragraph.level + 1) * LIST_INDENT:.4f}em; '
                f'text-indent: -{LIST_INDENT:.4f}em;"'
            )
        spans = [_marker(item, paragraph, faces, fonts, colour)] if paragraph.marker else []
        for text, style in paragraph.pieces:
            css = _span_css(item, style, fonts, colour, decorate)
            spans.append(f'<span style="{css}">{html.escape(text)}</span>')
        blocks.append(f'<p dir="{flow}"{attributes}>{"".join(spans) if spans else "&#160;"}</p>')
    return "".join(blocks)


@dataclass
class Prepared:
    item: StudioTextItem
    body: str
    faces_css: str
    archive: pymupdf.Archive
    flow: str
    family: str

    def css(self, size: float) -> str:
        item = self.item
        spacing = item.letter_spacing * size / item.font_size
        letter = f" letter-spacing: {spacing:.3f}px;" if spacing else ""
        return (
            f"{self.faces_css} "
            f"body {{margin: 0; padding: 0; font-family: {self.family}; font-size: {size:.3f}px; "
            f"line-height: {item.line_height:.4f}; "
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


def _stroked(page: pymupdf.Page, colour: str, width: float) -> None:
    document = page.parent
    for xref in page.get_contents():
        stream = document.xref_stream(xref)
        document.update_stream(xref, stream.replace(b"BT\n", b"BT\n1 Tr\n"))
    red, green, blue = (int(colour[index : index + 2], 16) / 255 for index in (1, 3, 5))
    prefix = f"{red:.4f} {green:.4f} {blue:.4f} RG {width:.4f} w "
    pymupdf.TOOLS._insert_contents(page, prefix.encode(), 0)  # noqa: SLF001


def _rendered(
    prepared: Prepared, size: float, height: float, opacity: float
) -> tuple[pymupdf.Document, float]:
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
    if opacity < 1:
        page = source[0]
        state = page._set_opacity(CA=opacity, ca=opacity)  # noqa: SLF001
        pymupdf.TOOLS._insert_contents(page, f"/{state} gs ".encode(), 0)  # noqa: SLF001
    return source, page_height


def _target(item: StudioTextItem, page_height: float, dx: float, dy: float) -> pymupdf.Rect:
    angle = math.radians(item.rotation % 360)
    cos, sin = abs(math.cos(angle)), abs(math.sin(angle))
    width = item.width * cos + page_height * sin
    height = item.width * sin + page_height * cos
    sign_x = -1 if item.flip_x else 1
    sign_y = -1 if item.flip_y else 1
    dx, dy = dx * sign_x, dy * sign_y
    shift_x = dx * math.cos(angle) - dy * math.sin(angle)
    shift_y = dx * math.sin(angle) + dy * math.cos(angle)
    cx = item.x + item.width / 2 + shift_x
    cy = item.y + item.height / 2 + sign_y * (page_height - item.height) / 2 + shift_y
    return pymupdf.Rect(cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2)


def _place(
    page: pymupdf.Page,
    prepared: Prepared,
    size: float,
    height: float,
    opacity: float,
    offset: tuple[float, float] = (0.0, 0.0),
    stroke: tuple[str, float] | None = None,
) -> None:
    item = prepared.item
    source, page_height = _rendered(prepared, size, height, opacity)
    try:
        if stroke is not None:
            _stroked(source[0], *stroke)
        mirror(source, item.flip_x, item.flip_y)
        page.show_pdf_page(_target(item, page_height, *offset), source, 0, rotate=-item.rotation)
    finally:
        source.close()


def draw_shaped(
    page: pymupdf.Page,
    item: StudioTextItem,
    faces: TextFaces,
    values: dict[str, str],
    language: str,
) -> None:
    paragraphs = text_paragraphs(item, values, language)
    if not any(text.strip() for paragraph in paragraphs for text, _ in paragraph.pieces):
        return
    flow = direction("".join(text for paragraph in paragraphs for text, _ in paragraph.pieces))
    fonts = FontTable()
    family = fonts.use(Style(item.font_id, REGULAR_WEIGHT, False, False, False, item.color, 1))

    def prepared(colour: str | None = None, decorate: bool = True) -> Prepared:
        body = _markup(item, paragraphs, flow, faces, fonts, colour, decorate)
        archive, faces_css = fonts.archive()
        return Prepared(item, body, faces_css, archive, flow, family)

    main = prepared()
    size, height = _fitted(main)
    draw_bands(
        page, item, [Band(band.x, band.y, band.width, band.height) for band in item.bands or []]
    )
    shadow = item.shadow
    if shadow is not None and shadow.opacity > 0:
        _place(
            page,
            prepared(shadow.color),
            size,
            height,
            item.opacity * shadow.opacity,
            (shadow.x, shadow.y),
        )
    if item.outline is not None:
        outline = prepared(item.outline.color, False)
        _place(
            page,
            outline,
            size,
            height,
            item.opacity,
            stroke=(item.outline.color, item.outline.width * 2),
        )
    _place(page, main, size, height, item.opacity)
