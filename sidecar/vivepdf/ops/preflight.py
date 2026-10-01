import math
import re
from typing import Literal

import pymupdf

from vivepdf.ops._colour_use import ColourUse
from vivepdf.ops._document import open_document
from vivepdf.ops._print_facts import ink_coverage, pdf_version, pdfx_facts, text_facts
from vivepdf.ops.a11y import _font_facts, require_pages
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

Status = Literal["pass", "warn", "fail"]
Profile = Literal["digital", "offset", "pdfx1a", "pdfx4"]
PRESS_PROFILES = {"offset", "pdfx1a", "pdfx4"}
PDFX_RULES = {"pdfx1a": ("PDF/X-1", (1, 4), "x1a"), "pdfx4": ("PDF/X-4", (1, 6), "x4")}
INK_LIMIT = 300
MAX_PAGES = 200
MIN_IMAGE_SIDE_PT = 8
HAIRLINE_PT = 0.25
BLEED_PT = 5.0
EDGE_PT = 3.0
EDGE_MIN_AREA = 400.0
PALE_LEVEL = 0.92
PRINT_DPI = 150
LOW_DPI = 100
OFFSET_PRINT_DPI = 300
OFFSET_LOW_DPI = 150
MAX_LOW_IMAGES = 200
MM = 25.4 / 72
SOFT_MASK_PATTERN = re.compile(r"/SMask\s*(?!/None)[/<\d]")
BLEND_PATTERN = re.compile(r"/BM\s*/(\w+)")
ALPHA_PATTERN = re.compile(r"/(?:ca|CA)\s+(\d*\.?\d+)")
OPAQUE_BLENDS = {"Normal", "Compatible"}


class PreflightCheck(RpcModel):
    id: str
    status: Status
    count: int | None = None
    value: str | None = None
    pages: list[int] = []
    variant: str | None = None


class LowImage(RpcModel):
    page: int
    dpi: int
    width: int
    height: int


class PreflightReport(RpcModel):
    page_count: int
    pdf_version: str
    encrypted: bool
    page_sizes: list[str]
    unembedded_fonts: list[str]
    images: int
    min_dpi: int | None
    low_images: list[LowImage]
    low_image_count: int = 0
    color_spaces: dict[str, int]
    vector_color_spaces: dict[str, int] = {}
    transparency_pages: int
    annotations: int
    form_fields: int
    blank_pages: int
    hairline_pages: int = 0
    edge_pages: int = 0
    has_bleed: bool = False
    profile: Profile = "digital"
    output_intent: str | None = None
    pdfx_version: str | None = None
    max_ink_coverage: int | None = None
    smallest_text: float | None = None
    checks: list[PreflightCheck]
    ready: bool


class PreflightParams(RpcModel):
    path: str
    password: str | None = None
    profile: Profile = "digital"


def _size_label(rect: pymupdf.Rect) -> str:
    short, long = sorted((round(rect.width * MM), round(rect.height * MM)))
    return f"{short}×{long}"


def _color_family(info: dict) -> str:
    name = str(info.get("cs-name") or "")
    components = int(info.get("colorspace") or 0)
    if "Lab" in name:
        return "lab"
    if "CMYK" in name or components == 4:
        return "cmyk"
    if "Gray" in name or components == 1:
        return "gray"
    return "rgb"


def _drawn_sides(info: dict) -> tuple[float, float]:
    transform = info.get("transform")
    if transform and len(transform) >= 4:
        a, b, c, d = (float(value) for value in transform[:4])
        return math.hypot(a, b), math.hypot(c, d)
    bbox = pymupdf.Rect(info["bbox"])
    return bbox.width, bbox.height


def _image_dpi(info: dict) -> int | None:
    across, down = _drawn_sides(info)
    if across < MIN_IMAGE_SIDE_PT or down < MIN_IMAGE_SIDE_PT:
        return None
    width = int(info.get("width") or 0)
    height = int(info.get("height") or 0)
    if width <= 0 or height <= 0:
        return None
    return int(min(width / (across / 72), height / (down / 72)))


def _drawings_of(page: pymupdf.Page) -> list[dict]:
    try:
        return page.get_drawings()
    except Exception:  # noqa: BLE001
        return []


def _hairlines_in(drawings: list[dict]) -> int:
    found = 0
    for drawing in drawings:
        if drawing.get("type") not in ("s", "fs"):
            continue
        width = drawing.get("width")
        if width is None or width >= HAIRLINE_PT:
            continue
        found += 1
    return found


def _bleed_of(page: pymupdf.Page) -> float:
    try:
        trim = pymupdf.Rect(page.trimbox)
        bleed = pymupdf.Rect(page.bleedbox)
    except Exception:  # noqa: BLE001
        return 0.0
    if trim.is_empty or bleed.is_empty:
        return 0.0
    return min(trim.x0 - bleed.x0, bleed.x1 - trim.x1, trim.y0 - bleed.y0, bleed.y1 - trim.y1)


def _is_pale(colour) -> bool:
    if not colour:
        return True
    values = [float(value) for value in list(colour)[:3]]
    if not values:
        return True
    return sum(values) / len(values) >= PALE_LEVEL


def _touches_the_edge(page: pymupdf.Page, infos: list[dict], drawings: list[dict]) -> bool:
    rect = pymupdf.Rect(page.rect * page.derotation_matrix).normalize()
    margin = pymupdf.Rect(
        rect.x0 + EDGE_PT, rect.y0 + EDGE_PT, rect.x1 - EDGE_PT, rect.y1 - EDGE_PT
    )
    if margin.is_empty:
        return False
    for info in infos:
        box = pymupdf.Rect(info["bbox"])
        if not box.is_empty and not margin.contains(box):
            return True
    for drawing in drawings:
        box = pymupdf.Rect(drawing.get("rect"))
        if box.is_empty or box.get_area() < EDGE_MIN_AREA:
            continue
        if _is_pale(drawing.get("fill")) and _is_pale(drawing.get("color")):
            continue
        if not margin.contains(box):
            return True
    return False


def _see_through(value: float | None) -> bool:
    return value is not None and value < 1


def _graphics_states(document: pymupdf.Document, page: pymupdf.Page) -> str:
    try:
        kind, value = document.xref_get_key(page.xref, "Resources/ExtGState")
        if kind == "xref":
            return document.xref_object(int(value.split()[0]), compressed=True)
    except Exception:  # noqa: BLE001
        return ""
    return value if kind == "dict" else ""


def _states_blend(states: str) -> bool:
    if SOFT_MASK_PATTERN.search(states):
        return True
    if any(mode not in OPAQUE_BLENDS for mode in BLEND_PATTERN.findall(states)):
        return True
    return any(float(alpha) < 1 for alpha in ALPHA_PATTERN.findall(states))


def _page_has_transparency(page: pymupdf.Page, drawings: list[dict]) -> bool:
    for image in page.get_images(full=True):
        if image[1]:
            return True
    for drawing in drawings:
        if _see_through(drawing.get("fill_opacity")) or _see_through(drawing.get("stroke_opacity")):
            return True
    return _states_blend(_graphics_states(page.parent, page))


def _is_encrypted(document: pymupdf.Document) -> bool:
    return bool(document.is_encrypted or (document.metadata or {}).get("encryption"))


def _page_list(pages) -> list[int]:
    return sorted(pages)[:MAX_PAGES]


def _families_text(families: dict[str, int]) -> str | None:
    return ", ".join(f"{key.upper()} {value}" for key, value in sorted(families.items())) or None


def _colour_check(
    check_id: str, profile: Profile, families: dict[str, int], pages
) -> PreflightCheck:
    rgb = bool(families.get("rgb"))
    variant = None
    if profile == "pdfx1a" and (rgb or families.get("lab")):
        status: Status = "fail"
    elif profile == "offset" and rgb:
        status = "fail"
    elif profile == "pdfx4" and rgb:
        status, variant = "warn", "managed"
    else:
        status = "warn" if rgb and families.get("cmyk") else "pass"
    return PreflightCheck(
        id=check_id,
        status=status,
        count=families.get("rgb", 0) if check_id == "vectorColors" else None,
        value=_families_text(families),
        pages=_page_list(pages) if status != "pass" else [],
        variant=variant,
    )


def _pdfx_checks(
    document: pymupdf.Document, profile: Profile
) -> tuple[list[PreflightCheck], str | None, str | None]:
    if profile not in PDFX_RULES:
        return [], None, None
    family, limit, variant = PDFX_RULES[profile]
    facts = pdfx_facts(document)
    version = pdf_version(document)
    declared = facts.version
    if declared and declared.startswith(family):
        identifier = PreflightCheck(id="pdfxId", status="pass", value=declared)
    else:
        identifier = PreflightCheck(
            id="pdfxId", status="warn", value=declared, variant="other" if declared else None
        )
    checks = [
        PreflightCheck(
            id="outputIntent",
            status="pass" if facts.has_output_intent else "fail",
            value=facts.output_intent or ("GTS_PDFX" if facts.has_output_intent else None),
        ),
        PreflightCheck(
            id="trimBox",
            status="pass" if not facts.pages_without_trim else "fail",
            count=len(facts.pages_without_trim),
            pages=_page_list(facts.pages_without_trim),
        ),
        PreflightCheck(
            id="pdfVersion",
            status="fail" if version is not None and version > limit else "pass",
            value=f"{version[0]}.{version[1]}" if version else "?",
            variant=variant if version is not None and version > limit else None,
        ),
        identifier,
    ]
    return checks, facts.output_intent, declared


def build_report(
    document: pymupdf.Document, progress: Progress | None = None, profile: Profile = "digital"
) -> PreflightReport:
    require_pages(document)
    press = profile in PRESS_PROFILES
    pdfx = profile in PDFX_RULES
    print_dpi = OFFSET_PRINT_DPI if press else PRINT_DPI
    low_dpi = OFFSET_LOW_DPI if press else LOW_DPI
    sizes: dict[str, int] = {}
    page_labels: list[str] = []
    images = 0
    min_dpi: int | None = None
    low_images: list[LowImage] = []
    low_image_count = 0
    color_spaces: dict[str, int] = {}
    vector_color_spaces: dict[str, int] = {}
    colour_use = ColourUse(document)
    hits: dict[str, set[int]] = {
        key: set()
        for key in (
            "images",
            "transparency",
            "colorSpaces",
            "vectorColors",
            "annotations",
            "forms",
            "blankPages",
            "hairlines",
            "bleed",
            "safeZone",
            "smallText",
            "inkCoverage",
        )
    }
    annotations = 0
    form_fields = 0
    bleed_pages = 0
    smallest_text: float | None = None
    max_ink: int | None = None
    total = document.page_count
    for index in range(total):
        if progress:
            progress.check_cancelled()
            if index % 10 == 0:
                progress.report(
                    index / max(1, total),
                    "progress.inspecting",
                    {"current": index + 1, "total": total},
                )
        number = index + 1
        page = document[index]
        label = _size_label(page.rect)
        sizes[label] = sizes.get(label, 0) + 1
        page_labels.append(label)
        infos = page.get_image_info()
        drawings = _drawings_of(page)
        images += len(infos)
        for info in infos:
            family = _color_family(info)
            color_spaces[family] = color_spaces.get(family, 0) + 1
            if family in ("rgb", "lab"):
                hits["colorSpaces"].add(number)
            dpi = _image_dpi(info)
            if dpi is None:
                continue
            min_dpi = dpi if min_dpi is None else min(min_dpi, dpi)
            if dpi < print_dpi:
                low_image_count += 1
                hits["images"].add(number)
            if dpi < print_dpi and len(low_images) < MAX_LOW_IMAGES:
                low_images.append(
                    LowImage(
                        page=number,
                        dpi=dpi,
                        width=int(info.get("width") or 0),
                        height=int(info.get("height") or 0),
                    )
                )
        for family in colour_use.page_families(page):
            vector_color_spaces[family] = vector_color_spaces.get(family, 0) + 1
            if family == "rgb":
                hits["vectorColors"].add(number)
        if _page_has_transparency(page, drawings):
            hits["transparency"].add(number)
        if _hairlines_in(drawings):
            hits["hairlines"].add(number)
        if _bleed_of(page) >= BLEED_PT:
            bleed_pages += 1
        elif _touches_the_edge(page, infos, drawings):
            hits["bleed"].add(number)
        page_annotations = sum(
            1 for annot in page.annots() if annot.type[1] not in {"Link", "Widget"}
        )
        page_fields = sum(1 for _ in page.widgets())
        annotations += page_annotations
        form_fields += page_fields
        if page_annotations:
            hits["annotations"].add(number)
        if page_fields:
            hits["forms"].add(number)
        if not infos and not drawings and not page.get_text().strip():
            hits["blankPages"].add(number)
        texts = text_facts(page)
        if texts.smallest is not None:
            smallest_text = (
                texts.smallest if smallest_text is None else min(smallest_text, texts.smallest)
            )
        if texts.small:
            hits["smallText"].add(number)
        if texts.near_edge:
            hits["safeZone"].add(number)
        if press:
            coverage = ink_coverage(page)
            max_ink = coverage if max_ink is None else max(max_ink, coverage)
            if coverage > INK_LIMIT:
                hits["inkCoverage"].add(number)
    fonts = _font_facts(document)
    unembedded = fonts.unembedded
    page_sizes = [label for label, _count in sorted(sizes.items(), key=lambda item: -item[1])]
    odd_sizes = {
        number for number, label in enumerate(page_labels, start=1) if label != page_sizes[0]
    }
    worst_dpi = min_dpi if low_image_count else None
    encrypted = _is_encrypted(document)
    issue: Status = "fail" if press else "warn"
    transparency_pages = len(hits["transparency"])
    if profile == "pdfx1a":
        transparency_status: Status = "fail" if transparency_pages else "pass"
    elif profile == "pdfx4":
        transparency_status = "pass"
    else:
        transparency_status = "warn" if transparency_pages else "pass"
    interactive: Status = "fail" if pdfx else "warn"

    def counted(check_id: str, status_if_found: Status) -> PreflightCheck:
        found = hits[check_id]
        return PreflightCheck(
            id=check_id,
            status=status_if_found if found else "pass",
            count=len(found),
            pages=_page_list(found),
        )

    checks = [
        PreflightCheck(
            id="fonts",
            status="pass" if not unembedded else "fail",
            count=len(unembedded),
            pages=_page_list(fonts.unembedded_pages),
        ),
        PreflightCheck(
            id="images",
            status="pass"
            if not low_image_count
            else ("fail" if worst_dpi is not None and worst_dpi < low_dpi else "warn"),
            count=low_image_count,
            value=str(min_dpi) if min_dpi is not None else None,
            pages=_page_list(hits["images"]),
        ),
        PreflightCheck(
            id="pageSizes",
            status="pass" if len(sizes) <= 1 else "warn",
            count=len(sizes),
            value=", ".join(page_sizes[:4]),
            pages=_page_list(odd_sizes),
        ),
        PreflightCheck(
            id="transparency",
            status=transparency_status,
            count=transparency_pages,
            pages=_page_list(hits["transparency"]),
            variant="allowed" if profile == "pdfx4" and transparency_pages else None,
        ),
        _colour_check("colorSpaces", profile, color_spaces, hits["colorSpaces"]),
        _colour_check("vectorColors", profile, vector_color_spaces, hits["vectorColors"]),
        PreflightCheck(
            id="annotations",
            status=interactive if annotations else "pass",
            count=annotations,
            pages=_page_list(hits["annotations"]),
        ),
        PreflightCheck(
            id="forms",
            status=interactive if form_fields else "pass",
            count=form_fields,
            pages=_page_list(hits["forms"]),
        ),
        counted("blankPages", "warn"),
        counted("hairlines", issue),
        counted("bleed", issue),
        PreflightCheck(
            id="safeZone",
            status="warn" if hits["safeZone"] else "pass",
            count=len(hits["safeZone"]),
            pages=_page_list(hits["safeZone"]),
        ),
        PreflightCheck(
            id="smallText",
            status="warn" if hits["smallText"] else "pass",
            count=len(hits["smallText"]),
            value=f"{smallest_text:g}" if smallest_text is not None else None,
            pages=_page_list(hits["smallText"]),
        ),
    ]
    if press:
        checks.append(
            PreflightCheck(
                id="inkCoverage",
                status="fail" if hits["inkCoverage"] else "pass",
                count=len(hits["inkCoverage"]),
                value=str(max_ink) if max_ink is not None else None,
                pages=_page_list(hits["inkCoverage"]),
            )
        )
    checks.append(PreflightCheck(id="encryption", status="pass" if not encrypted else issue))
    pdfx_checks, output_intent, pdfx_version = _pdfx_checks(document, profile)
    checks.extend(pdfx_checks)
    metadata = document.metadata or {}
    return PreflightReport(
        page_count=total,
        pdf_version=str(metadata.get("format") or ""),
        encrypted=encrypted,
        page_sizes=page_sizes,
        unembedded_fonts=unembedded,
        images=images,
        min_dpi=min_dpi,
        low_images=low_images,
        low_image_count=low_image_count,
        color_spaces=color_spaces,
        vector_color_spaces=vector_color_spaces,
        transparency_pages=transparency_pages,
        annotations=annotations,
        hairline_pages=len(hits["hairlines"]),
        edge_pages=len(hits["bleed"]),
        has_bleed=bleed_pages > 0,
        form_fields=form_fields,
        blank_pages=len(hits["blankPages"]),
        profile=profile,
        output_intent=output_intent,
        pdfx_version=pdfx_version,
        max_ink_coverage=max_ink,
        smallest_text=smallest_text,
        checks=checks,
        ready=all(check.status != "fail" for check in checks),
    )


@op("preflight.check", PreflightParams)
def check(params: PreflightParams, progress: Progress) -> PreflightReport:
    with open_document(params.path, params.password) as document:
        return build_report(document, progress, params.profile)
