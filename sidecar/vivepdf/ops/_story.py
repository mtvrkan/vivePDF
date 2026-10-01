import codecs
import contextlib
import html as html_module
import io
import locale
import re
from collections.abc import Callable
from pathlib import Path

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


def decode_text(payload: bytes, declared: str | None = None) -> str:
    for mark, codec in BYTE_ORDER_MARKS:
        if payload.startswith(mark):
            return payload.decode(codec, errors="replace")
    candidates = [known_codec(declared), "utf-8", known_codec(locale.getpreferredencoding(False))]
    for codec in candidates:
        if not codec:
            continue
        try:
            return payload.decode(codec)
        except UnicodeDecodeError:
            continue
    return payload.decode(LAST_RESORT_ENCODING, errors="replace")


def text_to_html(text: str) -> str:
    escaped = html_module.escape(text)
    return f"<pre>{escaped}</pre>"


def markdown_to_html(text: str) -> str:
    from markdown_it import MarkdownIt

    return MarkdownIt("commonmark", {"breaks": False}).enable("table").render(text)


def render_html_to_pdf(
    html: str,
    target: Path,
    paper: str = "a4",
    base_dir: Path | None = None,
    check_cancelled: Callable[[], None] | None = None,
) -> int:
    archive = pymupdf.Archive(str(FONT_DIR))
    if base_dir is not None and base_dir.is_dir():
        archive.add(str(base_dir))
    story = pymupdf.Story(html=html, user_css=BASE_CSS, archive=archive)
    mediabox = pymupdf.paper_rect(paper)
    where = mediabox + (MARGIN, MARGIN, -MARGIN, -MARGIN)
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    pages = 0
    more = True
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
        story.draw(device)
        writer.end_page()
        pages += 1
    writer.close()
    with pymupdf.open("pdf", buffer.getvalue()) as document:
        with contextlib.suppress(Exception):
            document.subset_fonts(fallback=False)
        save_document(document, target)
    return pages
