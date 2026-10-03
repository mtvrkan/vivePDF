import contextlib
import csv
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
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class FileToPdfParams(RpcModel):
    path: str
    output: str
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
        return markdown_to_html(text)
    return text_to_html(text)


CSV_DELIMITERS = ",;\t|"
CSV_SAMPLE_CHARACTERS = 64 * 1024
CSV_FILTER = "Text - txt - csv (StarCalc)"
CSV_UTF8_TOKEN = 76
CSV_QUOTE = 34


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
        )
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
            office_source, infilter = source, None
            if extension == "csv":
                staging = working / "source"
                staging.mkdir()
                office_source, infilter = csv_filter_options(source, staging)
            produced = libreoffice.convert_to_pdf(
                office_source, working, infilter, progress.check_cancelled
            )
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
    paths: list[str] = Field(min_length=1, max_length=500)
    output: str
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
