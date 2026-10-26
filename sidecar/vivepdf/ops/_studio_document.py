import base64
import binascii
import contextlib
import html
import io
import re
import tempfile
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from PIL import Image, ImageOps

from vivepdf.ops._document_equations import (
    EQUATION_PREFIX,
    add_placeholders,
    draw_equations,
)
from vivepdf.ops._document_flow import (
    TOC_END,
    Flowed,
    Frame,
    Plan,
    flow,
    numbered_breaks,
    sectioned,
)
from vivepdf.ops._document_notes import (
    MARKER,
    Footnotes,
    marked_numbers,
    note_bodies,
    note_css,
    with_endnotes,
)
from vivepdf.ops._document_numbers import PageNumbering, numbering
from vivepdf.ops._document_places import Places, places_of
from vivepdf.ops._html_clean import body_fragment
from vivepdf.ops._image_files import eight_bit, open_picture
from vivepdf.ops._story import FONT_DIR
from vivepdf.ops._studio_document_models import StudioDocumentContent, StudioDocumentSettings
from vivepdf.ops.cover import CoverParams, draw_cover
from vivepdf.ops.create import POINTS_PER_MM
from vivepdf.ops.font_library_catalog import FAMILIES as LIBRARY_FAMILIES
from vivepdf.ops.fonts import resolve_face
from vivepdf.rpc.errors import ErrorCode, OpError

IMAGE_PREFIX = "vpimg-"
IMAGE_MAX_SIDE = 2400
JPEG_QUALITY = 88
MIN_TEXT_MM = 20
SHADE = "#f3f4f6"
DATA_URL = re.compile(r"^data:image/(?:png|jpe?g|gif|webp|bmp);base64,", re.IGNORECASE)
IMAGE_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
SOURCE = re.compile(r"""\ssrc\s*=\s*(["'])(.*?)\1""", re.IGNORECASE | re.DOTALL)
LINK = re.compile(r"""(<a\b[^>]*?)\shref\s*=\s*(["'])(.*?)\2""", re.IGNORECASE | re.DOTALL)
SAFE_LINK = re.compile(r"^(?:https?:|mailto:|#)", re.IGNORECASE)
HEADING = re.compile(
    r"""<h([1-6])\b[^>]*?\sid\s*=\s*["'](h-\d+)["'][^>]*>(.*?)</h\1\s*>""",
    re.IGNORECASE | re.DOTALL,
)
CAPTION = re.compile(
    r"""<p\b(?=[^>]*\sdata-caption\s*=\s*["'](figure|table)["'])"""
    r"""(?=[^>]*\sid\s*=\s*["'](c-\d+)["'])[^>]*>(.*?)</p\s*>""",
    re.IGNORECASE | re.DOTALL,
)
TAG = re.compile(r"<[^>]*>")
SPACES = re.compile(r"\s+")
VARIANTS = ((False, False), (True, False), (False, True), (True, True))
DEFAULT_FONT = "bundled:dejavu-sans"
FURNITURE_PT = 8.5
FURNITURE_HEIGHT = 16.0
FURNITURE_COLOUR = "#666666"
SERIF_COVERS = {"classic", "frame"}
MIDDLE_DOT = chr(0x00B7)


@dataclass
class Heading:
    level: int
    anchor: str
    title: str


@dataclass
class Caption:
    kind: str
    anchor: str
    title: str


def picture_bytes(payload: bytes, label: str) -> tuple[bytes, int, int, bool]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as opened:
                image = eight_bit(ImageOps.exif_transpose(opened))
                image.load()
    except Image.DecompressionBombError as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"{label} is too large", {"reason": "pictureTooLarge"}
        ) from error
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"cannot read image: {label}", {"reason": "imageUnreadable"}
        ) from error
    return encoded_picture(image)


def encoded_picture(image: Image.Image) -> tuple[bytes, int, int, bool]:
    scale = min(1.0, IMAGE_MAX_SIDE / max(image.size))
    if scale < 1:
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
    transparent = image.mode in ("RGBA", "LA", "PA") or (
        image.mode == "P" and "transparency" in image.info
    )
    buffer = io.BytesIO()
    if transparent:
        image.convert("RGBA").save(buffer, format="PNG", optimize=True)
    else:
        image.convert("RGB").save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue(), image.width, image.height, transparent


def picture_file(path: Path) -> tuple[bytes, int, int, bool]:
    try:
        with open_picture(path) as opened:
            image = eight_bit(ImageOps.exif_transpose(opened))
            image.load()
    except OpError:
        raise
    except Exception as error:  # noqa: BLE001
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot read image: {path.name}",
            {"reason": "imageUnreadable", "path": str(path)},
        ) from error
    return encoded_picture(image)


def data_url(payload: bytes, transparent: bool) -> str:
    kind = "png" if transparent else "jpeg"
    return f"data:image/{kind};base64,{base64.b64encode(payload).decode('ascii')}"


def _decoded(source: str, index: int) -> bytes:
    if not DATA_URL.match(source):
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"image {index + 1} is not embedded", {"reason": "badImage"}
        )
    try:
        payload = base64.b64decode(source.split(",", 1)[1], validate=False)
    except (binascii.Error, ValueError) as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"image {index + 1} is damaged", {"reason": "badImage"}
        ) from error
    return picture_bytes(payload, f"image {index + 1}")[0]


def _serif(font_id: str) -> bool:
    kind, _, value = font_id.partition(":")
    if kind == "library":
        family = next((item for item in LIBRARY_FAMILIES if item.id == value), None)
        return family is not None and family.category == "serif"
    return "serif" in value and "sans" not in value


def _stand_in(font_id: str, bold: bool) -> tuple[str, bytes]:
    base = "Times" if _serif(font_id) else "Helvetica"
    name = f"{base}-{'Bold' if bold else ''}{'Italic' if base == 'Times' else 'Oblique'}"
    return name, pymupdf.Font(name).buffer


def _font_rules(fonts: list[str], archive: pymupdf.Archive) -> str:
    rules = []
    seen: dict[object, str] = {}
    for index, font_id in enumerate(fonts or [DEFAULT_FONT]):
        for bold, italic in VARIANTS:
            path, real_italic = resolve_face(font_id, bold, italic)
            if italic and not real_italic:
                key, payload = _stand_in(font_id, bold)
                name = seen.get(key)
                if name is None:
                    name = f"font{len(seen)}.cff"
                    seen[key] = name
                    archive.add(payload, name)
            else:
                name = seen.get(path)
                if name is None:
                    name = f"font{len(seen)}{path.suffix.lower()}"
                    seen[path] = name
                    archive.add(path.read_bytes(), name)
            rules.append(
                f"@font-face{{font-family:f{index};src:url({name});"
                f"font-weight:{'bold' if bold else 'normal'};"
                f"font-style:{'italic' if italic else 'normal'};}}"
            )
    return "".join(rules)


def _kept_image(tag: str, count: int, equation_count: int) -> str:
    match = SOURCE.search(tag)
    if not match:
        return ""
    for prefix, limit in ((IMAGE_PREFIX, count), (EQUATION_PREFIX, equation_count)):
        if match.group(2).startswith(prefix):
            suffix = match.group(2)[len(prefix) :]
            return tag if suffix.isdigit() and int(suffix) < limit else ""
    return ""


def _kept_link(match: re.Match) -> str:
    target = html.unescape(match.group(3)).strip()
    return match.group(0) if SAFE_LINK.match(target) else match.group(1)


def clean_html(source: str, image_count: int, equation_count: int = 0) -> str:
    body = body_fragment(source)
    body = IMAGE_TAG.sub(
        lambda match: _kept_image(match.group(0), image_count, equation_count), body
    )
    return LINK.sub(_kept_link, body)


def _plain(markup: str) -> str:
    return SPACES.sub(" ", html.unescape(TAG.sub("", MARKER.sub("", markup)))).strip()


def headings(body: str, depth: int) -> list[Heading]:
    found = []
    for match in HEADING.finditer(body):
        level = int(match.group(1))
        title = _plain(match.group(3))
        if level <= depth and title:
            found.append(Heading(level, match.group(2), title))
    return found


def captions(body: str) -> list[Caption]:
    return [
        Caption(match.group(1).lower(), match.group(2), _plain(match.group(3)))
        for match in CAPTION.finditer(body)
    ]


def _base_css(settings: StudioDocumentSettings, heading_font: bool) -> str:
    size = settings.font_size
    accent = settings.accent
    heading_family = "font-family:f1;" if heading_font else ""
    return "".join(
        [
            f"body{{font-family:f0;font-size:{size}pt;line-height:{settings.line_height};"
            "margin:0;"
            "color:#1a1a1a;}",
            f"p{{margin:0 0 {size * 0.6:.1f}pt 0;}}",
            f"h1,h2,h3,h4,h5,h6{{{heading_family}color:{accent};line-height:1.2;}}",
            f"h1{{font-size:{size * 2:.1f}pt;margin:{size:.1f}pt 0 {size * 0.6:.1f}pt 0;}}",
            f"h2{{font-size:{size * 1.55:.1f}pt;margin:{size:.1f}pt 0 {size * 0.5:.1f}pt 0;}}",
            f"h3{{font-size:{size * 1.25:.1f}pt;"
            f"margin:{size * 0.8:.1f}pt 0 {size * 0.4:.1f}pt 0;}}",
            f"h4,h5,h6{{font-size:{size * 1.08:.1f}pt;margin:{size * 0.7:.1f}pt 0 3pt 0;}}",
            "ul,ol{margin:0 0 6pt 0;padding-left:18pt;}",
            "li{margin:0 0 2pt 0;}",
            "li p{margin:0;}",
            "ul.tasks{list-style-type:none;padding-left:2pt;}",
            "blockquote{margin:0 0 8pt 0;padding-left:10pt;border-left:2pt solid #cccccc;"
            "color:#444444;}",
            f"pre{{font-family:monospace;font-size:{size * 0.88:.1f}pt;"
            f"background-color:{SHADE};border-left:2pt solid #d1d5db;"
            f"border-top:3pt solid {SHADE};border-bottom:3pt solid {SHADE};"
            "padding:0 8pt;white-space:pre-wrap;margin:0 0 8pt 0;}",
            "code{font-family:monospace;}",
            "table{border-collapse:collapse;width:100%;margin:0 0 8pt 0;}",
            "td,th{border:0.5pt solid #999999;padding:3pt 5pt;vertical-align:top;}",
            f"th{{font-weight:bold;text-align:left;border-bottom:1pt solid #666666;"
            f"background-color:{SHADE};"
            "padding:0 5pt;}",
            "th p{margin:3pt 0;}",
            "hr{border:none;border-top:0.75pt solid #bbbbbb;margin:8pt 0;}",
            "img{max-width:100%;}",
            f"a{{color:{accent};}}",
            ".page-break{page-break-before:always;}",
            ".references .ref{padding-left:36pt;text-indent:-36pt;}",
            f".toc-title{{font-size:{size * 1.7:.1f}pt;margin:0 0 {size:.1f}pt 0;}}",
            ".toc{width:100%;border:none;}",
            ".toc td{border:none;padding:2pt 0;vertical-align:bottom;}",
            ".toc a{color:#1a1a1a;text-decoration:none;}",
            ".toc-page{text-align:right;width:12%;}",
            ".toc-1 td{font-weight:bold;padding-top:4pt;}",
            ".toc-2 .toc-entry{margin-left:12pt;}",
            ".toc-3 .toc-entry{margin-left:24pt;}",
            f".caption{{text-align:center;font-size:{size * 0.9:.1f}pt;"
            f"margin:{size * 0.3:.1f}pt 0 {size * 0.8:.1f}pt 0;}}",
        ]
    )


def _listing(title: str, rows: str) -> str:
    shown = html.escape(title.strip())
    heading = f'<p class="toc-title">{shown}</p>' if shown else ""
    return f'{heading}<table class="toc">{rows}</table>'


def _row(level: str, anchor: str, title: str, page: str) -> str:
    return (
        f'<tr class="toc-{level}"><td><div class="toc-entry">'
        f'<a href="#{anchor}">{html.escape(title)}</a></div></td>'
        f'<td class="toc-page">{page}</td></tr>'
    )


def _wants_front(
    settings: StudioDocumentSettings, entries: list[Heading], found: list[Caption]
) -> bool:
    kinds = {caption.kind for caption in found}
    return bool(
        (settings.toc and entries)
        or (settings.figure_list and "figure" in kinds)
        or (settings.table_list and "table" in kinds)
    )


def _front_html(
    settings: StudioDocumentSettings,
    entries: list[Heading],
    found: list[Caption],
    pages: dict[str, int],
    offset: int,
    numbers: PageNumbering,
) -> str:
    parts = []
    if settings.toc and entries:
        rows = "".join(
            _row(
                str(entry.level),
                entry.anchor,
                entry.title,
                _toc_page(entry.anchor, pages, offset, numbers),
            )
            for entry in entries
        )
        parts.append(_listing(settings.toc_title, rows))
    lists = (
        ("figure", settings.figure_list, settings.figure_list_title),
        ("table", settings.table_list, settings.table_list_title),
    )
    for kind, wanted, title in lists:
        listed = [caption for caption in found if caption.kind == kind]
        if wanted and listed:
            rows = "".join(
                _row(
                    "caption",
                    caption.anchor,
                    caption.title,
                    _toc_page(caption.anchor, pages, offset, numbers),
                )
                for caption in listed
            )
            parts.append(_listing(title, rows))
    if not parts:
        return ""
    return (
        '<div class="page-break"></div>'.join(parts)
        + f'<div class="page-break" id="{TOC_END}"></div>'
    )


def _toc_page(anchor: str, pages: dict[str, int], offset: int, numbers: PageNumbering) -> str:
    return numbers.label(pages[anchor] - 1 + offset) if anchor in pages else ""


def _bookmarks(entries: list[Heading], anchors: dict[str, int], offset: int) -> list[list]:
    toc: list[list] = []
    previous = 0
    for entry in entries:
        if entry.anchor not in anchors:
            continue
        level = min(entry.level, previous + 1)
        toc.append([level, entry.title, anchors[entry.anchor] + offset])
        previous = level
    return toc


def _paper(settings: StudioDocumentSettings) -> pymupdf.Rect:
    rect = pymupdf.paper_rect(settings.paper)
    return pymupdf.Rect(0, 0, rect.height, rect.width) if settings.landscape else rect


def content_box(settings: StudioDocumentSettings, mediabox: pymupdf.Rect) -> pymupdf.Rect:
    gutter = settings.gutter_mm
    left = settings.margin_left_mm + (gutter if settings.gutter_side == "left" else 0)
    top = settings.margin_top_mm + (gutter if settings.gutter_side == "top" else 0)
    box = pymupdf.Rect(
        mediabox.x0 + left * POINTS_PER_MM,
        mediabox.y0 + top * POINTS_PER_MM,
        mediabox.x1 - settings.margin_right_mm * POINTS_PER_MM,
        mediabox.y1 - settings.margin_bottom_mm * POINTS_PER_MM,
    )
    smallest = MIN_TEXT_MM * POINTS_PER_MM
    if box.width < smallest or box.height < smallest:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the margins leave no room for the text",
            {"reason": "marginTooLarge"},
        )
    return box


def _furniture_html(text: str, align: str) -> str:
    style = f"font-family:f0;font-size:{FURNITURE_PT}pt;color:{FURNITURE_COLOUR};text-align:{align}"
    return f'<div style="{style}">{html.escape(text)}</div>'


def _number_align(settings: StudioDocumentSettings, page_number: int) -> str:
    if settings.page_numbers == "outside":
        return "right" if page_number % 2 else "left"
    return settings.page_numbers


def _bottom_line(
    settings: StudioDocumentSettings, index: int, numbers: PageNumbering, total: int
) -> list[tuple[str, str]]:
    parts: dict[str, list[str]] = {}
    if settings.footer.strip():
        parts.setdefault(settings.footer_align, []).append(settings.footer.strip())
    if settings.page_numbers != "none":
        label = settings.page_number_format.replace("{n}", numbers.label(index)).replace(
            "{total}", numbers.last(total)
        )
        parts.setdefault(_number_align(settings, index + 1), []).append(label)
    return [(align, f"  {MIDDLE_DOT}  ".join(texts)) for align, texts in parts.items()]


def _add_furniture(
    document: pymupdf.Document,
    settings: StudioDocumentSettings,
    offset: int,
    numbers: PageNumbering,
    css: str,
    archive: pymupdf.Archive,
) -> None:
    total = document.page_count
    for index in range(offset, total):
        if index == offset and not settings.furniture_on_first:
            continue
        page = document[index]
        height = page.rect.height
        box = content_box(settings, page.rect)
        top = max(4.0, box.y0 / 2 - FURNITURE_HEIGHT / 2)
        bottom = min(height - 4.0, (height + box.y1) / 2 + FURNITURE_HEIGHT / 2)
        boxes = []
        if settings.header.strip():
            boxes.append((top, settings.header_align, settings.header.strip()))
        boxes.extend(
            (bottom - FURNITURE_HEIGHT, align, text)
            for align, text in _bottom_line(settings, index, numbers, total)
        )
        for y, align, text in boxes:
            page.insert_htmlbox(
                pymupdf.Rect(box.x0, y, box.x1, y + FURNITURE_HEIGHT),
                _furniture_html(text, align),
                css=css,
                archive=archive,
            )


def _add_cover(document: pymupdf.Document, settings: StudioDocumentSettings, title: str) -> None:
    first = document[0].rect
    cover = CoverParams(
        path="",
        output="",
        style=settings.cover_style,
        title=settings.title.strip() or title,
        subtitle=settings.subtitle,
        author=settings.author,
        date=settings.date,
        accent=settings.accent,
        font="serif" if settings.cover_style in SERIF_COVERS else "sans",
    )
    with (
        tempfile.TemporaryDirectory(prefix="vivepdf-doc-", ignore_cleanup_errors=True) as temp,
        pymupdf.open() as cover_document,
    ):
        page = cover_document.new_page(width=first.width, height=first.height)
        draw_cover(page, cover, Path(temp))
        document.insert_pdf(cover_document, start_at=0)


def layout_document(
    content: StudioDocumentContent,
    check_cancelled: Callable[[], None],
    places: list[Places] | None = None,
) -> pymupdf.Document:
    settings = content.settings
    archive = pymupdf.Archive(str(FONT_DIR))
    fonts = content.fonts or [DEFAULT_FONT]
    font_css = _font_rules(fonts, archive)
    for index, source in enumerate(content.images):
        check_cancelled()
        archive.add(_decoded(source, index), f"{IMAGE_PREFIX}{index}")
    add_placeholders(archive, len(content.equations))
    body, first_columns, sections, flowing = sectioned(
        clean_html(content.html, len(content.images), len(content.equations)), settings.columns
    )
    body, main_anchor = numbered_breaks(body)
    if not body.strip():
        body = "<p></p>"
    entries = headings(body, settings.toc_depth)
    found = captions(body)
    outline = headings(body, 3)
    title = content.title.strip() or (outline[0].title if outline else "")
    cover = settings.cover
    offset = 1 if cover else 0
    css = font_css + _base_css(settings, len(fonts) > 1) + note_css(settings.font_size)
    mediabox = _paper(settings)
    frame = Frame(
        mediabox,
        content_box(settings, mediabox),
        first_columns,
        settings.column_gap_mm * POINTS_PER_MM,
        sections,
        flowing,
    )

    initial = Plan(1 if _wants_front(settings, entries, found) else 0)

    def story(text: str) -> pymupdf.Story:
        return pymupdf.Story(text, user_css=css, archive=archive)

    def story_html(main: str) -> Callable[[list], str]:
        def written(positions: list) -> str:
            pages = {
                position.id: position.page_num
                for position in positions
                if position.id and position.open_close & 1
            }
            main_page = pages.get(main_anchor) if main_anchor else None
            numbers = numbering(settings.page_number_start, main_page, offset)
            return _front_html(settings, entries, found, pages, offset, numbers) + main

        return written

    flowed: Flowed | None = None
    footnotes: Footnotes | None = None
    numbers = marked_numbers(body, len(content.footnotes))
    if numbers:
        bodies = note_bodies(content.footnotes, content.footnote_html, content.images)
        notes = Footnotes(bodies, css, archive, frame, settings.font_size)
        if notes.fit(numbers):
            flowed = flow(story_html(body), frame, initial, story, check_cancelled, notes.reserve)
            if flowed.settled and not notes.overflow:
                footnotes = notes
            else:
                flowed.document.close()
                flowed = None
        if flowed is None:
            body = with_endnotes(body, bodies, content.notes_title)
    if flowed is None:
        flowed = flow(story_html(body), frame, initial, story, check_cancelled)
    document, positions = flowed.document, flowed.positions
    if places is not None:
        places.append(places_of(document, positions, offset))
    anchors: dict[str, int] = {}
    for position in positions:
        if position.id and position.open_close & 1 and position.id not in anchors:
            anchors[position.id] = position.page_num
    try:
        if footnotes:
            footnotes.draw(flowed)
        draw_equations(document, positions, body, content.equations, check_cancelled)
        if cover:
            _add_cover(document, settings, title)
        furniture_archive = pymupdf.Archive()
        furniture_css = _font_rules(fonts[:1], furniture_archive)
        numbers = numbering(
            settings.page_number_start, anchors.get(main_anchor) if main_anchor else None, offset
        )
        _add_furniture(document, settings, offset, numbers, furniture_css, furniture_archive)
        labels = numbers.pdf_labels()
        if labels:
            document.set_page_labels(labels)
        document.set_toc(_bookmarks(outline, anchors, offset))
        metadata = dict(document.metadata or {})
        metadata.update(
            {
                "title": settings.title.strip() or title,
                "subject": settings.subtitle.strip(),
                "author": settings.author.strip(),
                "creator": "vivePDF",
            }
        )
        document.set_metadata(metadata)
    except Exception:
        document.close()
        raise
    return document


def subset(document: pymupdf.Document) -> None:
    with contextlib.suppress(Exception):
        document.subset_fonts(fallback=False)
