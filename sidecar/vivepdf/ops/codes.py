import csv
import io
from pathlib import Path
from typing import Literal

import numpy as np
import pymupdf
import zxingcpp
from PIL import Image
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._output import prepare_data_output, prepare_output, save_document
from vivepdf.ops._placement import insertion_matrix
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.ops._spreadsheet import inert_cell
from vivepdf.ops._text_fit import MAX_REPORTED_GLYPHS, fit_line
from vivepdf.ops._watermark_style import WATERMARK_FONT, GridPosition, grid_cell
from vivepdf.ops.fonts import uncovered_glyphs
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

Position = GridPosition
ErrorLevel = Literal["L", "M", "Q", "H"]
QR_SCALE = 8
FALLBACK_DPI = 300
VERIFY_DPI = 300
VERIFY_PAD = 6.0
MAX_VALUES = 20000
MAX_SCAN_PIXELS = 60_000_000
ROI_DPI = 400
ROI_CELL = 8
ROI_EDGE_LEVEL = 40
ROI_MIN_DENSITY = 0.1
ROI_DOMINANCE = 3.0
ROI_MIN_CELLS = 10
ROI_MIN_ROWS = 2
ROI_MIN_SPAN = 5
ROI_MIN_BARS = 16
ROI_COHERENCE = 0.75
ROI_REGION_DOMINANCE = 5.0
ROI_SAMPLE_ROWS = 7
ROI_PAD_PT = 8.0
MAX_ROI_REGIONS = 12
FORMULA_PREFIXES = {"=", "+", "-", "@", "\t", "\r"}


class CodesReadParams(RpcModel):
    path: str
    password: str | None = None
    pages: str | None = None
    dpi: int = Field(default=150, ge=72, le=300)
    thorough: bool = False


class CodeHit(RpcModel):
    page: int
    format: str
    text: str
    x0: float
    y0: float
    x1: float
    y1: float


class CodesReadResult(RpcModel):
    codes: list[CodeHit]
    pages_scanned: int


def bounded_dpi(page: pymupdf.Page, dpi: int, clip: pymupdf.Rect | None = None) -> int:
    area = clip if clip is not None else page.rect
    pixels = (area.width * dpi / 72) * (area.height * dpi / 72)
    if pixels <= MAX_SCAN_PIXELS:
        return dpi
    return max(1, int(dpi * (MAX_SCAN_PIXELS / pixels) ** 0.5))


def read_page_codes(
    page: pymupdf.Page, dpi: int, clip: pymupdf.Rect | None = None
) -> list[CodeHit]:
    dpi = bounded_dpi(page, dpi, clip)
    pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, alpha=False, clip=clip)
    return decode_pixmap(page, pixmap, dpi, clip)


def _gray_array(pixmap: pymupdf.Pixmap) -> np.ndarray:
    return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.stride)[
        :, : pixmap.width
    ]


def _cell_sums(edges: np.ndarray, rows: int, columns: int) -> np.ndarray:
    return (
        edges[: rows * ROI_CELL, : columns * ROI_CELL]
        .reshape(rows, ROI_CELL, columns, ROI_CELL)
        .sum(axis=(1, 3))
    )


def _components(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    rows, columns = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    found: list[tuple[int, int, int, int, int]] = []
    for start_row, start_column in zip(*np.nonzero(mask), strict=True):
        if seen[start_row, start_column]:
            continue
        stack = [(int(start_row), int(start_column))]
        seen[start_row, start_column] = True
        top, left, bottom, right, size = rows, columns, 0, 0, 0
        while stack:
            row, column = stack.pop()
            size += 1
            top, bottom = min(top, row), max(bottom, row)
            left, right = min(left, column), max(right, column)
            for next_row, next_column in (
                (row - 1, column),
                (row + 1, column),
                (row, column - 1),
                (row, column + 1),
            ):
                if (
                    0 <= next_row < rows
                    and 0 <= next_column < columns
                    and mask[next_row, next_column]
                    and not seen[next_row, next_column]
                ):
                    seen[next_row, next_column] = True
                    stack.append((next_row, next_column))
        found.append((top, left, bottom, right, size))
    return found


def _bridged(mask: np.ndarray, axis: int) -> np.ndarray:
    joined = mask.copy()
    if axis == 1:
        joined[:, 1:-1] |= mask[:, :-2] & mask[:, 2:]
    else:
        joined[1:-1, :] |= mask[:-2, :] & mask[2:, :]
    return joined


def _looks_like_bars(edges: np.ndarray) -> bool:
    height = edges.shape[0]
    if height < 3:
        return False
    first = height // 5
    last = max(first + 1, height - height // 5)
    rows = np.linspace(first, last - 1, num=min(ROI_SAMPLE_ROWS, last - first)).astype(int)
    middle = edges[height // 2]
    columns = np.nonzero(middle[1:] & ~middle[:-1])[0] + 1
    if middle[0]:
        columns = np.concatenate(([0], columns))
    if len(columns) < ROI_MIN_BARS:
        return False
    widened = edges[rows].copy()
    widened[:, 1:] |= edges[rows][:, :-1]
    widened[:, :-1] |= edges[rows][:, 1:]
    return float(widened[:, columns].mean()) >= ROI_COHERENCE


def _row_band(
    along: np.ndarray, other: np.ndarray, row_mask: np.ndarray, row: int, left: int
) -> tuple[int, int] | None:
    columns = np.nonzero(row_mask)[0]
    if not len(columns):
        return None
    first, last = left + int(columns[0]), left + int(columns[-1])
    if last - first + 1 < ROI_MIN_SPAN:
        return None
    window = (
        slice(row * ROI_CELL, (row + 1) * ROI_CELL),
        slice(first * ROI_CELL, (last + 1) * ROI_CELL),
    )
    if int(along[window].sum()) < ROI_REGION_DOMINANCE * int(other[window].sum()):
        return None
    if not _looks_like_bars(along[window]):
        return None
    return first, last


def _bar_bands(
    along: np.ndarray, other: np.ndarray, mask: np.ndarray
) -> list[tuple[int, int, int, int, int]]:
    bands: list[tuple[int, int, int, int, int]] = []
    joined = _bridged(mask, 1)
    for top, left, bottom, right, _size in _components(joined):
        if right - left + 1 < ROI_MIN_SPAN:
            continue
        current: tuple[int, int, int, int, int] | None = None
        for row in range(top, bottom + 1):
            found = _row_band(along, other, joined[row, left : right + 1], row, left)
            if found is None:
                if current is not None:
                    bands.append(current)
                current = None
                continue
            first, last = found
            if current is not None and first <= current[3] and last >= current[1]:
                current = (
                    current[0],
                    min(current[1], first),
                    row,
                    max(current[3], last),
                    current[4] + last - first + 1,
                )
            else:
                if current is not None:
                    bands.append(current)
                current = (row, first, row, last, last - first + 1)
        if current is not None:
            bands.append(current)
    return bands


def barcode_regions(pixmap: pymupdf.Pixmap, dpi: int) -> list[pymupdf.Rect]:
    image = _gray_array(pixmap).astype(np.int16)
    if image.shape[0] < ROI_CELL * 2 or image.shape[1] < ROI_CELL * 2:
        return []
    across = np.abs(np.diff(image, axis=1))[:-1, :] > ROI_EDGE_LEVEL
    down = np.abs(np.diff(image, axis=0))[:, :-1] > ROI_EDGE_LEVEL
    rows = across.shape[0] // ROI_CELL
    columns = across.shape[1] // ROI_CELL
    across_sum = _cell_sums(across, rows, columns)
    down_sum = _cell_sums(down, rows, columns)
    floor = ROI_CELL * ROI_CELL * ROI_MIN_DENSITY
    scale = ROI_CELL * 72.0 / dpi
    regions: list[tuple[int, pymupdf.Rect]] = []
    for along, other, along_sum, other_sum, turned in (
        (across, down, across_sum, down_sum, False),
        (down.T, across.T, down_sum.T, across_sum.T, True),
    ):
        mask = (along_sum >= floor) & (along_sum >= ROI_DOMINANCE * other_sum)
        for top, left, bottom, right, size in _bar_bands(along, other, mask):
            if size < ROI_MIN_CELLS or bottom - top + 1 < ROI_MIN_ROWS:
                continue
            if turned:
                top, left, bottom, right = left, top, right, bottom
            rect = pymupdf.Rect(
                left * scale - ROI_PAD_PT,
                top * scale - ROI_PAD_PT,
                (right + 1) * scale + ROI_PAD_PT,
                (bottom + 1) * scale + ROI_PAD_PT,
            )
            regions.append((size, rect))
    regions.sort(key=lambda item: -item[0])
    return [rect for _size, rect in regions[:MAX_ROI_REGIONS]]


def _is_known(hit: CodeHit, known: list[CodeHit]) -> bool:
    box = pymupdf.Rect(hit.x0, hit.y0, hit.x1, hit.y1)
    return any(
        other.text == hit.text
        and other.format == hit.format
        and (box + (-2, -2, 2, 2)).intersects(pymupdf.Rect(other.x0, other.y0, other.x1, other.y1))
        for other in known
    )


def read_page_codes_with_regions(page: pymupdf.Page, dpi: int) -> list[CodeHit]:
    dpi = bounded_dpi(page, dpi)
    pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, alpha=False)
    hits = decode_pixmap(page, pixmap, dpi, None)
    if dpi >= ROI_DPI:
        return hits
    covered = [pymupdf.Rect(hit.x0, hit.y0, hit.x1, hit.y1) for hit in hits]
    for region in barcode_regions(pixmap, dpi):
        clip = region & page.rect
        if clip.is_empty or any(clip.contains(box) or box.contains(clip) for box in covered):
            continue
        for hit in read_page_codes(page, ROI_DPI, clip):
            if not _is_known(hit, hits):
                hits.append(hit)
                covered.append(pymupdf.Rect(hit.x0, hit.y0, hit.x1, hit.y1))
    return hits


def decode_pixmap(
    page: pymupdf.Page, pixmap: pymupdf.Pixmap, dpi: int, clip: pymupdf.Rect | None
) -> list[CodeHit]:
    if pixmap.width <= 0 or pixmap.height <= 0:
        return []
    image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
    scale = 72.0 / dpi
    offset_x = clip.x0 if clip is not None else 0.0
    offset_y = clip.y0 if clip is not None else 0.0
    hits: list[CodeHit] = []
    seen: set[tuple[str, str, int, int]] = set()
    for code in zxingcpp.read_barcodes(image):
        if not code.text:
            continue
        key = (
            code.format.name,
            code.text,
            round(code.position.top_left.x * scale / 4),
            round(code.position.top_left.y * scale / 4),
        )
        if key in seen:
            continue
        seen.add(key)
        corners = (
            code.position.top_left,
            code.position.top_right,
            code.position.bottom_right,
            code.position.bottom_left,
        )
        xs = [corner.x * scale + offset_x for corner in corners]
        ys = [corner.y * scale + offset_y for corner in corners]
        hits.append(
            CodeHit(
                page=page.number + 1,
                format=code.format.name,
                text=code.text,
                x0=round(min(xs), 2),
                y0=round(min(ys), 2),
                x1=round(max(xs), 2),
                y1=round(max(ys), 2),
            )
        )
    return hits


@op("codes.read", CodesReadParams)
def read_codes(params: CodesReadParams, progress: Progress) -> CodesReadResult:
    with open_document(params.path, params.password) as document:
        indices = list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count)))
        codes: list[CodeHit] = []
        for position, index in enumerate(indices):
            progress.check_cancelled()
            found = read_page_codes_with_regions(document[index], params.dpi)
            if params.thorough and params.dpi < FALLBACK_DPI:
                extra = [
                    hit
                    for hit in read_page_codes(document[index], FALLBACK_DPI)
                    if not _is_known(hit, found)
                ]
                found.extend(extra)
            codes.extend(found)
            if (position + 1) % 5 == 0:
                progress.report(
                    (position + 1) / len(indices),
                    "progress.scanningCodes",
                    {"current": position + 1, "total": len(indices)},
                )
        return CodesReadResult(codes=codes, pages_scanned=len(indices))


CodeFormat = Literal[
    "qr",
    "microQr",
    "dataMatrix",
    "aztec",
    "pdf417",
    "code128",
    "code39",
    "code93",
    "ean13",
    "ean8",
    "upca",
    "upce",
    "itf",
    "codabar",
]

CODE_FORMATS: dict[str, object] = {
    "qr": zxingcpp.BarcodeFormat.QRCode,
    "microQr": zxingcpp.BarcodeFormat.MicroQRCode,
    "dataMatrix": zxingcpp.BarcodeFormat.DataMatrix,
    "aztec": zxingcpp.BarcodeFormat.Aztec,
    "pdf417": zxingcpp.BarcodeFormat.PDF417,
    "code128": zxingcpp.BarcodeFormat.Code128,
    "code39": zxingcpp.BarcodeFormat.Code39,
    "code93": zxingcpp.BarcodeFormat.Code93,
    "ean13": zxingcpp.BarcodeFormat.EAN13,
    "ean8": zxingcpp.BarcodeFormat.EAN8,
    "upca": zxingcpp.BarcodeFormat.UPCA,
    "upce": zxingcpp.BarcodeFormat.UPCE,
    "itf": zxingcpp.BarcodeFormat.ITF,
    "codabar": zxingcpp.BarcodeFormat.Codabar,
}

SQUARE_FORMATS = {"qr", "microQr", "dataMatrix", "aztec"}
CAPTION_FONT = "vivepdf-code"
CAPTION_GAP = 2.0
CAPTION_EDGE = 4.0


class QrAddParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    pages: str | None = None
    text: str = ""
    values: list[str] | None = Field(default=None, max_length=MAX_VALUES)
    format: CodeFormat = "qr"
    size: float = Field(default=72, ge=24, le=400)
    height: float | None = Field(default=None, ge=12, le=400)
    position: Position = "bottom-right"
    margin: float = Field(default=18, ge=0, le=200)
    error_level: ErrorLevel = "M"
    color: str = "#000000"
    background: str | None = "#ffffff"
    caption: bool = False
    caption_size: float = Field(default=7, ge=4, le=24)


class QrAddResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    stamped: int
    verified: bool = True
    unused: int = 0
    missing_glyphs: str = ""


def parse_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("#")
    if len(text) != 6 or any(char not in "0123456789abcdefABCDEF" for char in text):
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"invalid colour '{value}'", {"reason": "badColour"}
        )
    return tuple(int(text[index : index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]


def code_png(
    text: str, code_format: str, error_level: ErrorLevel, color: str, background: str | None
) -> bytes:
    symbology = CODE_FORMATS[code_format]
    options: dict[str, object] = {}
    if code_format in {"qr", "microQr"}:
        options["ec_level"] = error_level
    try:
        barcode = zxingcpp.create_barcode(text, symbology, **options)
    except Exception as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot encode as {code_format}: {error}",
            {"format": code_format, "reason": "cannotEncode"},
        ) from error
    raw = zxingcpp.write_barcode_to_image(barcode, scale=QR_SCALE, add_quiet_zones=True)
    mask = np.array(np.array(raw, copy=False), dtype=np.uint8)
    if mask.ndim == 3:
        mask = mask[:, :, 0]
    ink = parse_rgb(color)
    paper = parse_rgb(background) if background else (255, 255, 255)
    height, width = mask.shape
    canvas = np.empty((height, width, 4), dtype=np.uint8)
    dark = mask < 128
    for channel in range(3):
        canvas[:, :, channel] = np.where(dark, ink[channel], paper[channel])
    canvas[:, :, 3] = 255 if background else np.where(dark, 255, 0)
    buffer = io.BytesIO()
    Image.fromarray(canvas, mode="RGBA").save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def anchor_rect(
    page_rect: pymupdf.Rect, size: float, position: Position, margin: float, height: float = 0.0
) -> pymupdf.Rect:
    tall = height or size
    row, column = grid_cell(position)
    if column == "left":
        x0 = margin
    elif column == "right":
        x0 = page_rect.width - margin - size
    else:
        x0 = (page_rect.width - size) / 2
    if row == "top":
        y0 = margin
    elif row == "bottom":
        y0 = page_rect.height - margin - tall
    else:
        y0 = (page_rect.height - tall) / 2
    x0 = max(0.0, min(x0, page_rect.width - size))
    y0 = max(0.0, min(y0, page_rect.height - tall))
    return pymupdf.Rect(x0, y0, x0 + size, y0 + tall)


def page_payloads(params: QrAddParams, indices: list[int], stem: str) -> list[tuple[int, str]]:
    templates = [value.strip() for value in params.values] if params.values is not None else None
    if templates is None and not params.text.strip():
        raise OpError(ErrorCode.INVALID_PARAMS, "text is empty", {"reason": "emptyText"})
    if templates is not None and not any(templates):
        raise OpError(ErrorCode.INVALID_PARAMS, "no values given", {"reason": "emptyValues"})
    total = len(indices)
    payloads: list[tuple[int, str]] = []
    for position, index in enumerate(indices):
        if templates is None:
            template = params.text.strip()
        elif position < len(templates):
            template = templates[position]
        else:
            break
        if not template:
            continue
        content = (
            template.replace("{n}", str(position + 1))
            .replace("{page}", str(index + 1))
            .replace("{total}", str(total))
            .replace("{file}", stem)
        )
        payloads.append((index, content))
    return payloads


def unused_values(params: QrAddParams, page_count: int) -> int:
    if params.values is None:
        return 0
    return sum(1 for value in params.values[page_count:] if value.strip())


def caption_layout(
    font: pymupdf.Font,
    text: str,
    size: float,
    code_rect: pymupdf.Rect,
    page_rect: pymupdf.Rect,
) -> tuple[str, float, float]:
    room = max(code_rect.width, page_rect.width - 2 * CAPTION_EDGE)
    text, size = fit_line(font, text, size, room)
    width = font.text_length(text, fontsize=size)
    x = (code_rect.x0 + code_rect.x1 - width) / 2
    x = max(CAPTION_EDGE, min(x, page_rect.width - CAPTION_EDGE - width))
    return text, size, x


def code_readable(page: pymupdf.Page, rect: pymupdf.Rect, code_format: str) -> bool:
    clip = (rect + (-VERIFY_PAD, -VERIFY_PAD, VERIFY_PAD, VERIFY_PAD)) & page.rect
    wanted = CODE_FORMATS[code_format].name  # type: ignore[attr-defined]
    return any(hit.format == wanted for hit in read_page_codes(page, VERIFY_DPI, clip))


@op("codes.add_qr", QrAddParams)
def add_qr(params: QrAddParams, progress: Progress) -> QrAddResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    if params.format == "microQr" and params.error_level == "H":
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "Micro QR has no error level H",
            {"reason": "errorLevelUnsupported"},
        )
    stem = Path(params.path).stem
    color = [channel / 255 for channel in parse_rgb(params.color)]
    caption_font = pymupdf.Font(fontfile=str(WATERMARK_FONT)) if params.caption else None
    with open_document(params.path, params.password) as document:
        indices = list(dict.fromkeys(parse_page_ranges(params.pages, document.page_count)))
        payloads = page_payloads(params, indices, stem)
        total = len(payloads)
        cache: dict[str, bytes] = {}
        probe: tuple[int, pymupdf.Page, pymupdf.Rect] | None = None
        square = params.format in SQUARE_FORMATS
        for position, (index, content) in enumerate(payloads):
            progress.check_cancelled()
            page = document[index]
            if content not in cache:
                cache[content] = code_png(
                    content, params.format, params.error_level, params.color, params.background
                )
            tall = params.size if square else (params.height or params.size / 2)
            caption_room = params.caption_size + CAPTION_GAP if params.caption else 0.0
            rect = anchor_rect(
                page.rect, params.size, params.position, params.margin, tall + caption_room
            )
            code_rect = pymupdf.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + tall)
            page.insert_image(
                code_rect * insertion_matrix(page),
                stream=cache[content],
                rotate=page.rotation,
                keep_proportion=square,
            )
            if probe is None or len(content) > probe[0]:
                probe = (len(content), page, code_rect)
            if caption_font is not None:
                caption, caption_size, caption_x = caption_layout(
                    caption_font, content, params.caption_size, code_rect, page.rect
                )
                baseline = pymupdf.Point(caption_x, rect.y0 + tall + caption_size)
                page.insert_text(
                    baseline * page.derotation_matrix,
                    caption,
                    fontsize=caption_size,
                    fontname=CAPTION_FONT,
                    fontfile=str(WATERMARK_FONT),
                    color=color,
                    rotate=page.rotation,
                )
            if (position + 1) % 10 == 0:
                progress.report(
                    (position + 1) / total,
                    "progress.stamping",
                    {"current": position + 1, "total": total},
                )
        verified = probe is not None and code_readable(probe[1], probe[2], params.format)
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
        return QrAddResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            stamped=total,
            verified=verified,
            unused=unused_values(params, len(indices)),
            missing_glyphs=(
                uncovered_glyphs(WATERMARK_FONT, "".join(content for _, content in payloads))[
                    :MAX_REPORTED_GLYPHS
                ]
                if caption_font is not None
                else ""
            ),
        )


class CodesExportParams(RpcModel):
    codes: list[CodeHit]
    output: str
    overwrite: bool = False


class CodesExportResult(RpcModel):
    output: str
    count: int


@op("codes.export_csv", CodesExportParams)
def export_csv(params: CodesExportParams, _progress: Progress) -> CodesExportResult:
    target = prepare_data_output(params.output, "csv", params.overwrite)
    with target.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(["page", "format", "text", "x0", "y0", "x1", "y1"])
        for code in params.codes:
            writer.writerow(
                [code.page, code.format, inert_cell(code.text), code.x0, code.y0, code.x1, code.y1]
            )
    return CodesExportResult(output=str(target), count=len(params.codes))
