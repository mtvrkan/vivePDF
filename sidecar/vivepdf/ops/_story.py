import codecs
import contextlib
import html as html_module
import io
import itertools
import locale
import re
from collections.abc import Callable
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pymupdf

from vivepdf.ops._output import save_document
from vivepdf.rpc.errors import ErrorCode, OpError

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
BASE_CSS = (
    "@font-face{font-family:vivepdf;src:url(DejaVuSans.ttf);}"
    "@font-face{font-family:vivepdf;font-weight:bold;src:url(DejaVuSans-Bold.ttf);}"
    "body{font-family:vivepdf,sans-serif;font-size:11pt;line-height:1.4;}"
    "h1{font-size:20pt;}h2{font-size:16pt;}h3{font-size:13pt;}"
    "pre,code{font-family:vivepdf,monospace;font-size:9.5pt;white-space:pre-wrap;}"
    "table{border-collapse:collapse;}td,th{border:0.5pt solid #888;padding:2pt 4pt;}"
)
MARGIN = 42.0
MAX_STORY_PAGES = 5000
BYTE_ORDER_MARKS = (
    (codecs.BOM_UTF32_LE, "utf-32"),
    (codecs.BOM_UTF32_BE, "utf-32"),
    (codecs.BOM_UTF8, "utf-8-sig"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
)
META_CHARSET = re.compile(rb"""charset\s*=\s*["']?([A-Za-z0-9_.:-]+)""", re.IGNORECASE)
LAST_RESORT_ENCODING = "cp1252"
TURKISH_ENCODING = "cp1254"
LINK_SCHEMES = frozenset({"http", "https", "mailto"})
SLUG_DROPPED = re.compile(r"[^\w\- ]")
TURKISH_BYTES = re.compile(rb"[\xd0\xdd\xde\xf0\xfd\xfe]")
WESTERN_CODECS = frozenset(
    {"utf-8", "cp1252", "cp1254", "iso8859-1", "iso8859-9", "iso8859-15", "ascii", "mac-roman"}
)


def known_codec(name: str | None) -> str | None:
    if not name:
        return None
    try:
        return codecs.lookup(name).name
    except LookupError:
        return None


def declared_charset(payload: bytes) -> str | None:
    match = META_CHARSET.search(payload[:4096])
    return known_codec(match.group(1).decode("ascii", "ignore")) if match else None


def decode_text_as(payload: bytes, declared: str | None = None) -> tuple[str, str, bool]:
    for mark, codec in BYTE_ORDER_MARKS:
        if payload.startswith(mark):
            text = payload.decode(codec, errors="replace")
            return text, codec, "\ufffd" in text
    preferred = known_codec(locale.getpreferredencoding(False))
    western = preferred is None or preferred in WESTERN_CODECS
    candidates = [known_codec(declared), "utf-8", None if western else preferred]
    for codec in candidates:
        if not codec:
            continue
        try:
            return payload.decode(codec), codec, False
        except UnicodeDecodeError:
            continue
    fallback = TURKISH_ENCODING if TURKISH_BYTES.search(payload) else LAST_RESORT_ENCODING
    text = payload.decode(fallback, errors="replace")
    return text, fallback, "\ufffd" in text


def decode_text(payload: bytes, declared: str | None = None) -> str:
    return decode_text_as(payload, declared)[0]


def text_to_html(text: str) -> str:
    escaped = html_module.escape(text)
    return f"<pre>{escaped}</pre>"


def heading_slug(text: str, taken: set[str]) -> str:
    base = "-".join(SLUG_DROPPED.sub("", text.strip().lower()).split(" "))
    slug, number = base, 0
    while slug in taken:
        number += 1
        slug = f"{base}-{number}"
    taken.add(slug)
    return slug


def markdown_to_html(text: str, strikethrough: bool = False, anchors: bool = False) -> str:
    from markdown_it import MarkdownIt

    rules = ["table", "strikethrough"] if strikethrough else ["table"]
    parser = MarkdownIt("commonmark", {"breaks": False}).enable(rules)
    if not anchors:
        return parser.render(text)
    tokens = parser.parse(text)
    taken: set[str] = set()
    for opening, inline in itertools.pairwise(tokens):
        if opening.type == "heading_open":
            opening.attrSet("id", heading_slug(inline.content, taken))
    return parser.renderer.render(tokens, parser.options, {})


def story_pdf_bytes(
    html: str,
    mediabox: pymupdf.Rect,
    where: pymupdf.Rect,
    css: str = BASE_CSS,
    archive_dirs: tuple[Path, ...] = (),
    check_cancelled: Callable[[], None] | None = None,
    outline: bool = False,
) -> bytes:
    archive = pymupdf.Archive(str(FONT_DIR))
    for directory in archive_dirs:
        if directory.is_dir():
            archive.add(str(directory))
    story = pymupdf.Story(html=html, user_css=css, archive=archive)
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    pages = 0
    more = True
    positions: list = []
    while more:
        if check_cancelled is not None:
            check_cancelled()
        if pages >= MAX_STORY_PAGES:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"the document would have more than {MAX_STORY_PAGES} pages",
                {"reason": "tooManyPages", "limit": MAX_STORY_PAGES},
            )
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.element_positions(lambda position: positions.append(position), {"page": pages})
        story.draw(device)
        writer.end_page()
        pages += 1
    writer.close()
    opened = [position for position in positions if position.open_close & 1]
    if not any(position.href for position in opened) and not (
        outline and any(position.heading for position in opened)
    ):
        return buffer.getvalue()
    with pymupdf.open("pdf", buffer.getvalue()) as document:
        _add_links(document, opened)
        if outline:
            document.set_toc(_outline(opened))
        return document.tobytes()


def _add_links(document: pymupdf.Document, positions: list) -> None:
    targets = {}
    for position in positions:
        if position.id and position.id not in targets:
            targets[position.id] = position
    for position in positions:
        href = (position.href or "").strip()
        if href.startswith("#"):
            target = targets.get(unquote(href[1:]))
            if target is None:
                continue
            link = {
                "kind": pymupdf.LINK_GOTO,
                "page": target.page,
                "to": pymupdf.Point(*target.rect[:2]),
            }
        elif urlsplit(href).scheme.lower() in LINK_SCHEMES:
            link = {"kind": pymupdf.LINK_URI, "uri": href}
        else:
            continue
        document[position.page].insert_link({**link, "from": pymupdf.Rect(position.rect)})


def _outline(positions: list) -> list[list]:
    headings = [
        position for position in positions if position.heading and (position.text or "").strip()
    ]
    entries = []
    level = 0
    for position in headings:
        level = min(position.heading, level + 1)
        entries.append(
            [
                level,
                " ".join(position.text.split()),
                position.page + 1,
                {
                    "kind": pymupdf.LINK_GOTO,
                    "to": pymupdf.Point(position.rect[0], position.rect[1]),
                },
            ]
        )
    return entries


def render_html_to_pdf(
    html: str,
    target: Path,
    paper: str = "a4",
    base_dir: Path | None = None,
    check_cancelled: Callable[[], None] | None = None,
    outline: bool = False,
) -> int:
    mediabox = pymupdf.paper_rect(paper)
    where = mediabox + (MARGIN, MARGIN, -MARGIN, -MARGIN)
    payload = story_pdf_bytes(
        html,
        mediabox,
        where,
        archive_dirs=(base_dir,) if base_dir is not None else (),
        check_cancelled=check_cancelled,
        outline=outline,
    )
    with pymupdf.open("pdf", payload) as document:
        pages = document.page_count
        with contextlib.suppress(Exception):
            document.subset_fonts(fallback=False)
        save_document(document, target)
    return pages
