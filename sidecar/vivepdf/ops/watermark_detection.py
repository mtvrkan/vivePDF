import base64
import hashlib
import math
import re
from collections import defaultdict
from typing import Literal

import numpy
import pymupdf

from vivepdf.ops._content import (
    content_tokens,
    invocation_spans,
    marked_spans,
)
from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._raster import (
    INK_LEVEL,
    background_of,
    coverage_of,
    ink_of,
    ink_picture,
    isolated_mark,
    mark_mask,
    repeated_ink,
    resized,
    screened_part,
    working_size,
)
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

WATERMARK_ANNOT_TYPES = (pymupdf.PDF_ANNOT_WATERMARK,)
STAMP_ANNOT_TYPES = (pymupdf.PDF_ANNOT_STAMP,)
WATERMARK_PIECE_PATH = "PieceInfo/ADBE_CompoundType/Private"
ARTIFACT_WATERMARK = b"/Watermark"
ARTIFACT_WATERMARK_NAME = re.compile(rb"/Watermark(?![^\s/<>\[\]()%{}])")
PROPERTY_REFERENCE = re.compile(rb"/([^\s/<>\[\]()]+)\s+(\d+)\s+0\s+R")
OBJECT_REFERENCE = re.compile(r"(\d+)\s+0\s+R")
REPEATED_IMAGE_MIN_PAGES = 3
REPEATED_IMAGE_SHARE = 0.6
DETECT_MAX_PAGES = 40
DETECT_SHARE = 0.6
DETECT_TEXT_MIN_SIZE = 24.0
DETECT_TEXT_MAX_LENGTH = 60
DETECT_FAINT_LUMINANCE = 0.72
DETECT_PREVIEW_MAX_SIDE = 192
IMAGE_MARK_MIN_COVERAGE = 0.06
RASTER_MIN_PAGES = 3
RASTER_STACK_MAX = 8
RASTER_WORK_SIDE = 1600
RASTER_PAGE_SHARE = 0.8
RASTER_MIN_COVERAGE = 0.002
RASTER_MAX_COVERAGE = 0.6


class WatermarkCandidate(RpcModel):
    id: str
    kind: Literal[
        "text", "image", "annotation", "stampAnnotation", "tagged", "artifact", "layer", "raster"
    ]
    text: str | None = None
    digest: str | None = None
    layer: int | None = None
    coverage: float | None = None
    pages: int
    sample_page: int
    rotated: bool = False
    faint: bool = False
    font_size: float | None = None
    preview: str | None = None
    width: int | None = None
    height: int | None = None
    confident: bool = True


class DetectWatermarkParams(RpcModel):
    path: str
    password: str | None = None
    pages: str | None = None


class DetectWatermarkResult(RpcModel):
    candidates: list[WatermarkCandidate]
    pages_scanned: int
    page_count: int


def _turkish_lower(value: str) -> str:
    return value.replace("İ", "i").replace("I", "ı").lower()


def _image_digests(
    document: pymupdf.Document, indices: list[int]
) -> tuple[dict[int, str], dict[str, set[int]], dict[int, set[int]]]:
    digest_of: dict[int, str] = {}
    pages_by_digest: dict[str, set[int]] = defaultdict(set)
    xrefs_by_page: dict[int, set[int]] = defaultdict(set)
    for index in indices:
        for image in document[index].get_images(full=True):
            xref = image[0]
            if xref not in digest_of:
                try:
                    payload = document.extract_image(xref)
                except Exception:  # noqa: BLE001
                    continue
                digest_of[xref] = hashlib.sha1(payload["image"]).hexdigest()
            pages_by_digest[digest_of[xref]].add(index)
            xrefs_by_page[index].add(xref)
    return digest_of, pages_by_digest, xrefs_by_page


def _repeated_digests(pages_by_digest: dict[str, set[int]], scanned: int) -> set[str]:
    threshold = max(REPEATED_IMAGE_MIN_PAGES, int(scanned * REPEATED_IMAGE_SHARE))
    return {digest for digest, pages in pages_by_digest.items() if len(pages) >= threshold}


def _image_placement(page: pymupdf.Page, xref: int) -> tuple[float, bool]:
    try:
        rects = page.get_image_rects(xref)
    except Exception:  # noqa: BLE001
        return 0.0, False
    area = page.rect.get_area() or 1.0
    middle = pymupdf.Point((page.rect.x0 + page.rect.x1) / 2, (page.rect.y0 + page.rect.y1) / 2)
    ratio = max((rect.get_area() / area for rect in rects), default=0.0)
    return ratio, any(rect.contains(middle) for rect in rects)


def _looks_like_a_mark(ratio: float, covers_middle: bool) -> bool:
    return covers_middle or ratio >= IMAGE_MARK_MIN_COVERAGE


LAYER_MARK_WORDS = (
    "watermark",
    "filigran",
    "wasserzeichen",
    "filigrana",
    "marca de agua",
    "marque",
    "watermerk",
    "水印",
    "stamp",
    "damga",
    "confidential",
    "gizli",
    "draft",
    "taslak",
    "copy",
    "kopya",
    "background",
    "arkaplan",
)


def _looks_like_a_layer_mark(name: str) -> bool:
    lowered = _turkish_lower(name)
    return any(word in lowered for word in LAYER_MARK_WORDS)


def _is_a_strong_mark(record: dict) -> bool:
    return record["size"] >= DETECT_TEXT_MIN_SIZE and (record["rotated"] or record["faint"])


def _sampled_indices(indices: list[int]) -> list[int]:
    if len(indices) <= DETECT_MAX_PAGES:
        return indices
    step = len(indices) / DETECT_MAX_PAGES
    return sorted({indices[int(position * step)] for position in range(DETECT_MAX_PAGES)})


def _share_threshold(scanned: int) -> int:
    return max(1 if scanned < 2 else 2, math.ceil(scanned * DETECT_SHARE))


def _luminance(color: int) -> float:
    red = ((color >> 16) & 0xFF) / 255
    green = ((color >> 8) & 0xFF) / 255
    blue = (color & 0xFF) / 255
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _text_marks_on(page: pymupdf.Page) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = " ".join("".join(span.get("text", "") for span in spans).split())
            if not 2 <= len(text) <= DETECT_TEXT_MAX_LENGTH:
                continue
            direction = line.get("dir", (1.0, 0.0))
            rotated = abs(float(direction[1])) > 0.05
            size = max((float(span.get("size", 0)) for span in spans), default=0.0)
            faint = all(
                _luminance(int(span.get("color", 0))) > DETECT_FAINT_LUMINANCE for span in spans
            )
            if not rotated and size < DETECT_TEXT_MIN_SIZE and not faint:
                continue
            entry = found.setdefault(text, {"rotated": False, "faint": True, "size": 0.0})
            entry["rotated"] = entry["rotated"] or rotated
            entry["faint"] = entry["faint"] and faint
            entry["size"] = max(entry["size"], size)
    return found


def _image_preview(document: pymupdf.Document, xref: int) -> tuple[str, int, int] | None:
    try:
        pixmap = pymupdf.Pixmap(document, xref)
    except Exception:  # noqa: BLE001
        return None
    try:
        if pixmap.colorspace is not None and pixmap.n - pixmap.alpha > 3:
            pixmap = pymupdf.Pixmap(pymupdf.csRGB, pixmap)
        width, height = pixmap.width, pixmap.height
        while max(pixmap.width, pixmap.height) > DETECT_PREVIEW_MAX_SIDE:
            pixmap.shrink(1)
        return base64.b64encode(pixmap.tobytes("png")).decode("ascii"), width, height
    except Exception:  # noqa: BLE001
        return None


def _annotated_pages(document: pymupdf.Document, indices: list[int], types: tuple[int, ...]) -> int:
    if not document.has_annots():
        return 0
    return sum(1 for index in indices if any(True for _ in document[index].annots(types)))


def _page_xobjects(page: pymupdf.Page) -> list[tuple[int, str]]:
    return [(item[0], item[1]) for item in page.get_xobjects() if not item[2]]


def _tagged_names(document: pymupdf.Document, page: pymupdf.Page) -> dict[str, int]:
    names: dict[str, int] = {}
    for xref, name in _page_xobjects(page):
        kind, value = document.xref_get_key(xref, WATERMARK_PIECE_PATH)
        if kind == "name" and value == "/Watermark":
            names[name] = xref
    return names


def _xobject_layer(document: pymupdf.Document, xref: int) -> int | None:
    kind, value = document.xref_get_key(xref, "OC")
    if kind != "xref":
        return None
    match = OBJECT_REFERENCE.match(value)
    return int(match.group(1)) if match else None


def _page_properties(document: pymupdf.Document, page: pymupdf.Page) -> dict[str, int]:
    kind, value = document.xref_get_key(page.xref, "Resources/Properties")
    if kind != "dict":
        return {}
    return {
        match.group(1).decode("latin-1"): int(match.group(2))
        for match in PROPERTY_REFERENCE.finditer(value.encode("latin-1"))
    }


def _is_watermark_mark(
    tag: bytes, prop: bytes, properties: set[bytes], artifacts: set[bytes] | None
) -> bool:
    if artifacts is not None and tag == b"/Artifact":
        return bool(ARTIFACT_WATERMARK_NAME.search(prop)) or prop in artifacts
    return tag == b"/OC" and prop in properties


def _mark_spans(
    data: bytes,
    names: dict[str, int],
    properties: set[bytes],
    artifacts: set[bytes] | None,
) -> list[tuple[int, int]]:
    calls = {b"/" + name.encode("latin-1") for name in names}
    wanted = {*calls, *properties, *(artifacts or set())}
    if artifacts is not None:
        wanted.add(ARTIFACT_WATERMARK)
    if not any(needle in data for needle in wanted):
        return []
    tokens = content_tokens(data)
    spans = marked_spans(
        tokens, lambda tag, prop: _is_watermark_mark(tag, prop, properties, artifacts)
    )
    if calls:
        spans += invocation_spans(tokens, calls)
    return spans


def _artifact_names(document: pymupdf.Document, page: pymupdf.Page) -> set[bytes]:
    found: set[bytes] = set()
    for name, xref in _page_properties(document, page).items():
        try:
            kind, value = document.xref_get_key(xref, "Subtype")
        except (ValueError, RuntimeError):
            continue
        if kind == "name" and value == "/Watermark":
            found.add(b"/" + name.encode("latin-1"))
    return found


def _artifact_marks_on(document: pymupdf.Document, page: pymupdf.Page) -> int:
    return len(_mark_spans(page.read_contents(), {}, set(), _artifact_names(document, page)))


def _layers_on(document: pymupdf.Document, page: pymupdf.Page) -> set[int]:
    used = {xref for _name, xref in _page_properties(document, page).items()}
    for xref, _name in _page_xobjects(page):
        layer = _xobject_layer(document, xref)
        if layer is not None:
            used.add(layer)
    return used


def _full_page_image(page: pymupdf.Page) -> int | None:
    images = page.get_images(full=True)
    if len(images) != 1:
        return None
    xref = images[0][0]
    rectangles = page.get_image_rects(xref)
    area = page.rect.get_area()
    if len(rectangles) != 1 or area <= 0:
        return None
    if rectangles[0].get_area() / area < RASTER_PAGE_SHARE:
        return None
    return xref


def _scan_pages(document: pymupdf.Document, indices: list[int]) -> list[tuple[int, int]]:
    pages: list[tuple[int, int]] = []
    for index in indices:
        xref = _full_page_image(document[index])
        if xref is None:
            continue
        pages.append((index, xref))
    if len({xref for _index, xref in pages}) < RASTER_MIN_PAGES:
        return []
    return pages


def _is_stencil(document: pymupdf.Document, xref: int) -> bool:
    return document.xref_get_key(xref, "ImageMask")[1] == "true"


def _is_bilevel(document: pymupdf.Document, xref: int) -> bool:
    return _is_stencil(document, xref) or document.xref_get_key(xref, "BitsPerComponent")[1] == "1"


def _stencil_ink(document: pymupdf.Document, xref: int) -> numpy.ndarray | None:
    try:
        pixmap = pymupdf.Pixmap(document, xref)
    except (ValueError, RuntimeError):
        return None
    if pixmap.colorspace is not None or pixmap.n != 1:
        return None
    buffer = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8)
    rows = buffer.reshape(pixmap.height, pixmap.stride)[:, : pixmap.width]
    return rows >= INK_LEVEL


def _page_ink(document: pymupdf.Document, xref: int) -> numpy.ndarray | None:
    if _is_stencil(document, xref):
        return _stencil_ink(document, xref)
    found = _frame_of(document, xref)
    return None if found is None else ink_of(found[0])


def _all_bilevel(document: pymupdf.Document, pages: list[tuple[int, int]]) -> bool:
    return all(_is_bilevel(document, xref) for _index, xref in pages)


def _ink_mark(
    document: pymupdf.Document, pages: list[tuple[int, int]]
) -> tuple[numpy.ndarray, tuple[int, int]] | None:
    found = _repeated_ink_of(document, pages)
    if found is None:
        return None
    return screened_part(found[0]), found[1]


def _repeated_ink_of(
    document: pymupdf.Document, pages: list[tuple[int, int]]
) -> tuple[numpy.ndarray, tuple[int, int]] | None:
    counted: numpy.ndarray | None = None
    native: tuple[int, int] | None = None
    seen = 0
    for _index, xref in _spread_sample(pages, RASTER_STACK_MAX):
        ink = _page_ink(document, xref)
        if ink is None:
            continue
        if counted is None:
            counted = numpy.zeros(ink.shape, dtype=numpy.uint8)
            native = (ink.shape[1], ink.shape[0])
        if ink.shape != counted.shape:
            continue
        counted += ink
        seen += 1
    if counted is None or native is None or seen < RASTER_MIN_PAGES:
        return None
    return repeated_ink(counted, seen), native


def _frame_of(document: pymupdf.Document, xref: int) -> tuple[numpy.ndarray, bool] | None:
    try:
        pixmap = pymupdf.Pixmap(document, xref)
    except (ValueError, RuntimeError):
        return None
    if pixmap.colorspace is None:
        return None
    gray = pixmap.n - int(pixmap.alpha) == 1
    if pixmap.alpha or pixmap.n != 3:
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pixmap)
    buffer = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8)
    rows = buffer.reshape(pixmap.height, pixmap.stride)[:, : pixmap.width * 3]
    return rows.reshape(pixmap.height, pixmap.width, 3), gray


def _spread_sample(pages: list[tuple[int, int]], wanted: int) -> list[tuple[int, int]]:
    if len(pages) <= wanted:
        return pages
    step = len(pages) / wanted
    return [pages[min(len(pages) - 1, int(position * step))] for position in range(wanted)]


def _raster_background(
    document: pymupdf.Document, pages: list[tuple[int, int]]
) -> tuple[numpy.ndarray, numpy.ndarray, numpy.ndarray] | None:
    frames: list[numpy.ndarray] = []
    size: tuple[int, int] | None = None
    for _index, xref in _spread_sample(pages, RASTER_STACK_MAX):
        found = _frame_of(document, xref)
        if found is None:
            continue
        frame = found[0]
        if size is None:
            size = working_size(frame.shape[1], frame.shape[0], RASTER_WORK_SIDE)
        frames.append(resized(frame, size))
    if size is None or len(frames) < RASTER_MIN_PAGES:
        return None
    return background_of(numpy.stack(frames))


def _frame_preview(frame: numpy.ndarray) -> tuple[str, int, int]:
    size = working_size(frame.shape[1], frame.shape[0], DETECT_PREVIEW_MAX_SIDE)
    small = numpy.ascontiguousarray(resized(frame, size))
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, size[0], size[1], small.tobytes(), False)
    return base64.b64encode(pixmap.tobytes("png")).decode("ascii"), size[0], size[1]


def _burned_mark(
    document: pymupdf.Document, pages: list[tuple[int, int]]
) -> tuple[numpy.ndarray, numpy.ndarray] | None:
    if _all_bilevel(document, pages):
        found = _ink_mark(document, pages)
        if found is None:
            return None
        return found[0], ink_picture(found[0])
    estimate = _raster_background(document, pages)
    if estimate is None:
        return None
    background, agreed, paper = estimate
    mask = mark_mask(background, agreed, paper)
    return mask, isolated_mark(background, mask, paper)


def _raster_candidate(document: pymupdf.Document, indices: list[int]) -> WatermarkCandidate | None:
    pages = _scan_pages(document, indices)
    if len(pages) < RASTER_MIN_PAGES:
        return None
    found = _burned_mark(document, pages)
    if found is None:
        return None
    mask, picture = found
    coverage = coverage_of(mask)
    if not RASTER_MIN_COVERAGE <= coverage <= RASTER_MAX_COVERAGE:
        return None
    preview = _frame_preview(picture)
    return WatermarkCandidate(
        id="raster",
        kind="raster",
        pages=len(pages),
        sample_page=pages[0][0] + 1,
        coverage=round(coverage, 4),
        preview=preview[0],
        width=preview[1],
        height=preview[2],
        confident=False,
    )


@op("security.detect_watermark", DetectWatermarkParams)
def detect_watermark(params: DetectWatermarkParams, progress: Progress) -> DetectWatermarkResult:
    with open_document(params.path, params.password, mutable=False) as cached:
        document = unwrap_document(cached)
        selected = parse_page_ranges(params.pages, document.page_count)
        indices = _sampled_indices(selected)
        threshold = _share_threshold(len(indices))
        texts: dict[str, dict] = {}
        annotated_pages = _annotated_pages(document, selected, WATERMARK_ANNOT_TYPES)
        stamped_pages = _annotated_pages(document, selected, STAMP_ANNOT_TYPES)
        tagged_pages = 0
        artifact_pages = 0
        layer_pages: dict[int, int] = defaultdict(int)
        for position, index in enumerate(indices):
            progress.check_cancelled()
            page = document[index]
            if _tagged_names(document, page):
                tagged_pages += 1
            if _artifact_marks_on(document, page):
                artifact_pages += 1
            for layer in _layers_on(document, page):
                layer_pages[layer] += 1
            for text, entry in _text_marks_on(page).items():
                record = texts.setdefault(
                    text,
                    {
                        "pages": 0,
                        "sample_page": index + 1,
                        "rotated": False,
                        "faint": True,
                        "size": 0.0,
                    },
                )
                record["pages"] += 1
                record["rotated"] = record["rotated"] or entry["rotated"]
                record["faint"] = record["faint"] and entry["faint"]
                record["size"] = max(record["size"], entry["size"])
            if position % 10 == 0:
                progress.report(
                    position / max(1, len(indices)),
                    "progress.scanning",
                    {"current": position + 1, "total": len(indices)},
                )
        digest_of, pages_by_digest, _ = _image_digests(document, indices)
        repeated = _repeated_digests(pages_by_digest, len(indices))
        xref_of_digest: dict[str, int] = {}
        for xref, digest in digest_of.items():
            xref_of_digest.setdefault(digest, xref)

        candidates: list[WatermarkCandidate] = []
        for digest in sorted(repeated, key=lambda item: -len(pages_by_digest[item])):
            sample_index = min(pages_by_digest[digest])
            preview = _image_preview(document, xref_of_digest[digest])
            placement = max(
                (
                    _image_placement(document[sample_index], image[0])
                    for image in document[sample_index].get_images(full=True)
                    if digest_of.get(image[0]) == digest
                ),
                default=(0.0, False),
            )
            candidates.append(
                WatermarkCandidate(
                    id=f"image:{digest[:12]}",
                    kind="image",
                    digest=digest,
                    pages=len(pages_by_digest[digest]),
                    sample_page=sample_index + 1,
                    preview=preview[0] if preview else None,
                    width=preview[1] if preview else None,
                    height=preview[2] if preview else None,
                    confident=_looks_like_a_mark(*placement),
                )
            )
        kept = [
            (text, record)
            for text, record in sorted(texts.items(), key=lambda item: -item[1]["pages"])
            if record["pages"] >= threshold or _is_a_strong_mark(record)
        ]
        for text, record in kept:
            if any(
                text != other and text in other and record["pages"] <= sibling["pages"]
                for other, sibling in kept
            ):
                continue
            candidates.append(
                WatermarkCandidate(
                    id=f"text:{text}",
                    kind="text",
                    text=text,
                    pages=record["pages"],
                    sample_page=record["sample_page"],
                    rotated=record["rotated"],
                    faint=record["faint"],
                    font_size=round(record["size"], 1),
                    confident=record["rotated"] or _is_a_strong_mark(record),
                )
            )
        if tagged_pages:
            candidates.insert(
                0,
                WatermarkCandidate(
                    id="tagged",
                    kind="tagged",
                    pages=tagged_pages,
                    sample_page=1,
                ),
            )
        if artifact_pages:
            candidates.insert(
                0,
                WatermarkCandidate(
                    id="artifact",
                    kind="artifact",
                    pages=artifact_pages,
                    sample_page=1,
                ),
            )
        known = document.get_ocgs()
        seen_layers = {layer: pages for layer, pages in layer_pages.items() if layer in known}
        for layer, pages in sorted(seen_layers.items(), key=lambda item: -item[1]):
            candidates.append(
                WatermarkCandidate(
                    id=f"layer:{layer}",
                    kind="layer",
                    layer=layer,
                    text=str(known.get(layer, {}).get("name") or ""),
                    pages=pages,
                    sample_page=1,
                    confident=_looks_like_a_layer_mark(str(known.get(layer, {}).get("name") or "")),
                )
            )
        burned = _raster_candidate(document, indices)
        if burned is not None:
            candidates.append(burned)
        if annotated_pages:
            candidates.append(
                WatermarkCandidate(
                    id="annotation",
                    kind="annotation",
                    pages=annotated_pages,
                    sample_page=1,
                )
            )
        if stamped_pages:
            candidates.append(
                WatermarkCandidate(
                    id="stampAnnotation",
                    kind="stampAnnotation",
                    pages=stamped_pages,
                    sample_page=1,
                    confident=False,
                )
            )
        return DetectWatermarkResult(
            candidates=candidates,
            pages_scanned=len(indices),
            page_count=document.page_count,
        )
