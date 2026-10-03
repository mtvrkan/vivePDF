import re
import tempfile
from pathlib import Path
from typing import Literal

from vivepdf.ops._clipboard import clipboard_kind, read_clipboard
from vivepdf.ops._html_clean import body_fragment, without_remote_pictures
from vivepdf.ops._output import prepare_output
from vivepdf.ops._page_html import html_lines
from vivepdf.ops._story import render_html_to_pdf
from vivepdf.ops.convert_images import ImagesToPdfParams, images_to_pdf
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

ClipboardKind = Literal["files", "image", "html", "text"]
PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


class ClipboardParams(RpcModel):
    output: str
    overwrite: bool = False
    paper: Literal["a4", "letter"] = "a4"


class ClipboardResult(RpcModel):
    kind: ClipboardKind
    output: str | None = None
    page_count: int = 0
    bytes: int = 0
    files: list[str] = []


def text_document_html(text: str) -> str:
    blocks = PARAGRAPH_BREAK.split(text.replace("\r\n", "\n").replace("\r", "\n"))
    return "".join(f"<p>{html_lines(block)}</p>" for block in blocks if block.strip())


@op("create.clipboard", ClipboardParams)
def clipboard_to_pdf(params: ClipboardParams, progress: Progress) -> ClipboardResult:
    content = read_clipboard()
    kind = clipboard_kind(content)
    if kind is None:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "the clipboard holds nothing that can become a PDF",
            {"reason": "clipboardEmpty"},
        )
    if kind == "files":
        return ClipboardResult(kind="files", files=content.files)
    target = prepare_output(params.output, [], params.overwrite)
    progress.report(0.2, "progress.converting")
    if kind == "image" and content.image is not None:
        with tempfile.TemporaryDirectory(
            prefix="vivepdf-clipboard-", ignore_cleanup_errors=True
        ) as temp_dir:
            picture = Path(temp_dir) / "clipboard.png"
            content.image.save(picture, "PNG")
            result = images_to_pdf(
                ImagesToPdfParams(
                    images=[str(picture)], output=str(target), overwrite=True, page_size="image"
                ),
                progress.within(0.2, 1.0),
            )
        return ClipboardResult(
            kind="image", output=result.output, page_count=result.page_count, bytes=result.bytes
        )
    if kind == "html":
        document = without_remote_pictures(body_fragment(content.html))
    else:
        document = text_document_html(content.text)
    pages = render_html_to_pdf(
        document, target, params.paper, check_cancelled=progress.check_cancelled
    )
    progress.report(1.0, "progress.converting")
    return ClipboardResult(
        kind=kind, output=str(target), page_count=pages, bytes=target.stat().st_size
    )
