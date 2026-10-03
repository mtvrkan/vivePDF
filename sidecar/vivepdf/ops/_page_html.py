import html
import re
import shutil
from pathlib import Path

import pymupdf

from vivepdf.rpc.errors import ErrorCode, OpError

COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")


def html_lines(text: str) -> str:
    return "<br/>".join(html.escape(line) for line in text.strip().splitlines())


def text_block(text: str, size: float, css_class: str = "", extra: str = "") -> str:
    if not text.strip():
        return ""
    style = f"font-size:{size}pt;{extra}"
    return f'<p class="{css_class}" style="{style}">{html_lines(text)}</p>'


def gap(size: float) -> str:
    return f'<p style="font-size:{size}pt">&#160;</p>'


def insert_centered(
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


def content_height(rect: pymupdf.Rect, content: str, css: str, archive: pymupdf.Archive) -> float:
    story = pymupdf.Story(html=content, user_css=css, archive=archive)
    _more, filled = story.place(rect)
    return pymupdf.Rect(filled).y1 - rect.y0


def colour_rgb(value: str, fallback: str) -> tuple[float, float, float]:
    colour = value if COLOUR.match(value) else fallback
    return tuple(int(colour[position : position + 2], 16) / 255 for position in (1, 3, 5))


def checked_picture(path: str | None, extensions: set[str], which: str) -> Path | None:
    if not path:
        return None
    source = Path(path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND,
            f"file not found: {source.name}",
            {"path": path, "which": which},
        )
    extension = source.suffix.lower().lstrip(".")
    if extension not in extensions:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            f"unsupported {which} type: .{extension}",
            {"reason": "unsupportedType", "extension": extension, "which": which},
        )
    return source


def copy_picture(
    path: str | None, extensions: set[str], which: str, workdir: Path, stem: str
) -> str | None:
    source = checked_picture(path, extensions, which)
    if source is None:
        return None
    name = f"{stem}{source.suffix.lower()}"
    shutil.copyfile(source, workdir / name)
    return name
