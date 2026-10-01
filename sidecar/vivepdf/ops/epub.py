import base64
import binascii
import hashlib
import math
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._markup import (
    PageMarkup,
    body_size,
    document_language,
    page_markup,
    retag_headings,
)
from vivepdf.ops._ocr_layer import recognise_textless_pages
from vivepdf.ops._output import write_atomically
from vivepdf.ops._pixmaps import png_ready
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._spreadsheet import clean_text
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

DEFAULT_CHUNK = 20
MAX_CHAPTERS = 2000
DATA_IMAGE = re.compile(r'src="data:(image/[a-z+]+);base64,\s*([A-Za-z0-9+/=\s]+?)"', re.IGNORECASE)
PAGE_DIV = re.compile(r'<div id="page\d+">|</div>\s*$')
HEADING = re.compile(r"<h[12][^>]*>(.*?)</h[12]>", re.IGNORECASE | re.DOTALL)
TAGS = re.compile(r"<[^>]+>")
LANGUAGE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}

STYLE = """html { font-size: 100%; }
body { margin: 0 5%; line-height: 1.5; text-align: left; }
h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.5em; }
h1 { font-size: 1.5em; }
h2 { font-size: 1.25em; }
p { margin: 0 0 0.8em; text-indent: 0; }
img { max-width: 100%; height: auto; }
.page-break { page-break-before: always; break-before: page; }
"""
COVER_NAME = "cover.jpg"
COVER_SIDE = 1600
COVER_QUALITY = 85


class EpubParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    split: Literal["auto", "chapter", "page"] = "auto"
    include_images: bool = True
    language: str = "en"
    title: str | None = Field(default=None, max_length=300)
    author: str | None = Field(default=None, max_length=300)
    cover: bool = True
    ocr: bool = False
    ocr_languages: list[str] = Field(default_factory=lambda: ["tur", "eng"])


class EpubResult(RpcModel):
    output: str
    bytes: int
    chapters: int
    images: int
    page_count: int
    cover: bool = False
    textless_pages: list[int] = Field(default_factory=list)
    ocr_pages: list[int] = Field(default_factory=list)


@dataclass(slots=True)
class _Chapter:
    title: str
    indices: list[int]
    documents: list[str] = field(default_factory=list)


@dataclass(slots=True)
class _Image:
    name: str
    media_type: str
    payload: bytes


def _prepare_epub(output: str, source: str, overwrite: bool) -> Path:
    target = Path(output)
    if target.suffix.lower() != ".epub":
        target = target.with_suffix(".epub")
    resolved = target.resolve()
    if Path(source).resolve() == resolved:
        raise OpError(ErrorCode.INVALID_PARAMS, "output must differ from the input file")
    if resolved.exists() and not overwrite:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"output already exists: {resolved.name}",
            {"exists": True, "path": str(resolved)},
        )
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def escape(text: str) -> str:
    return (
        clean_text(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def plain_text(markup: str) -> str:
    return re.sub(r"\s+", " ", TAGS.sub(" ", markup)).strip()


def chapter_title(body: str, first: int, last: int) -> str:
    match = HEADING.search(body)
    if match:
        heading = plain_text(match.group(1))
        if heading:
            return heading[:120]
    return f"{first + 1}" if first == last else f"{first + 1}–{last + 1}"


def _chapter_starts(document: pymupdf.Document) -> list[tuple[int, str]]:
    starts: dict[int, str] = {}
    for level, title, number, *_rest in document.get_toc():
        if level == 1 and 1 <= number <= document.page_count:
            starts.setdefault(number - 1, title)
    return sorted(starts.items())


def limit_chapters(
    planned: list[tuple[str | None, list[int]]],
) -> list[tuple[str | None, list[int]]]:
    if len(planned) <= MAX_CHAPTERS:
        return planned
    group = math.ceil(len(planned) / MAX_CHAPTERS)
    return [
        (
            planned[start][0],
            [index for _title, block in planned[start : start + group] for index in block],
        )
        for start in range(0, len(planned), group)
    ]


def plan_chapters(
    document: pymupdf.Document, indices: list[int], split: str
) -> list[tuple[str | None, list[int]]]:
    if split == "page":
        return [(None, [index]) for index in indices]
    starts = _chapter_starts(document)
    if starts:
        wanted = set(indices)
        planned: list[tuple[str | None, list[int]]] = []
        lead = [index for index in indices if index < starts[0][0]]
        if lead:
            planned.append((None, lead))
        for position, (start, title) in enumerate(starts):
            end = starts[position + 1][0] if position + 1 < len(starts) else document.page_count
            block = [index for index in range(start, end) if index in wanted]
            if block:
                planned.append((title.strip() or None, block))
        if planned:
            return planned
    if split == "chapter":
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "this document has no bookmarks to split by",
            {"reason": "noBookmarks"},
        )
    return [
        (None, indices[start : start + DEFAULT_CHUNK])
        for start in range(0, len(indices), DEFAULT_CHUNK)
    ]


def extract_images(body: str, images: dict[str, _Image], keep: bool) -> str:
    def replace(match: re.Match[str]) -> str:
        if not keep:
            return 'src=""'
        media_type = match.group(1).lower()
        try:
            payload = base64.b64decode(re.sub(r"\s+", "", match.group(2)))
        except (binascii.Error, ValueError):
            return 'src=""'
        if media_type not in EXTENSIONS:
            payload = _as_png(payload)
            media_type = "image/png"
        if not payload:
            return 'src=""'
        digest = hashlib.sha1(payload, usedforsecurity=False).hexdigest()[:16]
        entry = images.get(digest)
        if entry is None:
            extension = EXTENSIONS[media_type]
            entry = _Image(f"img{len(images) + 1:04d}.{extension}", media_type, payload)
            images[digest] = entry
        return f'src="../images/{entry.name}"'

    replaced = DATA_IMAGE.sub(replace, body)
    return re.sub(r'<img\b[^>]*src=""[^>]*/?>', "", replaced)


def _as_png(payload: bytes) -> bytes:
    try:
        pixmap = pymupdf.Pixmap(payload)
        pixmap = png_ready(pixmap)
        return pixmap.tobytes("png")
    except (RuntimeError, ValueError):
        return b""


def page_body(markup: str) -> str:
    return PAGE_DIV.sub("", markup).strip()


def chapter_document(title: str, language: str, bodies: list[str]) -> str:
    parts = []
    for position, body in enumerate(bodies):
        opener = '<div class="page-break">' if position else "<div>"
        parts.append(f"{opener}\n{body}\n</div>")
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!DOCTYPE html>\n"
        f'<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="{escape(language)}" '
        f'lang="{escape(language)}">\n'
        f"<head>\n<title>{escape(title)}</title>\n"
        '<link rel="stylesheet" type="text/css" href="../style.css"/>\n</head>\n'
        "<body>\n" + "\n".join(parts) + "\n</body>\n</html>\n"
    )


def content_opf(
    identifier: str,
    title: str,
    author: str,
    language: str,
    modified: str,
    chapters: list[_Chapter],
    images: list[_Image],
    cover: bool = False,
) -> str:
    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="style" href="style.css" media-type="text/css"/>',
    ]
    spine = []
    for position, _chapter in enumerate(chapters, start=1):
        manifest.append(
            f'<item id="ch{position}" href="text/chapter{position:04d}.xhtml" '
            'media-type="application/xhtml+xml"/>'
        )
        spine.append(f'<itemref idref="ch{position}"/>')
    for position, image in enumerate(images, start=1):
        manifest.append(
            f'<item id="im{position}" href="images/{image.name}" media-type="{image.media_type}"/>'
        )
    cover_meta = ""
    if cover:
        manifest.append(
            f'<item id="cover-image" href="{COVER_NAME}" media-type="image/jpeg" '
            'properties="cover-image"/>'
        )
        cover_meta = '<meta name="cover" content="cover-image"/>\n'
    creator = f"<dc:creator>{escape(author)}</dc:creator>\n" if author else ""
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
        f'<dc:identifier id="bookid">{escape(identifier)}</dc:identifier>\n'
        f"<dc:title>{escape(title)}</dc:title>\n"
        f"{creator}"
        f"<dc:language>{escape(language)}</dc:language>\n"
        f'<meta property="dcterms:modified">{modified}</meta>\n'
        f"{cover_meta}"
        "</metadata>\n<manifest>\n" + "\n".join(manifest) + "\n</manifest>\n"
        '<spine toc="ncx">\n' + "\n".join(spine) + "\n</spine>\n</package>\n"
    )


def nav_xhtml(title: str, language: str, chapters: list[_Chapter]) -> str:
    items = "\n".join(
        f'<li><a href="text/chapter{position:04d}.xhtml">{escape(chapter.title)}</a></li>'
        for position, chapter in enumerate(chapters, start=1)
    )
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" '
        f'xml:lang="{escape(language)}" lang="{escape(language)}">\n'
        f"<head>\n<title>{escape(title)}</title>\n</head>\n<body>\n"
        f'<nav epub:type="toc" id="toc">\n<h1>{escape(title)}</h1>\n<ol>\n{items}\n</ol>\n</nav>\n'
        "</body>\n</html>\n"
    )


def toc_ncx(identifier: str, title: str, chapters: list[_Chapter]) -> str:
    points = "\n".join(
        f'<navPoint id="nav{position}" playOrder="{position}">'
        f"<navLabel><text>{escape(chapter.title)}</text></navLabel>"
        f'<content src="text/chapter{position:04d}.xhtml"/></navPoint>'
        for position, chapter in enumerate(chapters, start=1)
    )
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
        f'<head><meta name="dtb:uid" content="{escape(identifier)}"/></head>\n'
        f"<docTitle><text>{escape(title)}</text></docTitle>\n"
        f"<navMap>\n{points}\n</navMap>\n</ncx>\n"
    )


def cover_image(page: pymupdf.Page) -> bytes:
    zoom = COVER_SIDE / max(1.0, page.rect.width, page.rect.height)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return pixmap.tobytes("jpg", jpg_quality=COVER_QUALITY)


def _metadata_value(document: pymupdf.Document, key: str) -> str:
    value = (document.metadata or {}).get(key) or ""
    return value.strip()


def _collect_pages(
    document: pymupdf.Document,
    planned: list[tuple[str | None, list[int]]],
    images: dict[str, _Image],
    keep_images: bool,
    recognised: list[int],
    progress: Progress,
) -> dict[int, PageMarkup]:
    pages: dict[int, PageMarkup] = {}
    total = sum(len(block) for _title, block in planned) or 1
    for _given, block in planned:
        progress.check_cancelled()
        for index in block:
            keep = keep_images and index + 1 not in recognised
            page = page_markup(document[index], images=keep)
            page.markup = extract_images(page_body(page.markup), images, keep)
            pages[index] = page
        progress.report(
            0.1 + 0.7 * len(pages) / total,
            "progress.converting",
            {"current": len(pages), "total": total},
        )
    return pages


def _build_chapters(
    planned: list[tuple[str | None, list[int]]], pages: dict[int, PageMarkup]
) -> list[_Chapter]:
    body = body_size(list(pages.values()))
    chapters: list[_Chapter] = []
    for given, block in planned:
        bodies = [retag_headings(pages[index], body).strip() for index in block]
        bodies = [text for text in bodies if text]
        if bodies:
            name = given or chapter_title(bodies[0], block[0], block[-1])
            chapters.append(_Chapter(title=name, indices=block, documents=bodies))
    return chapters


def _write_epub(
    partial: Path,
    title: str,
    author: str,
    language: str,
    chapters: list[_Chapter],
    images: list[_Image],
    cover: bytes | None,
) -> None:
    identifier = f"urn:uuid:{uuid.uuid4()}"
    modified = pymupdf.get_pdf_now()[2:16]
    stamp = (
        f"{modified[:4]}-{modified[4:6]}-{modified[6:8]}"
        f"T{modified[8:10]}:{modified[10:12]}:{modified[12:14]}Z"
    )
    with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED
        )
        archive.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n',
        )
        archive.writestr("OEBPS/style.css", STYLE)
        archive.writestr(
            "OEBPS/content.opf",
            content_opf(
                identifier, title, author, language, stamp, chapters, images, cover is not None
            ),
        )
        archive.writestr("OEBPS/nav.xhtml", nav_xhtml(title, language, chapters))
        archive.writestr("OEBPS/toc.ncx", toc_ncx(identifier, title, chapters))
        for position, chapter in enumerate(chapters, start=1):
            archive.writestr(
                f"OEBPS/text/chapter{position:04d}.xhtml",
                chapter_document(chapter.title, language, chapter.documents),
            )
        for image in images:
            archive.writestr(f"OEBPS/images/{image.name}", image.payload)
        if cover is not None:
            archive.writestr(f"OEBPS/{COVER_NAME}", cover)


@op("convert.to_epub", EpubParams)
def to_epub(params: EpubParams, progress: Progress) -> EpubResult:
    target = _prepare_epub(params.output, params.path, params.overwrite)
    images: dict[str, _Image] = {}
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        planned = limit_chapters(plan_chapters(document, indices, params.split))
        language = document_language(document) or (
            params.language if LANGUAGE.match(params.language) else "en"
        )
        title = params.title or _metadata_value(document, "title") or Path(params.path).stem
        author = params.author or _metadata_value(document, "author")
        recognised: list[int] = []
        if params.ocr:
            recognised = recognise_textless_pages(
                document, indices, params.ocr_languages, progress.within(0.0, 0.5)
            )
            progress = progress.within(0.5, 1.0)
        pages = _collect_pages(
            document, planned, images, params.include_images, recognised, progress
        )
        progress.check_cancelled()
        chapters = _build_chapters(planned, pages)
        textless = sorted(index + 1 for index, page in pages.items() if not page.sizes)
        if not chapters:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "the selected pages have no text",
                {"reason": "noText"},
            )
        page_count = sum(len(chapter.indices) for chapter in chapters)
        cover = cover_image(document[chapters[0].indices[0]]) if params.cover else None

    ordered = list(images.values())
    progress.report(0.9, "progress.saving")
    write_atomically(
        target,
        lambda partial: _write_epub(partial, title, author, language, chapters, ordered, cover),
    )
    return EpubResult(
        output=str(target),
        bytes=target.stat().st_size,
        chapters=len(chapters),
        images=len(ordered),
        page_count=page_count,
        cover=cover is not None,
        textless_pages=textless,
        ocr_pages=recognised,
    )
