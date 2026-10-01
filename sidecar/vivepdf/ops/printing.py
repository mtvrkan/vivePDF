import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pymupdf
from PIL import Image
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._ranges import parse_page_ranges
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

MAX_RENDER_DPI = 300
POINTS_PER_INCH = 72.0
HORZRES = 8
VERTRES = 10
LOGPIXELSX = 88
LOGPIXELSY = 90

ScaleMode = Literal["fit", "actual"]
PageSubset = Literal["all", "odd", "even"]
PagesPerSheet = Literal[1, 2, 4, 6, 9]

SHEET_GRIDS: dict[int, tuple[int, int]] = {1: (1, 1), 2: (1, 2), 4: (2, 2), 6: (2, 3), 9: (3, 3)}
CELL_GAP_FRACTION = 0.02


class PrinterInfo(RpcModel):
    name: str
    is_default: bool = False


class PrintersParams(RpcModel):
    pass


class PrintersResult(RpcModel):
    printers: list[PrinterInfo]
    default: str | None = None
    backend: Literal["windows", "cups", "none"]


class PrintParams(RpcModel):
    path: str
    password: str | None = None
    printer: str | None = None
    pages: str | None = None
    copies: int = Field(default=1, ge=1, le=99)
    scale: ScaleMode = "fit"
    grayscale: bool = False
    subset: PageSubset = "all"
    reverse: bool = False
    annotations: bool = True
    auto_rotate: bool = True
    pages_per_sheet: PagesPerSheet = 1


class PrintResult(RpcModel):
    printer: str
    pages: int
    copies: int
    sheets: int = 0


@dataclass(frozen=True)
class PagePlacement:
    rotate: bool
    factor: float
    x: int
    y: int
    width: int
    height: int


def plan_placement(
    page_width_pt: float,
    page_height_pt: float,
    area_width: int,
    area_height: int,
    dpi_x: float,
    dpi_y: float,
    scale: ScaleMode,
    auto_rotate: bool = True,
) -> PagePlacement:
    rotate = auto_rotate and (page_width_pt > page_height_pt) != (area_width > area_height)
    width_pt, height_pt = (
        (page_height_pt, page_width_pt) if rotate else (page_width_pt, page_height_pt)
    )
    natural_width = width_pt / POINTS_PER_INCH * dpi_x
    natural_height = height_pt / POINTS_PER_INCH * dpi_y
    fit = min(area_width / natural_width, area_height / natural_height)
    factor = fit if scale == "fit" else min(1.0, fit)
    width = max(1, round(natural_width * factor))
    height = max(1, round(natural_height * factor))
    return PagePlacement(
        rotate=rotate,
        factor=factor,
        x=(area_width - width) // 2,
        y=(area_height - height) // 2,
        width=width,
        height=height,
    )


def print_sheets(
    indices: list[int], subset: PageSubset, reverse: bool, per_sheet: int
) -> list[list[int]]:
    chosen = [
        index for index in indices if subset == "all" or (index % 2 == 0) == (subset == "odd")
    ]
    sheets = [chosen[start : start + per_sheet] for start in range(0, len(chosen), per_sheet)]
    return sheets[::-1] if reverse else sheets


def sheet_cells(
    area_width: int, area_height: int, per_sheet: int
) -> list[tuple[int, int, int, int]]:
    columns, rows = SHEET_GRIDS[per_sheet]
    if area_width > area_height:
        columns, rows = rows, columns
    cell_width = area_width // columns
    cell_height = area_height // rows
    return [
        (column * cell_width, row * cell_height, cell_width, cell_height)
        for row in range(rows)
        for column in range(columns)
    ]


def strip_markup(document: pymupdf.Document, indices: list[int]) -> int:
    removed = 0
    for index in sorted(set(indices)):
        page = document[index]
        for xref in [annot.xref for annot in page.annots()]:
            annot = page.load_annot(xref)
            if annot is None:
                continue
            page.delete_annot(annot)
            removed += 1
    return removed


def cups_arguments(
    params: PrintParams, indices: list[int], printer: str | None, source: Path | None = None
) -> list[str]:
    args = ["lp", "-n", str(params.copies)]
    if printer:
        args += ["-d", printer]
    if params.pages:
        args += ["-o", "page-ranges=" + ",".join(str(index + 1) for index in indices)]
    if params.scale == "fit":
        args += ["-o", "fit-to-page"]
    if params.grayscale:
        args += ["-o", "ColorModel=Gray"]
    if params.subset != "all":
        args += ["-o", f"page-set={params.subset}"]
    if params.reverse:
        args += ["-o", "outputorder=reverse"]
    if params.pages_per_sheet > 1:
        args += ["-o", f"number-up={params.pages_per_sheet}"]
    if not params.auto_rotate:
        args += ["-o", "nopdfAutoRotate"]
    args.append(str((source or Path(params.path)).resolve()))
    return args


def _windows() -> bool:
    return sys.platform == "win32"


def _windows_printers() -> PrintersResult:
    import win32print

    try:
        default = win32print.GetDefaultPrinter()
    except Exception:
        default = None
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    names = sorted({entry[2] for entry in win32print.EnumPrinters(flags)})
    printers = [PrinterInfo(name=name, is_default=name == default) for name in names]
    return PrintersResult(printers=printers, default=default, backend="windows")


def _cups_printers() -> PrintersResult:
    if not shutil.which("lpstat"):
        return PrintersResult(printers=[], default=None, backend="none")
    listing = subprocess.run(["lpstat", "-a"], capture_output=True, text=True, check=False)
    names = [line.split()[0] for line in listing.stdout.splitlines() if line.strip()]
    default_run = subprocess.run(["lpstat", "-d"], capture_output=True, text=True, check=False)
    default = default_run.stdout.split(":")[-1].strip() if ":" in default_run.stdout else None
    printers = [PrinterInfo(name=name, is_default=name == default) for name in names]
    return PrintersResult(printers=printers, default=default or None, backend="cups")


@op("print.printers", PrintersParams)
def printers(_params: PrintersParams, _progress: Progress) -> PrintersResult:
    return _windows_printers() if _windows() else _cups_printers()


def _render(
    page: pymupdf.Page, placement: PagePlacement, dpi: float, grayscale: bool
) -> Image.Image:
    render_dpi = min(dpi, MAX_RENDER_DPI)
    zoom = placement.factor * render_dpi / POINTS_PER_INCH
    matrix = pymupdf.Matrix(zoom, zoom)
    if placement.rotate:
        matrix = matrix.prerotate(90)
    colorspace = pymupdf.csGRAY if grayscale else pymupdf.csRGB
    pixmap = page.get_pixmap(matrix=matrix, colorspace=colorspace, alpha=False)
    mode = "L" if grayscale else "RGB"
    return Image.frombytes(mode, (pixmap.width, pixmap.height), pixmap.samples)


def compose_sheet(
    document: pymupdf.Document,
    group: list[int],
    area_width: int,
    area_height: int,
    dpi_x: float,
    dpi_y: float,
    params: PrintParams,
) -> tuple[Image.Image, tuple[int, int, int, int]]:
    if params.pages_per_sheet == 1:
        page = document[group[0]]
        placement = plan_placement(
            page.rect.width,
            page.rect.height,
            area_width,
            area_height,
            dpi_x,
            dpi_y,
            params.scale,
            params.auto_rotate,
        )
        image = _render(page, placement, dpi_x, params.grayscale)
        box = (
            placement.x,
            placement.y,
            placement.x + placement.width,
            placement.y + placement.height,
        )
        return image, box
    shrink = min(dpi_x, MAX_RENDER_DPI) / dpi_x
    mode = "L" if params.grayscale else "RGB"
    size = (max(1, round(area_width * shrink)), max(1, round(area_height * shrink)))
    sheet = Image.new(mode, size, "white")
    cells = sheet_cells(area_width, area_height, params.pages_per_sheet)
    for index, (x, y, width, height) in zip(group, cells, strict=False):
        gap = round(min(width, height) * CELL_GAP_FRACTION)
        page = document[index]
        placement = plan_placement(
            page.rect.width,
            page.rect.height,
            max(1, width - 2 * gap),
            max(1, height - 2 * gap),
            dpi_x,
            dpi_y,
            "fit",
            params.auto_rotate,
        )
        image = _render(page, placement, dpi_x, params.grayscale)
        sheet.paste(
            image,
            (round((x + gap + placement.x) * shrink), round((y + gap + placement.y) * shrink)),
        )
    return sheet, (0, 0, area_width, area_height)


def _print_windows(
    params: PrintParams, document: pymupdf.Document, sheets: list[list[int]], progress: Progress
) -> str:
    import win32print
    import win32ui
    from PIL import ImageWin

    printer = params.printer or win32print.GetDefaultPrinter()
    dc = win32ui.CreateDC()
    try:
        dc.CreatePrinterDC(printer)
    except Exception as caught:
        raise OpError(
            ErrorCode.INVALID_PARAMS, f"printer unavailable: {printer}", {"reason": "printer"}
        ) from caught
    dpi_x = float(dc.GetDeviceCaps(LOGPIXELSX) or 300)
    dpi_y = float(dc.GetDeviceCaps(LOGPIXELSY) or dpi_x)
    area_width = int(dc.GetDeviceCaps(HORZRES))
    area_height = int(dc.GetDeviceCaps(VERTRES))
    total = len(sheets) * params.copies
    done = 0
    dc.StartDoc(Path(params.path).name)
    try:
        for _copy in range(params.copies):
            for group in sheets:
                progress.check_cancelled()
                image, box = compose_sheet(
                    document, group, area_width, area_height, dpi_x, dpi_y, params
                )
                dc.StartPage()
                ImageWin.Dib(image).draw(dc.GetHandleOutput(), box)
                dc.EndPage()
                done += 1
                progress.report(
                    done / total, "progress.printing", {"current": done, "total": total}
                )
        dc.EndDoc()
    except BaseException:
        dc.AbortDoc()
        raise
    finally:
        dc.DeleteDC()
    return printer


def _print_cups(
    params: PrintParams, document: pymupdf.Document, indices: list[int], progress: Progress
) -> str:
    if not shutil.which("lp"):
        raise OpError(
            ErrorCode.INVALID_PARAMS, "no print system available", {"reason": "noPrinter"}
        )
    progress.report(0.1, "progress.printing", {"current": 0, "total": len(indices)})
    with tempfile.TemporaryDirectory() as scratch:
        source = None
        if not params.annotations:
            source = Path(scratch) / "print.pdf"
            document.save(source, encryption=pymupdf.PDF_ENCRYPT_NONE)
        result = subprocess.run(
            cups_arguments(params, indices, params.printer, source),
            capture_output=True,
            text=True,
            check=False,
        )
    if result.returncode != 0:
        raise OpError(
            ErrorCode.INTERNAL, result.stderr.strip() or "lp failed", {"reason": "printer"}
        )
    return params.printer or "default"


def _validate_printer(name: str | None) -> None:
    if name is None:
        return
    listing = _windows_printers() if _windows() else _cups_printers()
    known = {entry.name for entry in listing.printers}
    if name not in known:
        raise OpError(ErrorCode.INVALID_PARAMS, f"unknown printer: {name}", {"reason": "printer"})


@op("print.run", PrintParams)
def run(params: PrintParams, progress: Progress) -> PrintResult:
    _validate_printer(params.printer)
    with open_document(params.path, params.password) as document:
        indices = parse_page_ranges(params.pages, document.page_count)
        sheets = print_sheets(indices, params.subset, params.reverse, params.pages_per_sheet)
        if not sheets:
            raise OpError(ErrorCode.INVALID_PARAMS, "no pages selected", {"reason": "empty"})
        if not params.annotations:
            strip_markup(document, indices)
        if _windows():
            printer = _print_windows(params, document, sheets, progress)
        else:
            printer = _print_cups(params, document, indices, progress)
    pages = sum(len(group) for group in sheets)
    return PrintResult(printer=printer, pages=pages, copies=params.copies, sheets=len(sheets))
