import heapq
import math
import re
from pathlib import Path
from typing import Literal

import pymupdf

from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

Kind = Literal["image", "font", "content", "metadata", "attachment", "other"]
KINDS: list[Kind] = ["image", "font", "content", "metadata", "attachment", "other"]
FONT_SUBTYPES = {"/Type1C", "/CIDFontType0C", "/CIDFontType2", "/OpenType"}
LARGEST_LIMIT = 8
PAGE_LIST_LIMIT = 20
SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
NAME_ESCAPE = re.compile(r"#([0-9A-Fa-f]{2})")
ImageFormat = Literal["jpeg", "jpeg2000", "jbig2", "ccitt", "flate", "none", "other"]
FontFormat = Literal["type1", "truetype", "cff", "opentype"]
IMAGE_FORMATS: dict[str, ImageFormat] = {
    "/DCTDecode": "jpeg",
    "/JPXDecode": "jpeg2000",
    "/JBIG2Decode": "jbig2",
    "/CCITTFaxDecode": "ccitt",
    "/FlateDecode": "flate",
    "/LZWDecode": "flate",
    "/RunLengthDecode": "flate",
}
FONT_FILE_KEYS = {"FontFile": "type1", "FontFile2": "truetype", "FontFile3": "cff"}


class SpaceGroup(RpcModel):
    kind: Kind
    bytes: int
    count: int


class LargeImage(RpcModel):
    xref: int
    bytes: int
    width: int
    height: int
    format: ImageFormat
    pages: list[int]
    dpi: int | None = None


class LargeFont(RpcModel):
    xref: int
    bytes: int
    name: str
    subset: bool
    format: FontFormat


class SpaceParams(RpcModel):
    path: str
    password: str | None = None


class SpaceReport(RpcModel):
    total_bytes: int
    stored_bytes: int
    groups: list[SpaceGroup]
    image_count: int
    largest_image_bytes: int
    squeezable_share: float
    largest_images: list[LargeImage] = []
    largest_fonts: list[LargeFont] = []


def _content_xrefs(document: pymupdf.Document) -> set[int]:
    found: set[int] = set()
    for index in range(document.page_count):
        try:
            found.update(document[index].get_contents())
        except Exception:  # noqa: BLE001
            continue
    return found


def _kind_of(document: pymupdf.Document, xref: int, contents: set[int]) -> Kind:
    if xref in contents:
        return "content"
    if document.xref_get_key(xref, "Subtype")[1] == "/Image":
        return "image"
    if document.xref_get_key(xref, "Subtype")[1] in FONT_SUBTYPES:
        return "font"
    kind = document.xref_get_key(xref, "Type")[1]
    if kind == "/Metadata":
        return "metadata"
    if kind == "/EmbeddedFile":
        return "attachment"
    if document.xref_get_key(xref, "Length1")[0] != "null":
        return "font"
    return "other"


def _image_format(document: pymupdf.Document, xref: int) -> ImageFormat:
    kind, value = document.xref_get_key(xref, "Filter")
    if kind == "null":
        return "none"
    names = value.strip("[]").split("/")
    last = f"/{names[-1].strip()}" if names and names[-1].strip() else ""
    return IMAGE_FORMATS.get(last, "other")


def _int_key(document: pymupdf.Document, xref: int, key: str) -> int:
    kind, value = document.xref_get_key(xref, key)
    try:
        return int(float(value)) if kind in ("int", "float") else 0
    except ValueError:
        return 0


def _image_pages(
    document: pymupdf.Document, wanted: set[int], progress: Progress
) -> dict[int, list[int]]:
    pages: dict[int, list[int]] = {xref: [] for xref in wanted}
    for index in range(document.page_count):
        if index % 50 == 0:
            progress.check_cancelled()
        try:
            found = {entry[0] for entry in document.get_page_images(index, full=True)}
        except Exception:  # noqa: BLE001
            continue
        for xref in found & wanted:
            if len(pages[xref]) < PAGE_LIST_LIMIT:
                pages[xref].append(index + 1)
    return pages


def _placed_dpi(document: pymupdf.Document, xref: int, page_number: int) -> int | None:
    width = _int_key(document, xref, "Width")
    height = _int_key(document, xref, "Height")
    try:
        rects = document[page_number - 1].get_image_rects(xref)
    except Exception:  # noqa: BLE001
        return None
    areas = [rect.width * rect.height for rect in rects if not rect.is_empty]
    if not areas or not width or not height:
        return None
    return round(math.sqrt(width * height / max(areas)) * 72)


def _largest_images(
    document: pymupdf.Document, sized: list[tuple[int, int]], progress: Progress
) -> list[LargeImage]:
    top = heapq.nlargest(LARGEST_LIMIT, sized)
    if not top:
        return []
    pages = _image_pages(document, {xref for _, xref in top}, progress)
    images: list[LargeImage] = []
    for size, xref in top:
        found = pages.get(xref, [])
        images.append(
            LargeImage(
                xref=xref,
                bytes=size,
                width=_int_key(document, xref, "Width"),
                height=_int_key(document, xref, "Height"),
                format=_image_format(document, xref),
                pages=found,
                dpi=_placed_dpi(document, xref, found[0]) if found else None,
            )
        )
    return images


def _decoded_name(value: str) -> str:
    name = value.lstrip("/")
    return NAME_ESCAPE.sub(lambda match: chr(int(match.group(1), 16)), name)


def _font_descriptors(document: pymupdf.Document, wanted: set[int]) -> dict[int, tuple[str, str]]:
    found: dict[int, tuple[str, str]] = {}
    for xref in range(1, document.xref_length()):
        try:
            if document.xref_get_key(xref, "Type")[1] != "/FontDescriptor":
                continue
            name = document.xref_get_key(xref, "FontName")[1]
            for key, font_format in FONT_FILE_KEYS.items():
                kind, value = document.xref_get_key(xref, key)
                if kind == "xref" and int(value.split()[0]) in wanted:
                    found[int(value.split()[0])] = (name, font_format)
        except Exception:  # noqa: BLE001
            continue
    return found


def _font_format(document: pymupdf.Document, xref: int, declared: str) -> FontFormat:
    if document.xref_get_key(xref, "Subtype")[1] == "/OpenType":
        return "opentype"
    return declared if declared in ("type1", "truetype") else "cff"


def _largest_fonts(document: pymupdf.Document, sized: list[tuple[int, int]]) -> list[LargeFont]:
    top = heapq.nlargest(LARGEST_LIMIT, sized)
    if not top:
        return []
    descriptors = _font_descriptors(document, {xref for _, xref in top})
    fonts: list[LargeFont] = []
    for size, xref in top:
        raw_name, declared = descriptors.get(xref, ("", "cff"))
        name = _decoded_name(raw_name)
        fonts.append(
            LargeFont(
                xref=xref,
                bytes=size,
                name=SUBSET_PREFIX.sub("", name),
                subset=bool(SUBSET_PREFIX.match(name)),
                format=_font_format(document, xref, declared),
            )
        )
    return fonts


def _file_size(path: str) -> int:
    try:
        return Path(path).stat().st_size
    except OSError:
        return 0


@op("compress.space", SpaceParams)
def space(params: SpaceParams, progress: Progress) -> SpaceReport:
    sizes: dict[Kind, int] = dict.fromkeys(KINDS, 0)
    counts: dict[Kind, int] = dict.fromkeys(KINDS, 0)
    stored = 0
    largest_image = 0
    images: list[tuple[int, int]] = []
    fonts: list[tuple[int, int]] = []
    with open_document(params.path, params.password, mutable=False) as cached:
        document = unwrap_document(cached)
        contents = _content_xrefs(document)
        length = document.xref_length()
        for xref in range(1, length):
            progress.check_cancelled()
            if not document.xref_is_stream(xref):
                continue
            try:
                size = len(document.xref_stream_raw(xref))
            except Exception:  # noqa: BLE001
                continue
            kind = _kind_of(document, xref, contents)
            sizes[kind] += size
            counts[kind] += 1
            stored += size
            if kind == "image":
                largest_image = max(largest_image, size)
                images.append((size, xref))
            elif kind == "font":
                fonts.append((size, xref))
            if xref % 500 == 0:
                progress.report(xref / max(1, length) * 0.8, "progress.analyzing")
        largest_images = _largest_images(document, images, progress)
        largest_fonts = _largest_fonts(document, fonts)
    total_bytes = _file_size(params.path)
    return SpaceReport(
        total_bytes=total_bytes,
        stored_bytes=stored,
        groups=[
            SpaceGroup(kind=kind, bytes=sizes[kind], count=counts[kind])
            for kind in KINDS
            if sizes[kind] > 0
        ],
        image_count=counts["image"],
        largest_image_bytes=largest_image,
        squeezable_share=round(sizes["image"] / total_bytes, 4) if total_bytes else 0.0,
        largest_images=largest_images,
        largest_fonts=largest_fonts,
    )
