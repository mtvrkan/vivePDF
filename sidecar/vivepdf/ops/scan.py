import base64
import contextlib
import io
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import pymupdf
import zxingcpp
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from pydantic import Field

from vivepdf.ops._blank import blank_page
from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._naming import render_name, unique_name
from vivepdf.ops._orientation import best_rotation, capped_dpi
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops._protection import protection_source
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._text_match import compile_text_pattern, text_label
from vivepdf.ops._toc import normalized_toc
from vivepdf.ops.analyze import SCANNED_IMAGE_COVERAGE_LIMIT, _analyze_page
from vivepdf.ops.merge_split import _write_part
from vivepdf.ops.ocr import HIDDEN_TEXT_FONT, HiddenFonts, _language_string, write_hidden_words
from vivepdf.ops.pages import page_label_parts
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

SKEW_LIMIT = 5.0
SKEW_COARSE_STEP = 0.5
SKEW_FINE_STEP = 0.1
SKEW_MIN_GAIN = 1.04
SKEW_THUMBNAIL = 900
QR_DPIS = (120, 240)
INK_THRESHOLD = 128
EDGE_MAX_SHARE = 0.08
EDGE_DARKNESS = 0.7
AUTO_SAMPLE_SIDE = 600
AUTO_CHROMA_LEVEL = 40
AUTO_CHROMA_SHARE = 0.01
AUTO_MIDTONE_SHARE = 0.06
ADAPTIVE_MIN_RADIUS = 8
ADAPTIVE_WINDOW_DIVISOR = 40
ADAPTIVE_OFFSET = 14.0
ADAPTIVE_DARK = 60.0
PREVIEW_QUALITY = 80

ColorMode = Literal["color", "gray", "bw"]
EnhanceMode = Literal["auto", "color", "gray", "bw"]

HIDDEN_TRACE_TYPE = 3


def detect_color_mode(image: Image.Image) -> ColorMode:
    sample = image.convert("RGB")
    sample.thumbnail((AUTO_SAMPLE_SIDE, AUTO_SAMPLE_SIDE))
    array = np.asarray(sample).astype(np.int16)
    chroma = array.max(axis=2) - array.min(axis=2)
    if float((chroma > AUTO_CHROMA_LEVEL).mean()) > AUTO_CHROMA_SHARE:
        return "color"
    gray = array.mean(axis=2)
    midtones = float(((gray > 70) & (gray < 190)).mean())
    return "gray" if midtones > AUTO_MIDTONE_SHARE else "bw"


def _edge_band(levels: np.ndarray, limit: float, reach: int) -> int:
    band = 0
    while band < reach and levels[band] < limit:
        band += 1
    return band


def clean_edges(image: Image.Image) -> Image.Image:
    gray = np.asarray(ImageOps.grayscale(image)).astype(np.float32)
    height, width = gray.shape
    paper = float(np.percentile(gray, 90))
    limit = paper * EDGE_DARKNESS
    rows = gray.mean(axis=1)
    columns = gray.mean(axis=0)
    row_reach = int(height * EDGE_MAX_SHARE)
    column_reach = int(width * EDGE_MAX_SHARE)
    top = _edge_band(rows, limit, row_reach)
    bottom = _edge_band(rows[::-1], limit, row_reach)
    left = _edge_band(columns, limit, column_reach)
    right = _edge_band(columns[::-1], limit, column_reach)
    if not (top or bottom or left or right):
        return image
    cleaned = image.copy()
    draw = ImageDraw.Draw(cleaned)
    fill = (255, 255, 255) if cleaned.mode == "RGB" else 255
    if top:
        draw.rectangle((0, 0, width, top - 1), fill=fill)
    if bottom:
        draw.rectangle((0, height - bottom, width, height), fill=fill)
    if left:
        draw.rectangle((0, 0, left - 1, height), fill=fill)
    if right:
        draw.rectangle((width - right, 0, width, height), fill=fill)
    return cleaned


def page_image(page: pymupdf.Page, dpi: int, annots: bool = True) -> Image.Image:
    pixmap = page.get_pixmap(
        dpi=capped_dpi(page.rect, dpi), colorspace=pymupdf.csRGB, alpha=False, annots=annots
    )
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _ink_profile_variance(ink: np.ndarray) -> float:
    return float(np.var(ink.sum(axis=1)))


def estimate_skew(image: Image.Image) -> float:
    gray = ImageOps.grayscale(image)
    gray.thumbnail((SKEW_THUMBNAIL, SKEW_THUMBNAIL))

    def score(angle: float) -> float:
        rotated = gray.rotate(angle, resample=Image.Resampling.BILINEAR, fillcolor=255)
        return _ink_profile_variance(np.asarray(rotated) < INK_THRESHOLD)

    baseline = score(0.0)
    if baseline <= 0:
        return 0.0
    coarse = np.arange(-SKEW_LIMIT, SKEW_LIMIT + SKEW_COARSE_STEP / 2, SKEW_COARSE_STEP)
    best_angle = max(coarse, key=score)
    fine = np.arange(
        best_angle - SKEW_COARSE_STEP,
        best_angle + SKEW_COARSE_STEP + SKEW_FINE_STEP / 2,
        SKEW_FINE_STEP,
    )
    best_angle = max(fine, key=score)
    if score(best_angle) < baseline * SKEW_MIN_GAIN:
        return 0.0
    return float(round(best_angle, 2))


def deskew(image: Image.Image, angle: float) -> Image.Image:
    return image.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=(255, 255, 255))


def whiten(image: Image.Image) -> Image.Image:
    array = np.asarray(image).astype(np.float32)
    white = np.clip(np.percentile(array, 88, axis=(0, 1)), 150.0, 250.0)
    black = np.minimum(np.percentile(array, 1, axis=(0, 1)), 60.0)
    stretched = (array - black) * (255.0 / np.maximum(white - black, 1.0))
    return Image.fromarray(np.clip(stretched, 0, 255).astype(np.uint8), "RGB")


def despeckle(image: Image.Image) -> Image.Image:
    return image.filter(ImageFilter.MedianFilter(3))


def adaptive_black_white(gray: Image.Image) -> Image.Image:
    radius = max(ADAPTIVE_MIN_RADIUS, min(gray.size) // ADAPTIVE_WINDOW_DIVISOR)
    levels = np.asarray(gray, dtype=np.float32)
    local = np.asarray(gray.filter(ImageFilter.BoxBlur(radius)), dtype=np.float32)
    ink = (levels < local - ADAPTIVE_OFFSET) | (levels < ADAPTIVE_DARK)
    paper = np.where(ink, 0, 255).astype(np.uint8)
    return Image.fromarray(paper, "L").convert("1", dither=Image.Dither.NONE)


def apply_color_mode(image: Image.Image, mode: ColorMode) -> Image.Image:
    if mode == "color":
        return image
    gray = ImageOps.grayscale(image)
    if mode == "gray":
        return gray
    return adaptive_black_white(gray)


def encode_image(image: Image.Image, mode: ColorMode, quality: int) -> bytes:
    buffer = io.BytesIO()
    if mode == "bw":
        image.save(buffer, format="PNG", optimize=True)
    else:
        image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


class EnhanceSettings(RpcModel):
    deskew: bool = True
    despeckle: bool = True
    whiten: bool = True
    contrast: float = Field(default=1.0, ge=0.5, le=3.0)
    mode: EnhanceMode = "color"
    clean_edges: bool = False


class EnhanceParams(EnhanceSettings):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    only_scanned: bool = True
    dpi: int = Field(default=200, ge=100, le=400)
    orientation: bool = False
    remove_blank: bool = False
    languages: list[str] = Field(default_factory=lambda: ["eng"])
    jpeg_quality: int = Field(default=82, ge=30, le=100)


@dataclass(frozen=True)
class CleanedPage:
    image: Image.Image
    mode: ColorMode
    angle: float


def cleaned_page_image(page: pymupdf.Page, settings: EnhanceSettings, dpi: int) -> CleanedPage:
    image = page_image(page, dpi, annots=False)
    angle = estimate_skew(image) if settings.deskew else 0.0
    if angle:
        image = deskew(image, angle)
    if settings.clean_edges:
        image = clean_edges(image)
    if settings.despeckle:
        image = despeckle(image)
    if settings.whiten:
        image = whiten(image)
    if settings.contrast != 1.0:
        image = ImageEnhance.Contrast(image).enhance(settings.contrast)
    mode = detect_color_mode(image) if settings.mode == "auto" else settings.mode
    return CleanedPage(apply_color_mode(image, mode), mode, angle)


class EnhanceResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    enhanced_pages: int
    skipped_pages: int
    deskewed_pages: int
    rotated_pages: int
    removed_pages: int = 0
    ocr_kept_pages: int = 0
    ocr_dropped_pages: int = 0


HiddenWords = list[tuple[pymupdf.Rect, str]]


def hidden_text_layer(page: pymupdf.Page) -> HiddenWords:
    spans = page.get_texttrace()
    if not spans or any(span["type"] != HIDDEN_TRACE_TYPE for span in spans):
        return []
    matrix = page.rotation_matrix
    return [
        (pymupdf.Rect(word[:4]) * matrix, word[4])
        for word in page.get_text("words")
        if word[4].strip()
    ]


def turned_words(words: HiddenWords, area: pymupdf.Rect, angle: float) -> HiddenWords:
    radians = math.radians(angle)
    cos, sin = math.cos(radians), math.sin(radians)
    center_x, center_y = area.x0 + area.width / 2, area.y0 + area.height / 2
    turned: HiddenWords = []
    for box, text in words:
        dx = box.x0 + box.width / 2 - center_x
        dy = box.y0 + box.height / 2 - center_y
        new_x = center_x + dx * cos + dy * sin
        new_y = center_y - dx * sin + dy * cos
        half_w, half_h = box.width / 2, box.height / 2
        turned.append(
            (pymupdf.Rect(new_x - half_w, new_y - half_h, new_x + half_w, new_y + half_h), text)
        )
    return turned


def _replace_with_image(document: pymupdf.Document, index: int, rotation: int, data: bytes) -> None:
    page = document[index]
    if page.rotation != rotation:
        page.set_rotation(rotation)
    contents = document.get_new_xref()
    document.update_object(contents, "<<>>")
    document.update_stream(contents, b" ")
    document.xref_set_key(page.xref, "Contents", f"{contents} 0 R")
    document.xref_set_key(page.xref, "Resources", "<<>>")
    for key in ("Group", "StructParents", "PieceInfo"):
        document.xref_set_key(page.xref, key, "null")
    page = document[index]
    page.insert_image(
        page.rect * insertion_matrix(page), stream=data, rotate=page.rotation, overlay=True
    )


def _scan_like(document: pymupdf.Document, index: int, hidden: HiddenWords) -> bool:
    analysis = _analyze_page(document, index)
    if analysis.scanned:
        return True
    return bool(hidden) and analysis.image_coverage > SCANNED_IMAGE_COVERAGE_LIMIT


@op("scan.enhance", EnhanceParams)
def enhance(params: EnhanceParams, progress: Progress) -> EnhanceResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    language = _language_string(params.languages) if params.orientation else ""
    result = pymupdf.open()
    enhanced = skipped = deskewed = rotated = ocr_kept = ocr_dropped = 0
    removed: list[int] = []
    fonts: HiddenFonts | None = None
    try:
        with open_document(params.path, params.password) as document:
            selected = set(parse_page_ranges(params.pages, document.page_count))
            total = document.page_count
            result.insert_pdf(document)
            for index in range(total):
                progress.check_cancelled()
                if index not in selected:
                    continue
                page = document[index]
                if params.remove_blank and blank_page(page):
                    removed.append(index)
                    continue
                hidden = hidden_text_layer(page)
                if params.only_scanned and not _scan_like(document, index, hidden):
                    skipped += 1
                    continue
                if params.orientation:
                    rotation = best_rotation(page, language)
                    if rotation:
                        page.set_rotation((page.rotation + rotation) % 360)
                        rotated += 1
                        if hidden:
                            hidden = []
                            ocr_dropped += 1
                cleaned = cleaned_page_image(page, params, params.dpi)
                if cleaned.angle:
                    deskewed += 1
                    if hidden:
                        hidden = turned_words(hidden, page.rect, cleaned.angle)
                data = encode_image(cleaned.image, cleaned.mode, params.jpeg_quality)
                _replace_with_image(result, index, page.rotation, data)
                if hidden:
                    fonts = fonts or HiddenFonts()
                    write_hidden_words(result[index], hidden, fonts)
                    ocr_kept += 1
                enhanced += 1
                progress.report(
                    (index + 1) / total,
                    "progress.enhancing",
                    {"current": index + 1, "total": total},
                )
            toc = document.get_toc(simple=True)
            if toc:
                result.set_toc(normalized_toc(toc))
            if len(removed) == total:
                raise OpError(
                    ErrorCode.INVALID_PARAMS, "every page is blank", {"reason": "allBlank"}
                )
            if removed:
                result.delete_pages(removed)
        if fonts is not None:
            with contextlib.suppress(Exception):
                result.subset_fonts()
        progress.report(0.95, "progress.saving")
        saved = save_document(result, target)
        return EnhanceResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            enhanced_pages=enhanced,
            skipped_pages=skipped,
            deskewed_pages=deskewed,
            rotated_pages=rotated,
            removed_pages=len(removed),
            ocr_kept_pages=ocr_kept,
            ocr_dropped_pages=ocr_dropped,
        )
    finally:
        result.close()


class EnhancePreviewParams(EnhanceSettings):
    path: str
    password: str | None = None
    page: int = Field(default=0, ge=0)
    dpi: int = Field(default=110, ge=50, le=200)


class EnhancePreviewResult(RpcModel):
    before: str
    after: str
    after_format: Literal["jpeg", "png"]
    width: int
    height: int
    angle: float
    mode: ColorMode
    page_count: int


def _encoded_preview(image: Image.Image, mode: ColorMode) -> str:
    buffer = io.BytesIO()
    if mode == "bw":
        image.save(buffer, format="PNG", optimize=True)
    else:
        image.convert("RGB").save(buffer, format="JPEG", quality=PREVIEW_QUALITY)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


@op("scan.enhancePreview", EnhancePreviewParams)
def enhance_preview(params: EnhancePreviewParams, progress: Progress) -> EnhancePreviewResult:
    with open_document(params.path, params.password, mutable=False) as cached:
        document = unwrap_document(cached)
        if params.page >= document.page_count:
            raise OpError(ErrorCode.INVALID_PARAMS, "page out of range", {"reason": "page"})
        progress.check_cancelled()
        page = document[params.page]
        before = page_image(page, params.dpi, annots=False)
        progress.check_cancelled()
        cleaned = cleaned_page_image(page, params, params.dpi)
        return EnhancePreviewResult(
            before=_encoded_preview(before, "color"),
            after=_encoded_preview(cleaned.image, cleaned.mode),
            after_format="png" if cleaned.mode == "bw" else "jpeg",
            width=before.width,
            height=before.height,
            angle=cleaned.angle,
            mode=cleaned.mode,
            page_count=document.page_count,
        )


SplitMode = Literal["blank", "qr", "barcode", "text"]


class ScanSplitRules(RpcModel):
    path: str
    password: str | None = None
    mode: SplitMode = "blank"
    drop_separators: bool = True
    qr_prefix: str | None = None
    text_pattern: str | None = None
    min_pages: int = Field(default=1, ge=1, le=500)
    blank_run: int = Field(default=1, ge=1, le=5)


class ScanSplitPart(RpcModel):
    first_page: int = Field(ge=1)
    last_page: int = Field(ge=1)
    label: str | None = Field(default=None, max_length=200)


class ScanSplitParams(ScanSplitRules):
    output_dir: str
    pattern: str = "{name}-{n}"
    overwrite: bool = False
    parts: list[ScanSplitPart] | None = Field(default=None, max_length=5000)


class ScanSplitOutput(RpcModel):
    output: str
    page_count: int
    bytes: int
    first_page: int
    last_page: int
    label: str | None


class ScanSplitResult(RpcModel):
    outputs: list[ScanSplitOutput]
    separator_pages: list[int]


class ScanSplitPreviewPart(RpcModel):
    first_page: int
    last_page: int
    page_count: int
    label: str | None


class ScanSplitPreviewResult(RpcModel):
    parts: list[ScanSplitPreviewPart]
    separator_pages: list[int]
    page_count: int
    pages_without_text: int


@dataclass
class _Grouping:
    groups: list[tuple[list[int], str | None]]
    separators: list[int]
    pages_without_text: int


def read_qr_labels(page: pymupdf.Page, any_format: bool = False) -> list[str]:
    for dpi in QR_DPIS:
        image = ImageOps.grayscale(page_image(page, dpi))
        if any_format:
            codes = zxingcpp.read_barcodes(image)
        else:
            codes = zxingcpp.read_barcodes(image, formats=zxingcpp.BarcodeFormat.QRCode)
        texts = [code.text for code in codes if code.text]
        if texts:
            return texts
    return []


def _qr_label(page: pymupdf.Page, prefix: str | None, any_format: bool = False) -> str | None:
    for text in read_qr_labels(page, any_format):
        if prefix is None:
            return text
        if text.startswith(prefix):
            return text[len(prefix) :].strip()
    return None


def blank_runs(flags: list[bool], run: int) -> set[int]:
    found: set[int] = set()
    start = 0
    while start < len(flags):
        if not flags[start]:
            start += 1
            continue
        end = start
        while end < len(flags) and flags[end]:
            end += 1
        if end - start >= run:
            found.update(range(start, end))
        start = end
    return found


def _blank_flags(document: pymupdf.Document, progress: Progress) -> list[bool]:
    flags: list[bool] = []
    total = document.page_count
    for index in range(total):
        progress.check_cancelled()
        flags.append(_analyze_page(document, index).blank)
        if (index + 1) % 10 == 0:
            progress.report(
                (index + 1) / total * 0.6,
                "progress.analyzing",
                {"current": index + 1, "total": total},
            )
    return flags


def _explicit_groups(parts: list[ScanSplitPart], total: int) -> _Grouping:
    groups: list[tuple[list[int], str | None]] = []
    covered: set[int] = set()
    previous_last = 0
    for part in parts:
        if part.first_page > part.last_page or part.last_page > total:
            raise OpError(ErrorCode.INVALID_PARAMS, "part is out of range", {"reason": "parts"})
        if part.first_page <= previous_last:
            raise OpError(ErrorCode.INVALID_PARAMS, "parts overlap", {"reason": "parts"})
        previous_last = part.last_page
        pages = list(range(part.first_page - 1, part.last_page))
        covered.update(pages)
        label = part.label.strip() if part.label else None
        groups.append((pages, label or None))
    separators = [index + 1 for index in range(total) if index not in covered]
    return _Grouping(groups, separators, 0)


def _groups(params: ScanSplitRules, document: pymupdf.Document, progress: Progress) -> _Grouping:
    text_pattern: re.Pattern[str] | None = None
    if params.mode == "text":
        if not params.text_pattern or not params.text_pattern.strip():
            raise OpError(ErrorCode.INVALID_PARAMS, "textPattern is required for mode 'text'")
        text_pattern = compile_text_pattern(params.text_pattern)
    groups: list[tuple[list[int], str | None]] = []
    separators: list[int] = []
    current: list[int] = []
    current_label: str | None = None
    without_text = 0
    total = document.page_count
    blank_pages = (
        blank_runs(_blank_flags(document, progress), params.blank_run)
        if params.mode == "blank"
        else set()
    )
    for index in range(total):
        progress.check_cancelled()
        page = document[index]
        if params.mode == "text":
            text = page.get_text()
            if not text.strip():
                without_text += 1
            label = text_label(text, text_pattern) if text_pattern else None
            if label is not None and current:
                groups.append((current, current_label))
                current = []
            if label is not None:
                current_label = label
            current.append(index)
        else:
            continues_run = False
            if params.mode == "blank":
                is_separator = index in blank_pages
                continues_run = is_separator and index - 1 in blank_pages
                label = None
            else:
                label = _qr_label(page, params.qr_prefix, params.mode == "barcode")
                is_separator = label is not None
            if is_separator:
                separators.append(index + 1)
                if current and not continues_run:
                    groups.append((current, current_label))
                    current = []
                current_label = label
                if not params.drop_separators:
                    current.append(index)
            else:
                current.append(index)
        if (index + 1) % 10 == 0:
            progress.report(
                (index + 1) / total * 0.6,
                "progress.analyzing",
                {"current": index + 1, "total": total},
            )
    if current:
        groups.append((current, current_label))
    merged: list[tuple[list[int], str | None]] = []
    for pages, label in groups:
        if merged and len(pages) < params.min_pages:
            merged[-1][0].extend(pages)
        else:
            merged.append((pages, label))
    if len(merged) > 1 and len(merged[0][0]) < params.min_pages:
        first_pages, first_label = merged.pop(0)
        next_pages, next_label = merged[0]
        merged[0] = (
            first_pages + next_pages,
            first_label if first_label is not None else next_label,
        )
    return _Grouping(merged, separators, without_text)


@op("scan.splitPreview", ScanSplitRules)
def preview_split(params: ScanSplitRules, progress: Progress) -> ScanSplitPreviewResult:
    with open_document(params.path, params.password, mutable=False) as document:
        grouping = _groups(params, document, progress)
        page_count = document.page_count
    return ScanSplitPreviewResult(
        parts=[
            ScanSplitPreviewPart(
                first_page=pages[0] + 1, last_page=pages[-1] + 1, page_count=len(pages), label=label
            )
            for pages, label in grouping.groups
        ],
        separator_pages=grouping.separators,
        page_count=page_count,
        pages_without_text=grouping.pages_without_text,
    )


@op("scan.split", ScanSplitParams)
def split_scans(params: ScanSplitParams, progress: Progress) -> ScanSplitResult:
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(params.path).stem
    outputs: list[ScanSplitOutput] = []
    taken: set[str] = set()
    with open_document(params.path, params.password) as document:
        grouping = (
            _explicit_groups(params.parts, document.page_count)
            if params.parts is not None
            else _groups(params, document, progress)
        )
        groups, separators = grouping.groups, grouping.separators
        if not groups:
            raise OpError(ErrorCode.INVALID_PARAMS, "no pages left to write", {"reason": "empty"})
        width = len(str(len(groups)))
        targets = []
        for position, (group, label) in enumerate(groups):
            name = render_name(
                params.pattern,
                {
                    "name": stem,
                    "n": f"{position + 1:0{width}d}",
                    "total": len(groups),
                    "pages": len(group),
                    "label": label or "",
                },
            )
            name = unique_name(name, taken)
            targets.append(
                prepare_output(str(output_dir / f"{name}.pdf"), [params.path], params.overwrite)
            )
        labels = page_label_parts(document)
        seal, protection = protection_source(document, params.path, params.password)
        try:
            for position, (group, label) in enumerate(groups):
                progress.check_cancelled()
                progress.report(
                    0.6 + position / len(groups) * 0.4,
                    "progress.splitting",
                    {"current": position + 1, "total": len(groups)},
                )
                saved = _write_part(document, group, labels, targets[position], seal, protection)
                outputs.append(
                    ScanSplitOutput(
                        output=saved.output,
                        page_count=saved.page_count,
                        bytes=saved.bytes,
                        first_page=group[0] + 1,
                        last_page=group[-1] + 1,
                        label=label,
                    )
                )
        except BaseException:
            for written in outputs:
                Path(written.output).unlink(missing_ok=True)
            raise
        finally:
            if seal is not None:
                seal.close()
    return ScanSplitResult(outputs=outputs, separator_pages=separators)


SEPARATOR_PAPERS = {"a4": (595.0, 842.0), "letter": (612.0, 792.0)}
SEPARATOR_QR_SHARE = 0.55
SEPARATOR_MARGIN = 56.0
SEPARATOR_QR_TOP = 150.0
SEPARATOR_FALLBACK_TEXT = "VIVEPDF-SEPARATOR"
SEPARATOR_FONT = "VpSeparator"


class SeparatorSheetParams(RpcModel):
    output: str
    overwrite: bool = False
    labels: list[str] = Field(default_factory=lambda: [""], min_length=1, max_length=500)
    prefix: str = Field(default="VIVE:", max_length=40)
    title: str = Field(default="Separator sheet", max_length=80)
    hint: str = Field(default="", max_length=300)
    paper: Literal["a4", "letter"] = "a4"


class SeparatorSheetResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    separator_sheets: int


def _draw_qr(page: pymupdf.Page, text: str, area: pymupdf.Rect) -> None:
    modules = np.asarray(
        zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.QRCode).to_image(scale=1)
    )
    size = area.width / modules.shape[1]
    shape = page.new_shape()
    for row, column in zip(*np.nonzero(modules < 128), strict=True):
        x = area.x0 + float(column) * size
        y = area.y0 + float(row) * size
        shape.draw_rect(pymupdf.Rect(x, y, x + size, y + size))
    shape.finish(color=None, fill=(0, 0, 0), width=0)
    shape.commit()


def _centered_text(page: pymupdf.Page, box: pymupdf.Rect, text: str, size: float) -> None:
    if text.strip():
        page.insert_textbox(
            box,
            text,
            fontname=SEPARATOR_FONT,
            fontfile=str(HIDDEN_TEXT_FONT),
            fontsize=size,
            align=pymupdf.TEXT_ALIGN_CENTER,
        )


@op("scan.separatorSheet", SeparatorSheetParams)
def separator_sheet(params: SeparatorSheetParams, progress: Progress) -> SeparatorSheetResult:
    target = prepare_output(params.output, [], params.overwrite)
    width, height = SEPARATOR_PAPERS[params.paper]
    inner = width - SEPARATOR_MARGIN
    document = pymupdf.open()
    try:
        for position, raw in enumerate(params.labels):
            progress.check_cancelled()
            label = raw.strip()[:200]
            page = document.new_page(width=width, height=height)
            _centered_text(
                page, pymupdf.Rect(SEPARATOR_MARGIN, SEPARATOR_MARGIN, inner, 130), params.title, 28
            )
            side = width * SEPARATOR_QR_SHARE
            area = pymupdf.Rect(
                (width - side) / 2, SEPARATOR_QR_TOP, (width + side) / 2, SEPARATOR_QR_TOP + side
            )
            _draw_qr(page, f"{params.prefix}{label}" or SEPARATOR_FALLBACK_TEXT, area)
            _centered_text(
                page, pymupdf.Rect(SEPARATOR_MARGIN, area.y1 + 24, inner, area.y1 + 90), label, 22
            )
            _centered_text(
                page,
                pymupdf.Rect(SEPARATOR_MARGIN, height - 160, inner, height - SEPARATOR_MARGIN),
                params.hint,
                11,
            )
            progress.report(
                (position + 1) / len(params.labels),
                "progress.assembling",
                {"current": position + 1, "total": len(params.labels)},
            )
        with contextlib.suppress(Exception):
            document.subset_fonts()
        saved = save_document(document, target)
        return SeparatorSheetResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            separator_sheets=saved.page_count,
        )
    finally:
        document.close()
