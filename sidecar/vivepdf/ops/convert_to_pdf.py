import contextlib
import csv
import html
import io
import tempfile
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import Field

from vivepdf.external import libreoffice
from vivepdf.ops._mail import MAIL_CSS, MAIL_EXTENSIONS, MailLabels, mail_document_html, read_mail
from vivepdf.ops._naming import unique_name
from vivepdf.ops._output import OutputResult, prepare_output, save_document
from vivepdf.ops._story import (
    BASE_CSS,
    FONT_DIR,
    MARGIN,
    declared_charset,
    decode_text,
    markdown_to_html,
    render_html_to_pdf,
    story_pdf_bytes,
    text_to_html,
)
from vivepdf.ops._svg import svg_pdf_bytes
from vivepdf.ops.convert import IMAGE_EXTENSIONS, MUPDF_DOCUMENT_EXTENSIONS, TEXT_EXTENSIONS
from vivepdf.ops.convert_images import ImagesToPdfParams, images_to_pdf
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.paths import ReadPath, WritePath
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class FileToPdfParams(RpcModel):
    path: ReadPath
    output: WritePath
    overwrite: bool = False
    paper: Literal["a4", "letter"] = "a4"
    mail_labels: MailLabels = MailLabels()


def _mail_to_pdf(source: Path, target: Path, params: FileToPdfParams, progress: Progress) -> None:
    message = read_mail(source)
    mediabox = pymupdf.paper_rect(params.paper)
    where = mediabox + (MARGIN, MARGIN, -MARGIN, -MARGIN)
    with tempfile.TemporaryDirectory(
        prefix="vivepdf-mail-", ignore_cleanup_errors=True
    ) as temp_dir:
        workdir = Path(temp_dir)
        content, attachments = mail_document_html(message, params.mail_labels, workdir)
        payload = story_pdf_bytes(
            content,
            mediabox,
            where,
            css=BASE_CSS + MAIL_CSS,
            archive_dirs=(workdir,),
            check_cancelled=progress.check_cancelled,
        )
    with pymupdf.open("pdf", payload) as document:
        taken: set[str] = set()
        for attachment in attachments:
            name = unique_name(Path(attachment.name).name or "attachment", taken)
            document.embfile_add(name, attachment.data, filename=name, desc=attachment.mime)
        metadata = dict(document.metadata or {})
        metadata.update(
            {
                "title": message.subject.strip(),
                "author": message.sender.strip(),
                "creator": "vivePDF",
            }
        )
        document.set_metadata(metadata)
        with contextlib.suppress(Exception):
            document.subset_fonts(fallback=False)
        save_document(document, target)


def _story_source(path: Path) -> str:
    payload = path.read_bytes()
    extension = path.suffix.lower().lstrip(".")
    if extension in ("html", "htm"):
        return decode_text(payload, declared_charset(payload))
    text = decode_text(payload)
    if extension in ("md", "markdown"):
        return markdown_to_html(text, anchors=True)
    return text_to_html(text)


CSV_DELIMITERS = ",;\t|"
CSV_SAMPLE_CHARACTERS = 64 * 1024
CSV_FILTER = "Text - txt - csv (StarCalc)"
CSV_UTF8_TOKEN = 76
CSV_QUOTE = 34
CSV_CSS = BASE_CSS + "table{font-size:9pt;}td{vertical-align:top;}"
WIDE_TABLE_COLUMNS = 6


def _csv_rows(path: Path) -> list[list[str]]:
    text = decode_text(path.read_bytes())
    try:
        dialect = csv.Sniffer().sniff(text[:CSV_SAMPLE_CHARACTERS], delimiters=CSV_DELIMITERS)
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","
    try:
        return list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter))
    except csv.Error as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"cannot read: {path.name}",
            {"reason": "fileUnreadable", "path": str(path)},
        ) from error


def csv_filter_options(path: Path, working_dir: Path) -> tuple[Path, str]:
    text = decode_text(path.read_bytes())
    try:
        dialect = csv.Sniffer().sniff(text[:CSV_SAMPLE_CHARACTERS], delimiters=CSV_DELIMITERS)
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","
    normalized = working_dir / path.name
    normalized.write_text(text, encoding="utf-8")
    return normalized, f"{CSV_FILTER}:{ord(delimiter)},{CSV_QUOTE},{CSV_UTF8_TOKEN},1"


def _cell_html(cell: str) -> str:
    return "<br>".join(html.escape(line) for line in cell.splitlines())


def csv_table_html(rows: list[list[str]]) -> str:
    width = max((len(row) for row in rows), default=0)
    lines = (
        "<tr>"
        + "".join(f"<td>{_cell_html(cell)}</td>" for cell in row + [""] * (width - len(row)))
        + "</tr>"
        for row in rows
    )
    return f"<table>{''.join(lines)}</table>"


def _overflow_scale(html: str, mediabox: pymupdf.Rect) -> float:
    where = mediabox + (MARGIN, MARGIN, -MARGIN, -MARGIN)
    story = pymupdf.Story(html=html, user_css=CSV_CSS, archive=pymupdf.Archive(str(FONT_DIR)))
    _, filled = story.place(where)
    return max(1.0, (pymupdf.Rect(filled).x1 - where.x0) / where.width)


def _csv_to_pdf(source: Path, target: Path, params: FileToPdfParams, progress: Progress) -> None:
    rows = _csv_rows(source)
    html = csv_table_html(rows)
    wide = max((len(row) for row in rows), default=0) > WIDE_TABLE_COLUMNS
    mediabox = pymupdf.paper_rect(f"{params.paper}-l" if wide else params.paper)
    scale = _overflow_scale(html, mediabox)
    canvas = mediabox * scale
    margin = MARGIN * scale
    payload = story_pdf_bytes(
        html,
        canvas,
        canvas + (margin, margin, -margin, -margin),
        css=CSV_CSS,
        check_cancelled=progress.check_cancelled,
    )
    with pymupdf.open("pdf", payload) as drawn, pymupdf.open() as document:
        for page in drawn:
            progress.check_cancelled()
            document.new_page(width=mediabox.width, height=mediabox.height).show_pdf_page(
                mediabox, drawn, page.number
            )
        with contextlib.suppress(Exception):
            document.subset_fonts(fallback=False)
        save_document(document, target)


@op("convert.file_to_pdf", FileToPdfParams)
def file_to_pdf(params: FileToPdfParams, progress: Progress) -> OutputResult:
    source = Path(params.path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": params.path}
        )
    target = prepare_output(params.output, [params.path], params.overwrite)
    extension = source.suffix.lower().lstrip(".")
    progress.report(0.1, "progress.converting")
    if extension in IMAGE_EXTENSIONS:
        return images_to_pdf(
            ImagesToPdfParams(
                images=[params.path], output=str(target), overwrite=True, page_size="image"
            ),
            progress.within(0.1, 1.0),
        )
    if extension in TEXT_EXTENSIONS:
        render_html_to_pdf(
            _story_source(source),
            target,
            params.paper,
            base_dir=source.parent,
            check_cancelled=progress.check_cancelled,
            outline=True,
        )
    elif extension == "csv":
        _csv_to_pdf(source, target, params, progress)
    elif extension in MAIL_EXTENSIONS:
        _mail_to_pdf(source, target, params, progress)
    elif extension == "svg":
        with tempfile.TemporaryDirectory(
            prefix="vivepdf-svg-", ignore_cleanup_errors=True
        ) as temp_dir:
            pdf_bytes = svg_pdf_bytes(source, Path(temp_dir), progress.check_cancelled)
        with pymupdf.open("pdf", pdf_bytes) as converted:
            save_document(converted, target)
    elif extension in MUPDF_DOCUMENT_EXTENSIONS:
        try:
            with pymupdf.open(str(source)) as document:
                pdf_bytes = document.convert_to_pdf()
        except Exception as error:  # noqa: BLE001
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"cannot open: {source.name}",
                {"reason": "fileUnreadable", "path": str(source)},
            ) from error
        with pymupdf.open("pdf", pdf_bytes) as converted:
            save_document(converted, target)
    elif extension in libreoffice.OFFICE_EXTENSIONS:
        with tempfile.TemporaryDirectory(
            prefix="vivepdf-office-", ignore_cleanup_errors=True
        ) as temp_dir:
            working = Path(temp_dir)
            produced = libreoffice.convert_to_pdf(source, working, None, progress.check_cancelled)
            progress.check_cancelled()
            with pymupdf.open(str(produced)) as document:
                save_document(document, target)
    else:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported file type: .{extension}",
            {"reason": "unsupportedType", "extension": extension},
        )
    with pymupdf.open(target) as produced:
        return OutputResult(
            output=str(target), page_count=produced.page_count, bytes=target.stat().st_size
        )


class SvgToPdfParams(RpcModel):
    paths: list[ReadPath] = Field(min_length=1, max_length=500)
    output: WritePath
    overwrite: bool = False


@op("convert.svg_to_pdf", SvgToPdfParams)
def svg_to_pdf(params: SvgToPdfParams, progress: Progress) -> OutputResult:
    sources = [Path(path) for path in params.paths]
    for source in sources:
        if not source.is_file():
            raise OpError(
                ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": str(source)}
            )
        if source.suffix.lower() != ".svg":
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"{source.name} is not an SVG drawing",
                {"reason": "notSvg"},
            )
    target = prepare_output(params.output, params.paths, params.overwrite)
    total = len(sources)
    with (
        tempfile.TemporaryDirectory(prefix="vivepdf-svg-", ignore_cleanup_errors=True) as temp_dir,
        pymupdf.open() as combined,
    ):
        for index, source in enumerate(sources):
            progress.check_cancelled()
            progress.report(
                index / total, "progress.converting", {"current": index + 1, "total": total}
            )
            pdf_bytes = svg_pdf_bytes(source, Path(temp_dir) / str(index), progress.check_cancelled)
            with pymupdf.open("pdf", pdf_bytes) as drawing:
                combined.insert_pdf(drawing)
        return save_document(combined, target)
