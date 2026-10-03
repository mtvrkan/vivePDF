import html
import re
import shutil
import tempfile
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._form_rows import Delimiter, load_rows, unknown_placeholders
from vivepdf.ops._naming import render_name, unique_name
from vivepdf.ops._output import prepare_output, save_document
from vivepdf.ops.create import COLOUR, DEFAULT_ACCENT, FAMILIES, LOGO_EXTENSIONS, FontChoice
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

BulkKind = Literal["certificate", "invitation", "badge"]
MAX_ROWS = 5000
MAX_SIGNERS = 3
POINTS_PER_MM = 72 / 25.4
PLACEHOLDER = re.compile(r"(?<!\{)\{([^{}]+)\}")
CERTIFICATE_SIZE = pymupdf.paper_rect("a4-l")
INVITATION_SIZE = pymupdf.paper_rect("a5")
BADGE_SHEET = pymupdf.paper_rect("a4")
BADGE_WIDTH = 85 * POINTS_PER_MM
BADGE_HEIGHT = 54 * POINTS_PER_MM
BADGE_COLUMNS = 2
BADGE_ROWS = 5
BADGE_GAP = 4 * POINTS_PER_MM
CUT_LINE = (0.75, 0.75, 0.75)


class Signer(RpcModel):
    name: str = Field(default="", max_length=120)
    role: str = Field(default="", max_length=120)


class BulkParams(RpcModel):
    data_path: str
    sheet: str | None = None
    delimiter: Delimiter = "auto"
    kind: BulkKind = "certificate"
    heading: str = Field(default="", max_length=200)
    recipient: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=2000)
    details: str = Field(default="", max_length=500)
    signers: list[Signer] = Field(default_factory=list, max_length=MAX_SIGNERS)
    font: FontChoice = "serif"
    accent: str = DEFAULT_ACCENT
    logo: str | None = None
    split: bool = False
    output: str | None = None
    output_dir: str | None = None
    pattern: str = Field(default="{n}", max_length=120)
    overwrite: bool = False


class BulkResult(RpcModel):
    outputs: list[str]
    count: int
    page_count: int
    bytes: int


def fill_placeholders(text: str, values: dict[str, str]) -> str:
    return PLACEHOLDER.sub(lambda match: values.get(match[1], match[0]), text)


def _texts(params: BulkParams) -> list[str]:
    signers = [part for signer in params.signers for part in (signer.name, signer.role)]
    return [params.heading, params.recipient, params.body, params.details, *signers]


def _lines(text: str) -> str:
    return "<br/>".join(html.escape(line) for line in text.strip().splitlines())


def _paragraph(css_class: str, text: str) -> str:
    return f'<p class="{css_class}">{_lines(text)}</p>' if text.strip() else ""


def _logo_name(params: BulkParams, workdir: Path) -> str | None:
    if not params.logo:
        return None
    source = Path(params.logo)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND,
            f"file not found: {source.name}",
            {"path": params.logo, "which": "logo"},
        )
    extension = source.suffix.lower().lstrip(".")
    if extension not in LOGO_EXTENSIONS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported logo type: .{extension}",
            {"reason": "unsupportedType", "extension": extension, "which": "logo"},
        )
    name = f"logo.{extension}"
    shutil.copyfile(source, workdir / name)
    return name


def _css(params: BulkParams) -> str:
    accent = params.accent if COLOUR.match(params.accent) else DEFAULT_ACCENT
    family = FAMILIES[params.font]
    rules = [
        f"*{{font-family:{family};color:#1a1a1a;}}",
        "p{margin:0;text-align:center;}",
        ".logo{max-height:46pt;max-width:150pt;}",
        f".heading{{color:{accent};font-weight:bold;letter-spacing:2pt;}}",
        ".recipient{font-weight:bold;}",
        ".details{color:#444444;}",
        "table{width:100%;border-collapse:collapse;}",
        "td{text-align:center;padding:0 28pt;vertical-align:top;}",
        ".sign{border-top:0.7pt solid #333333;padding-top:3pt;}",
        ".role{color:#555555;font-size:9pt;}",
    ]
    return "".join(rules)


def _logo_html(logo: str | None) -> str:
    return f'<p><img class="logo" src="{logo}"/></p>' if logo else ""


def _text(text: str, size: float, css_class: str = "", extra: str = "") -> str:
    if not text.strip():
        return ""
    style = f"font-size:{size}pt;{extra}"
    return f'<p class="{css_class}" style="{style}">{_lines(text)}</p>'


def _gap(size: float) -> str:
    return f'<p style="font-size:{size}pt">&#160;</p>'


def _signers_html(params: BulkParams, values: dict[str, str]) -> str:
    cells = []
    named = [signer for signer in params.signers if signer.name.strip() or signer.role.strip()]
    width = 100 // max(1, len(named))
    for signer in named:
        name = fill_placeholders(signer.name, values)
        role = fill_placeholders(signer.role, values)
        if not name.strip() and not role.strip():
            continue
        name_html = f'<p class="sign">{html.escape(name)}</p>'
        role_html = f'<p class="role">{html.escape(role)}</p>'
        cells.append(f'<td style="width:{width}%">{name_html}{role_html}</td>')
    return f"<table><tr>{''.join(cells)}</tr></table>" if cells else ""


def _draw_certificate(
    page: pymupdf.Page,
    params: BulkParams,
    values: dict[str, str],
    logo: str | None,
    archive: pymupdf.Archive,
    accent: tuple[float, float, float],
) -> None:
    outer = page.rect + (22, 22, -22, -22)
    page.draw_rect(outer, color=accent, width=3)
    page.draw_rect(outer + (7, 7, -7, -7), color=accent, width=0.8)
    inner = outer + (40, 34, -40, -34)
    body = (
        _logo_html(logo)
        + _text(fill_placeholders(params.heading, values), 30, "heading")
        + _gap(10)
        + _text(fill_placeholders(params.recipient, values), 28, "recipient")
        + _gap(10)
        + _text(fill_placeholders(params.body, values), 13)
        + _gap(10)
        + _paragraph("details", fill_placeholders(params.details, values))
    )
    signers = _signers_html(params, values)
    signer_height = 60 if signers else 0
    _insert_centered(page, inner + (0, 0, 0, -signer_height), body, _css(params), archive)
    if signers:
        page.insert_htmlbox(
            pymupdf.Rect(inner.x0, inner.y1 - signer_height + 14, inner.x1, inner.y1),
            signers,
            css=_css(params) + "p{font-size:11pt;}",
        )


def _draw_invitation(
    page: pymupdf.Page,
    params: BulkParams,
    values: dict[str, str],
    logo: str | None,
    archive: pymupdf.Archive,
    accent: tuple[float, float, float],
) -> None:
    band = pymupdf.Rect(0, 0, page.rect.width, 18)
    page.draw_rect(band, color=None, fill=accent)
    page.draw_rect(
        pymupdf.Rect(0, page.rect.height - 8, page.rect.width, page.rect.height),
        color=None,
        fill=accent,
    )
    inner = page.rect + (36, 52, -36, -40)
    content = (
        _logo_html(logo)
        + _text(fill_placeholders(params.heading, values), 22, "heading")
        + _gap(12)
        + _text(fill_placeholders(params.recipient, values), 15, "recipient")
        + _gap(8)
        + _text(fill_placeholders(params.body, values), 11.5, extra="line-height:1.5")
        + _gap(12)
        + _text(fill_placeholders(params.details, values), 11, "details", "font-weight:bold")
    )
    signers = _signers_html(params, values)
    _insert_centered(page, inner + (0, 0, 0, -50 if signers else 0), content, _css(params), archive)
    if signers:
        page.insert_htmlbox(
            pymupdf.Rect(inner.x0, inner.y1 - 46, inner.x1, inner.y1),
            signers,
            css=_css(params) + "p{font-size:10pt;}",
        )


def _badge_slots() -> list[pymupdf.Rect]:
    width = BADGE_COLUMNS * BADGE_WIDTH + (BADGE_COLUMNS - 1) * BADGE_GAP
    height = BADGE_ROWS * BADGE_HEIGHT + (BADGE_ROWS - 1) * BADGE_GAP
    left = (BADGE_SHEET.width - width) / 2
    top = (BADGE_SHEET.height - height) / 2
    return [
        pymupdf.Rect(
            left + column * (BADGE_WIDTH + BADGE_GAP),
            top + row * (BADGE_HEIGHT + BADGE_GAP),
            left + column * (BADGE_WIDTH + BADGE_GAP) + BADGE_WIDTH,
            top + row * (BADGE_HEIGHT + BADGE_GAP) + BADGE_HEIGHT,
        )
        for row in range(BADGE_ROWS)
        for column in range(BADGE_COLUMNS)
    ]


def _draw_badge(
    page: pymupdf.Page,
    slot: pymupdf.Rect,
    params: BulkParams,
    values: dict[str, str],
    logo: str | None,
    archive: pymupdf.Archive,
    accent: tuple[float, float, float],
) -> None:
    page.draw_rect(slot, color=CUT_LINE, width=0.5, dashes="[2 2] 0")
    band = pymupdf.Rect(slot.x0, slot.y0, slot.x1, slot.y0 + 30)
    page.draw_rect(band, color=None, fill=accent)
    heading = fill_placeholders(params.heading, values)
    logo_html = f'<img src="{logo}" style="height:20pt"/> ' if logo else ""
    band_style = "color:#ffffff;font-weight:bold;font-size:10pt"
    band_html = f'<p style="{band_style}">{logo_html}{html.escape(heading)}</p>'
    page.insert_htmlbox(band + (8, 5, -8, -4), band_html, css=_css(params), archive=archive)
    content = (
        _text(fill_placeholders(params.recipient, values), 17, "recipient")
        + _text(fill_placeholders(params.body, values), 10)
        + _paragraph("details", fill_placeholders(params.details, values))
    )
    area = pymupdf.Rect(slot.x0 + 8, band.y1 + 4, slot.x1 - 8, slot.y1 - 6)
    _insert_centered(page, area, content, _css(params) + ".details{font-size:9pt;}", archive)


def _insert_centered(
    page: pymupdf.Page, rect: pymupdf.Rect, content: str, css: str, archive: pymupdf.Archive
) -> None:
    story = pymupdf.Story(html=content, user_css=css, archive=archive)
    more, filled = story.place(rect)
    if more:
        page.insert_htmlbox(rect, content, css=css, archive=archive)
        return
    offset = max(0.0, (rect.height - (pymupdf.Rect(filled).y1 - rect.y0)) / 2)
    page.insert_htmlbox(
        pymupdf.Rect(rect.x0, rect.y0 + offset, rect.x1, rect.y1), content, css=css, archive=archive
    )


def _row_values(row: dict[str, str], index: int, total: int) -> dict[str, str]:
    return {**row, "n": str(index + 1), "total": str(total)}


def _accent_rgb(params: BulkParams) -> tuple[float, float, float]:
    colour = params.accent if COLOUR.match(params.accent) else DEFAULT_ACCENT
    return tuple(int(colour[position : position + 2], 16) / 255 for position in (1, 3, 5))


def _render(
    document: pymupdf.Document,
    params: BulkParams,
    rows: list[dict[str, str]],
    first: int,
    total: int,
    logo: str | None,
    archive: pymupdf.Archive,
    progress: Progress,
) -> None:
    accent = _accent_rgb(params)
    if params.kind == "badge":
        slots = _badge_slots()
        page: pymupdf.Page | None = None
        for offset, row in enumerate(rows):
            progress.check_cancelled()
            slot_index = offset % len(slots)
            if slot_index == 0:
                page = document.new_page(width=BADGE_SHEET.width, height=BADGE_SHEET.height)
            assert page is not None
            _draw_badge(
                page,
                slots[slot_index],
                params,
                _row_values(row, first + offset, total),
                logo,
                archive,
                accent,
            )
            progress.report(
                (first + offset + 1) / total,
                "progress.creating",
                {"current": first + offset + 1, "total": total},
            )
        return
    size = CERTIFICATE_SIZE if params.kind == "certificate" else INVITATION_SIZE
    draw = _draw_certificate if params.kind == "certificate" else _draw_invitation
    for offset, row in enumerate(rows):
        progress.check_cancelled()
        page = document.new_page(width=size.width, height=size.height)
        draw(page, params, _row_values(row, first + offset, total), logo, archive, accent)
        progress.report(
            (first + offset + 1) / total,
            "progress.creating",
            {"current": first + offset + 1, "total": total},
        )


@op("create.bulk", BulkParams)
def create_bulk(params: BulkParams, progress: Progress) -> BulkResult:
    columns, rows, _sheets = load_rows(params.data_path, params.sheet, params.delimiter)
    if not rows:
        raise OpError(ErrorCode.INVALID_PARAMS, "the data file has no rows", {"reason": "noRows"})
    if len(rows) > MAX_ROWS:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "too many rows", {"reason": "tooManyRows", "limit": MAX_ROWS}
        )
    unknown = [name for text in _texts(params) for name in unknown_placeholders(text, columns)]
    if params.split:
        unknown += unknown_placeholders(params.pattern, columns)
    if unknown:
        names = list(dict.fromkeys(unknown))
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unknown placeholders: {', '.join(names)}",
            {"reason": "unknownFields", "names": ", ".join(names), "columns": columns},
        )
    separate = params.split and params.kind != "badge"
    if separate and not params.output_dir:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "an output folder is required", {"reason": "noOutputDir"}
        )
    if not separate and not params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "an output file is required", {"reason": "noOutput"}
        )
    total = len(rows)
    outputs: list[str] = []
    pages = 0
    size = 0
    with tempfile.TemporaryDirectory(
        prefix="vivepdf-bulk-", ignore_cleanup_errors=True
    ) as temp_dir:
        workdir = Path(temp_dir)
        logo = _logo_name(params, workdir)
        archive = pymupdf.Archive(str(workdir))
        if not separate:
            target = prepare_output(params.output or "", [params.data_path], params.overwrite)
            with pymupdf.open() as document:
                _render(document, params, rows, 0, total, logo, archive, progress)
                pages = document.page_count
                save_document(document, target)
            return BulkResult(
                outputs=[str(target)], count=total, page_count=pages, bytes=target.stat().st_size
            )
        folder = Path(params.output_dir or "")
        folder.mkdir(parents=True, exist_ok=True)
        taken: set[str] = set()
        targets = []
        for index, row in enumerate(rows):
            name = unique_name(render_name(params.pattern, _row_values(row, index, total)), taken)
            targets.append(folder / f"{name}.pdf")
        if not params.overwrite:
            existing = next((target for target in targets if target.exists()), None)
            if existing is not None:
                raise OpError(
                    ErrorCode.INVALID_PARAMS,
                    f"output already exists: {existing.name}",
                    {"exists": True, "path": str(existing)},
                )
        for index, (row, target) in enumerate(zip(rows, targets, strict=True)):
            with pymupdf.open() as document:
                _render(document, params, [row], index, total, logo, archive, progress)
                pages += document.page_count
                save_document(document, prepare_output(str(target), [params.data_path], True))
            outputs.append(str(target))
            size += target.stat().st_size
    return BulkResult(outputs=outputs, count=total, page_count=pages, bytes=size)
