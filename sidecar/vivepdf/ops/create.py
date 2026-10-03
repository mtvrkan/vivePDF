import contextlib
import html
import re
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document_structure import plain_text_html
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._story import decode_text, markdown_to_html, story_pdf_bytes
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

Template = Literal[
    "report", "letter", "petition", "assignment", "minutes", "lectureNotes", "booklet"
]
FontChoice = Literal["sans", "serif", "mono"]
SourceFormat = Literal["auto", "plain", "markdown"]

MARKDOWN_EXTENSIONS = {"md", "markdown"}
TEXT_EXTENSIONS = {"txt", "text", "md", "markdown"}
LOGO_EXTENSIONS = {"png", "jpg", "jpeg"}
MAX_SOURCE_BYTES = 20 * 1024 * 1024
MARKDOWN_HINT = re.compile(r"^(#{1,6} |```|\|.+\|$|\* |> )", re.MULTILINE)
COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
POINTS_PER_MM = 72 / 25.4
FURNITURE_FONT_PT = 8.5
FURNITURE_HEIGHT = 18.0
SIGNERS_PER_ROW = 3
FAMILIES: dict[FontChoice, str] = {"sans": "sans-serif", "serif": "serif", "mono": "monospace"}
FORMAL_TEMPLATES = {"letter", "petition", "minutes"}
DEFAULT_ACCENT = "#1f4e79"


class CreateDocumentParams(RpcModel):
    path: str | None = None
    text: str | None = Field(default=None, max_length=MAX_SOURCE_BYTES)
    format: SourceFormat = "auto"
    template: Template = "report"
    title: str = Field(default="", max_length=200)
    author: str = Field(default="", max_length=300)
    date: str = Field(default="", max_length=80)
    font: FontChoice = "sans"
    font_size: float = Field(default=11, ge=8, le=18)
    margin_mm: float = Field(default=20, ge=10, le=45)
    accent: str = DEFAULT_ACCENT
    logo: str | None = None
    header: str = Field(default="", max_length=200)
    footer: str = Field(default="", max_length=200)
    page_numbers: bool = True
    page_number_format: str = Field(default="{page} / {total}", max_length=60)
    paper: Literal["a4", "letter", "a5"] = "a4"
    output: str
    overwrite: bool = False


def read_text_file(path: str, source_format: SourceFormat = "auto") -> tuple[str, bool]:
    source = Path(path)
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": path})
    extension = source.suffix.lower().lstrip(".")
    if extension not in TEXT_EXTENSIONS:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported file type: .{extension}",
            {"reason": "unsupportedType", "extension": extension},
        )
    if source.stat().st_size > MAX_SOURCE_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the text file is too large",
            {"reason": "sourceTooLarge", "limit": MAX_SOURCE_BYTES},
        )
    text = decode_text(source.read_bytes())
    markdown = source_format == "markdown" or (
        source_format == "auto" and extension in MARKDOWN_EXTENSIONS
    )
    return text, markdown


def _read_source(params: CreateDocumentParams) -> tuple[str, bool]:
    if params.path:
        return read_text_file(params.path, params.format)
    if params.text is None or not params.text.strip():
        raise OpError(
            ErrorCode.INVALID_PARAMS, "there is no text to lay out", {"reason": "noContent"}
        )
    markdown = params.format == "markdown" or (
        params.format == "auto" and MARKDOWN_HINT.search(params.text) is not None
    )
    return params.text, markdown


def _escape(value: str) -> str:
    return html.escape(value.strip())


def _meta(*values: str) -> str:
    shown = [_escape(value) for value in values if value.strip()]
    return f'<p class="meta">{" · ".join(shown)}</p>' if shown else ""


def _title(params: CreateDocumentParams, extra_class: str = "") -> str:
    if not params.title.strip():
        return ""
    return f'<h1 class="title {extra_class}">{_escape(params.title)}</h1>'


def _signers(author: str) -> str:
    names = [name.strip() for name in author.split(",") if name.strip()]
    if not names:
        return ""
    rows = []
    for start in range(0, len(names), SIGNERS_PER_ROW):
        cells = "".join(
            f'<td><div class="sign-space"></div><p>{html.escape(name)}</p></td>'
            for name in names[start : start + SIGNERS_PER_ROW]
        )
        rows.append(f"<tr>{cells}</tr>")
    return f'<table class="signers">{"".join(rows)}</table>'


def _block(css_class: str, content: str) -> str:
    return f'<div class="{css_class}">{content}</div>' if content else ""


def _line(css_class: str, value: str) -> str:
    return f'<p class="{css_class}">{_escape(value)}</p>' if value.strip() else ""


def _document_html(params: CreateDocumentParams, body: str, logo: str) -> str:
    template = params.template
    title = _title(params)
    if template == "report":
        return _block("head", logo + title + _meta(params.author, params.date)) + body
    if template == "assignment":
        head = logo + title + _meta(params.author) + _meta(params.date)
        return _block("center head", head) + body
    if template == "letter":
        sender = _line("sender", params.author)
        date = _line("date", params.date)
        subject = _line("subject", params.title)
        return logo + sender + date + subject + body + _line("closing", params.author)
    if template == "petition":
        signature = ""
        if params.author.strip():
            signature = _block(
                "signature", '<div class="sign-space"></div>' + _line("", params.author)
            )
        addressee = _title(params, "addressee")
        return logo + _line("date", params.date) + addressee + _block("petition", body) + signature
    if template == "minutes":
        head = logo + title + _meta(params.date)
        return _block("center head", head) + body + _signers(params.author)
    if template == "lectureNotes":
        return _block("notes-head", logo + title + _meta(params.author, params.date)) + body
    cover = logo + title + _meta(params.author) + _meta(params.date)
    return _block("cover", cover) + body


def _base_rules(family: str, size: float, heading: str) -> list[str]:
    return [
        f"body{{font-family:{family};font-size:{size}pt;line-height:1.45;color:#1a1a1a;}}",
        f"p{{margin:0 0 {size * 0.6:.1f}pt 0;}}",
        f"h1{{font-size:{size * 1.9:.1f}pt;margin:0 0 6pt 0;}}",
        f"h2{{font-size:{size * 1.35:.1f}pt;margin:{size:.1f}pt 0 4pt 0;color:{heading};}}",
        f"h3{{font-size:{size * 1.15:.1f}pt;margin:{size * 0.8:.1f}pt 0 3pt 0;}}",
        "ul,ol{margin:0 0 6pt 0;padding-left:16pt;}",
        "li{margin:0 0 2pt 0;}",
        f"pre,code{{font-family:monospace;font-size:{size * 0.88:.1f}pt;white-space:pre-wrap;}}",
        "pre{background-color:#f3f4f6;padding:6pt;}",
        "table{border-collapse:collapse;margin:0 0 6pt 0;}",
        "td,th{border:0.5pt solid #999;padding:2pt 4pt;}",
        "blockquote{margin:0 0 6pt 0;padding-left:8pt;border-left:2pt solid #ccc;color:#444;}",
        ".logo{max-height:48pt;max-width:160pt;margin:0 0 8pt 0;}",
        ".meta{color:#555555;margin:0 0 4pt 0;}",
        ".center{text-align:center;}",
        ".sign-space{height:36pt;border-bottom:0.6pt solid #333333;margin:0 0 3pt 0;}",
    ]


def _template_rules(template: Template, size: float, accent: str) -> list[str]:
    if template == "report":
        return [
            f".head{{border-bottom:1.5pt solid {accent};padding-bottom:6pt;margin-bottom:12pt;}}",
            f".title{{color:{accent};}}",
        ]
    if template == "assignment":
        return [".head{margin-bottom:18pt;}", "body{text-align:justify;}"]
    if template == "letter":
        return [
            ".sender{text-align:right;white-space:pre-wrap;}",
            ".date{text-align:right;margin-bottom:18pt;}",
            ".subject{font-weight:bold;margin-bottom:12pt;}",
            ".closing{margin-top:24pt;}",
        ]
    if template == "petition":
        return [
            ".date{text-align:right;margin-bottom:18pt;}",
            f".addressee{{text-align:center;font-size:{size * 1.2:.1f}pt;margin-bottom:18pt;}}",
            ".petition p{text-align:justify;text-indent:24pt;}",
            ".petition p.lines{text-indent:0;}",
            ".signature{margin-top:24pt;margin-left:60%;text-align:center;}",
        ]
    if template == "minutes":
        return [
            ".head{margin-bottom:14pt;}",
            ".signers{width:100%;margin-top:28pt;border:none;}",
            ".signers td{border:none;text-align:center;width:33%;padding:0 8pt 14pt 8pt;}",
        ]
    if template == "lectureNotes":
        return [
            f".notes-head{{border-left:4pt solid {accent};padding-left:8pt;margin-bottom:12pt;}}",
            f"h2{{border-left:3pt solid {accent};padding-left:6pt;}}",
            f"blockquote{{background-color:#fff7e0;border-left:3pt solid {accent};}}",
            "blockquote{padding:4pt 8pt;color:#1a1a1a;}",
        ]
    return [
        ".cover{page-break-after:always;text-align:center;padding-top:120pt;}",
        f".cover .title{{font-size:{size * 2.4:.1f}pt;color:{accent};}}",
        "h1{page-break-before:always;}",
        ".cover h1{page-break-before:avoid;}",
    ]


def _template_css(params: CreateDocumentParams) -> str:
    accent = params.accent if COLOUR.match(params.accent) else DEFAULT_ACCENT
    heading = "#1a1a1a" if params.template in FORMAL_TEMPLATES else accent
    rules = _base_rules(FAMILIES[params.font], params.font_size, heading)
    return "".join(rules + _template_rules(params.template, params.font_size, accent))


def furniture_html(text: str, align: str, family: str) -> str:
    style = f"font-family:{family};font-size:{FURNITURE_FONT_PT}pt;color:#666666;text-align:{align}"
    return f'<div style="{style}">{html.escape(text)}</div>'


def _add_furniture(document: pymupdf.Document, params: CreateDocumentParams, margin: float) -> None:
    family = FAMILIES[params.font]
    total = document.page_count
    skip_first = params.template == "booklet" and total > 1
    for index, page in enumerate(document):
        if skip_first and index == 0:
            continue
        width, height = page.rect.width, page.rect.height
        top = max(4.0, margin / 2 - FURNITURE_HEIGHT / 2)
        bottom = min(height - 4.0, height - margin / 2 + FURNITURE_HEIGHT / 2)
        if params.header.strip():
            page.insert_htmlbox(
                pymupdf.Rect(margin, top, width - margin, top + FURNITURE_HEIGHT),
                furniture_html(params.header, "right", family),
            )
        footer_rect = pymupdf.Rect(margin, bottom - FURNITURE_HEIGHT, width - margin, bottom)
        if params.footer.strip():
            page.insert_htmlbox(footer_rect, furniture_html(params.footer, "left", family))
        if params.page_numbers:
            number = index if skip_first else index + 1
            count = total - 1 if skip_first else total
            label = params.page_number_format.replace("{page}", str(number)).replace(
                "{total}", str(count)
            )
            align = "right" if params.footer.strip() else "center"
            page.insert_htmlbox(footer_rect, furniture_html(label, align, family))


def _logo_html(params: CreateDocumentParams, workdir: Path) -> str:
    if not params.logo:
        return ""
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
    return f'<img class="logo" src="{name}"/>'


def build_document(
    params: CreateDocumentParams, target: Path, check_cancelled: Callable[[], None] | None = None
) -> int:
    text, markdown = _read_source(params)
    body = markdown_to_html(text) if markdown else plain_text_html(text)
    mediabox = pymupdf.paper_rect(params.paper)
    margin = params.margin_mm * POINTS_PER_MM
    where = mediabox + (margin, margin, -margin, -margin)
    with tempfile.TemporaryDirectory(
        prefix="vivepdf-create-", ignore_cleanup_errors=True
    ) as temp_dir:
        workdir = Path(temp_dir)
        logo = _logo_html(params, workdir)
        payload = story_pdf_bytes(
            _document_html(params, body, logo),
            mediabox,
            where,
            css=_template_css(params),
            archive_dirs=(workdir,),
            check_cancelled=check_cancelled,
        )
    with pymupdf.open("pdf", payload) as document:
        _add_furniture(document, params, margin)
        metadata = dict(document.metadata or {})
        metadata.update(
            {"title": params.title.strip(), "author": params.author.strip(), "creator": "vivePDF"}
        )
        document.set_metadata(metadata)
        with contextlib.suppress(Exception):
            document.subset_fonts(fallback=False)
        pages = document.page_count
        save_document(document, target)
    return pages


@op("create.document", CreateDocumentParams)
def create_document(params: CreateDocumentParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path] if params.path else [], params.overwrite)
    progress.report(0.1, "progress.converting")
    pages = build_document(params, target, progress.check_cancelled)
    progress.report(1.0, "progress.converting")
    return OutputResult(output=str(target), page_count=pages, bytes=target.stat().st_size)
