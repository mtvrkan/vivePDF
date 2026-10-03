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

from vivepdf.ops._html_clean import body_fragment
from vivepdf.ops._image_files import eight_bit, open_picture
from vivepdf.ops._story import FONT_DIR, MAX_STORY_PAGES
from vivepdf.ops._studio_document_models import StudioDocumentContent, StudioDocumentSettings
from vivepdf.ops.cover import CoverParams, draw_cover
from vivepdf.ops.create import POINTS_PER_MM
from vivepdf.ops.font_library_catalog import FAMILIES as LIBRARY_FAMILIES
from vivepdf.ops.fonts import resolve_face
from vivepdf.rpc.errors import ErrorCode, OpError

IMAGE_PREFIX = "vpimg-"
IMAGE_MAX_SIDE = 2400
JPEG_QUALITY = 88
DATA_URL = re.compile(r"^data:image/(?:png|jpe?g|gif|webp|bmp);base64,", re.IGNORECASE)
IMAGE_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
SOURCE = re.compile(r"""\ssrc\s*=\s*(["'])(.*?)\1""", re.IGNORECASE | re.DOTALL)
LINK = re.compile(r"""(<a\b[^>]*?)\shref\s*=\s*(["'])(.*?)\2""", re.IGNORECASE | re.DOTALL)
SAFE_LINK = re.compile(r"^(?:https?:|mailto:|#)", re.IGNORECASE)
HEADING = re.compile(
    r"""<h([1-6])\b[^>]*?\sid\s*=\s*["'](h-\d+)["'][^>]*>(.*?)</h\1\s*>""",
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


def _kept_image(tag: str, count: int) -> str:
    match = SOURCE.search(tag)
    if not match or not match.group(2).startswith(IMAGE_PREFIX):
        return ""
    suffix = match.group(2)[len(IMAGE_PREFIX) :]
    return tag if suffix.isdigit() and int(suffix) < count else ""


def _kept_link(match: re.Match) -> str:
    target = html.unescape(match.group(3)).strip()
    return match.group(0) if SAFE_LINK.match(target) else match.group(1)


def clean_html(source: str, image_count: int) -> str:
    body = body_fragment(source)
    body = IMAGE_TAG.sub(lambda match: _kept_image(match.group(0), image_count), body)
    return LINK.sub(_kept_link, body)


def headings(body: str, depth: int) -> list[Heading]:
    found = []
    for match in HEADING.finditer(body):
        level = int(match.group(1))
        title = SPACES.sub(" ", html.unescape(TAG.sub("", match.group(3)))).strip()
        if level <= depth and title:
            found.append(Heading(level, match.group(2), title))
    return found


def _base_css(settings: StudioDocumentSettings, heading_font: bool) -> str:
    size = settings.font_size
    accent = settings.accent
    heading_family = "font-family:f1;" if heading_font else ""
    return "".join(
        [
            f"body{{font-family:f0;font-size:{size}pt;line-height:{settings.line_height};"
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
            "border-left:2pt solid #d1d5db;padding:2pt 0 2pt 8pt;white-space:pre-wrap;"
            "margin:0 0 8pt 0;}",
            "code{font-family:monospace;}",
            "table{border-collapse:collapse;width:100%;margin:0 0 8pt 0;}",
            "td,th{border:0.5pt solid #999999;padding:3pt 5pt;vertical-align:top;}",
            "th{font-weight:bold;border-bottom:1pt solid #666666;}",
            "hr{border:none;border-top:0.75pt solid #bbbbbb;margin:8pt 0;}",
            "img{max-width:100%;}",
            f"a{{color:{accent};}}",
            ".page-break{page-break-before:always;}",
            f".toc-title{{font-size:{size * 1.7:.1f}pt;margin:0 0 {size:.1f}pt 0;}}",
            ".toc{width:100%;border:none;}",
            ".toc td{border:none;padding:2pt 0;vertical-align:bottom;}",
            ".toc a{color:#1a1a1a;text-decoration:none;}",
            ".toc-page{text-align:right;width:12%;}",
            ".toc-1 td{font-weight:bold;padding-top:4pt;}",
            ".toc-2 .toc-entry{margin-left:12pt;}",
            ".toc-3 .toc-entry{margin-left:24pt;}",
        ]
    )


def _toc_html(
    settings: StudioDocumentSettings, entries: list[Heading], pages: dict[str, int], offset: int
) -> str:
    if not settings.toc or not entries:
        return ""
    rows = "".join(
        f'<tr class="toc-{entry.level}"><td><div class="toc-entry">'
        f'<a href="#{entry.anchor}">{html.escape(entry.title)}</a></div></td>'
        f'<td class="toc-page">{pages.get(entry.anchor, 0) + offset}</td></tr>'
        for entry in entries
    )
    title = html.escape(settings.toc_title.strip())
    heading = f'<p class="toc-title">{title}</p>' if title else ""
    return f'{heading}<table class="toc">{rows}</table><div class="page-break"></div>'


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


def _furniture_html(text: str, align: str) -> str:
    style = f"font-family:f0;font-size:{FURNITURE_PT}pt;color:{FURNITURE_COLOUR};text-align:{align}"
    return f'<div style="{style}">{html.escape(text)}</div>'


def _number_align(settings: StudioDocumentSettings, page_number: int) -> str:
    if settings.page_numbers == "outside":
        return "right" if page_number % 2 else "left"
    return settings.page_numbers


def _bottom_line(
    settings: StudioDocumentSettings, page_number: int, total: int
) -> list[tuple[str, str]]:
    parts: dict[str, list[str]] = {}
    if settings.footer.strip():
        parts.setdefault(settings.footer_align, []).append(settings.footer.strip())
    if settings.page_numbers != "none":
        label = settings.page_number_format.replace("{n}", str(page_number)).replace(
            "{total}", str(total)
        )
        parts.setdefault(_number_align(settings, page_number), []).append(label)
    return [(align, f"  {MIDDLE_DOT}  ".join(texts)) for align, texts in parts.items()]


def _add_furniture(
    document: pymupdf.Document,
    settings: StudioDocumentSettings,
    offset: int,
    css: str,
    archive: pymupdf.Archive,
) -> None:
    margin = settings.margin_mm * POINTS_PER_MM
    total = document.page_count
    for index in range(offset, total):
        if index == offset and not settings.furniture_on_first:
            continue
        page = document[index]
        width, height = page.rect.width, page.rect.height
        top = max(4.0, margin / 2 - FURNITURE_HEIGHT / 2)
        bottom = min(height - 4.0, height - margin / 2 + FURNITURE_HEIGHT / 2)
        boxes = []
        if settings.header.strip():
            boxes.append((top, settings.header_align, settings.header.strip()))
        boxes.extend(
            (bottom - FURNITURE_HEIGHT, align, text)
            for align, text in _bottom_line(settings, index + 1, total)
        )
        for y, align, text in boxes:
            page.insert_htmlbox(
                pymupdf.Rect(margin, y, width - margin, y + FURNITURE_HEIGHT),
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
    content: StudioDocumentContent, check_cancelled: Callable[[], None]
) -> pymupdf.Document:
    settings = content.settings
    archive = pymupdf.Archive(str(FONT_DIR))
    fonts = content.fonts or [DEFAULT_FONT]
    font_css = _font_rules(fonts, archive)
    for index, source in enumerate(content.images):
        check_cancelled()
        archive.add(_decoded(source, index), f"{IMAGE_PREFIX}{index}")
    body = clean_html(content.html, len(content.images))
    if not body.strip():
        body = "<p></p>"
    entries = headings(body, settings.toc_depth)
    outline = headings(body, 3)
    title = content.title.strip() or (outline[0].title if outline else "")
    cover = settings.cover
    offset = 1 if cover else 0
    css = font_css + _base_css(settings, len(fonts) > 1)
    mediabox = _paper(settings)
    margin = settings.margin_mm * POINTS_PER_MM
    where = mediabox + (margin, margin, -margin, -margin)
    anchors: dict[str, int] = {}

    def story(positions: list) -> str:
        pages = {
            position.id: position.page_num
            for position in positions
            if position.id and position.open_close & 1
        }
        return _toc_html(settings, entries, pages, offset) + body

    def rectangle(number: int, _filled: pymupdf.Rect):
        check_cancelled()
        if number >= MAX_STORY_PAGES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"the document would have more than {MAX_STORY_PAGES} pages",
                {"reason": "tooManyPages", "limit": MAX_STORY_PAGES},
            )
        return mediabox, where, None

    def remember(position) -> None:
        if position.id and position.open_close & 1 and position.id not in anchors:
            anchors[position.id] = position.page_num

    document = pymupdf.Story.write_stabilized_with_links(
        story,
        rectangle,
        user_css=css,
        positionfn=remember,
        archive=archive,
        add_header_ids=False,
    )
    try:
        if cover:
            _add_cover(document, settings, title)
        furniture_archive = pymupdf.Archive()
        furniture_css = _font_rules(fonts[:1], furniture_archive)
        _add_furniture(document, settings, offset, furniture_css, furniture_archive)
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
