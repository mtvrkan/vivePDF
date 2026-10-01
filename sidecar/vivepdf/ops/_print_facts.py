import re
from dataclasses import dataclass, field

import numpy
import pymupdf

SAFE_ZONE_PT = 3 * 72 / 25.4
SMALL_TEXT_PT = 6.0
INK_DPI = 50
REFERENCE_PATTERN = re.compile(r"(\d+)\s+0\s+R")
PDFX_XMP_PATTERN = re.compile(r"GTS_PDFXVersion\s*(?:=\s*[\"']|>)\s*(PDF/X-[^<\"']+)")
PDFX_INTENT_PATTERN = re.compile(r"/S\s*/GTS_PDFX\b")
CONDITION_PATTERN = re.compile(r"/OutputCondition(?:Identifier)?\s*\(([^)]*)\)")
VERSION_PATTERN = re.compile(r"(\d+)\.(\d+)")


@dataclass
class TextFacts:
    smallest: float | None = None
    small: bool = False
    near_edge: bool = False


@dataclass
class PdfxFacts:
    version: str | None = None
    output_intent: str | None = None
    has_output_intent: bool = False
    pages_without_trim: list[int] = field(default_factory=list)


def _has_box(document: pymupdf.Document, page: pymupdf.Page, key: str) -> bool:
    try:
        return document.xref_get_key(page.xref, key)[0] == "array"
    except Exception:  # noqa: BLE001
        return False


def trim_rect(page: pymupdf.Page) -> pymupdf.Rect:
    crop = page.cropbox
    whole = pymupdf.Rect(0, 0, crop.width, crop.height)
    document = page.parent
    for key, box in (("TrimBox", page.trimbox), ("ArtBox", page.artbox)):
        if not _has_box(document, page, key):
            continue
        shifted = pymupdf.Rect(
            box.x0 - crop.x0, box.y0 - crop.y0, box.x1 - crop.x0, box.y1 - crop.y0
        )
        shifted.intersect(whole)
        if not shifted.is_empty:
            return shifted
    return whole


def text_facts(page: pymupdf.Page) -> TextFacts:
    facts = TextFacts()
    try:
        spans = page.get_texttrace()
    except Exception:  # noqa: BLE001
        return facts
    trim = trim_rect(page)
    safe = pymupdf.Rect(
        trim.x0 + SAFE_ZONE_PT,
        trim.y0 + SAFE_ZONE_PT,
        trim.x1 - SAFE_ZONE_PT,
        trim.y1 - SAFE_ZONE_PT,
    )
    for span in spans:
        if span.get("type") == 3 or not span.get("chars") or (span.get("opacity") or 0) <= 0:
            continue
        if all(chr(char[0]).isspace() for char in span["chars"]):
            continue
        size = round(float(span.get("size") or 0), 1)
        if size > 0:
            facts.smallest = size if facts.smallest is None else min(facts.smallest, size)
            if size < SMALL_TEXT_PT:
                facts.small = True
        box = pymupdf.Rect(span["bbox"])
        if box.is_empty or not box.intersects(trim):
            continue
        if safe.is_empty or not safe.contains(box):
            facts.near_edge = True
    return facts


def ink_coverage(page: pymupdf.Page) -> int:
    pixmap = page.get_pixmap(colorspace=pymupdf.csCMYK, dpi=INK_DPI, alpha=False)
    if pixmap.width == 0 or pixmap.height == 0:
        return 0
    samples = numpy.frombuffer(pixmap.samples, dtype=numpy.uint8)
    total = samples.reshape(-1, 4).sum(axis=1, dtype=numpy.uint16)
    return round(int(total.max()) * 100 / 255)


def _string_key(document: pymupdf.Document, xref: int, key: str) -> str | None:
    kind, value = document.xref_get_key(xref, key)
    if kind in ("string", "name") and value:
        return value.lstrip("/")
    return None


def _declared_version(document: pymupdf.Document) -> str | None:
    kind, value = document.xref_get_key(-1, "Info")
    if kind == "xref":
        found = _string_key(document, int(value.split()[0]), "GTS_PDFXVersion")
        if found:
            return found.strip()
    try:
        match = PDFX_XMP_PATTERN.search(document.get_xml_metadata() or "")
    except Exception:  # noqa: BLE001
        match = None
    return match.group(1).strip() if match else None


def _output_intents(document: pymupdf.Document) -> list[str]:
    kind, value = document.xref_get_key(document.pdf_catalog(), "OutputIntents")
    if kind == "xref":
        value = document.xref_object(int(value.split()[0]), compressed=True)
    elif kind != "array":
        return []
    bodies = []
    for reference in REFERENCE_PATTERN.findall(value):
        xref = int(reference)
        if 0 < xref < document.xref_length():
            bodies.append(document.xref_object(xref, compressed=True))
    if not bodies and "<<" in value:
        bodies = value.split("<<")[1:]
    return bodies


def pdfx_facts(document: pymupdf.Document) -> PdfxFacts:
    facts = PdfxFacts(version=_declared_version(document))
    for body in _output_intents(document):
        if not PDFX_INTENT_PATTERN.search(body):
            continue
        facts.has_output_intent = True
        match = CONDITION_PATTERN.search(body)
        if match and match.group(1).strip():
            facts.output_intent = match.group(1).strip()
            break
    for index in range(document.page_count):
        page = document[index]
        if not _has_box(document, page, "TrimBox") and not _has_box(document, page, "ArtBox"):
            facts.pages_without_trim.append(index + 1)
    return facts


def pdf_version(document: pymupdf.Document) -> tuple[int, int] | None:
    match = VERSION_PATTERN.search(str((document.metadata or {}).get("format") or ""))
    return (int(match.group(1)), int(match.group(2))) if match else None
