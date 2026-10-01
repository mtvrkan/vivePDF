from urllib.parse import urlsplit

import pymupdf

from vivepdf.ops._bookmark_model import BOLD_FLAG, FIT_ARITY, ITALIC_FLAG, WEB_SCHEMES, BookmarkItem
from vivepdf.ops._bookmark_outline import _number, _pdf_position, _read_outline, write_outline
from vivepdf.ops.links import mail_uri, web_uri


def _web_link(uri: str | None) -> str | None:
    text = (uri or "").strip()
    if not text or any(ord(character) < 0x20 for character in text):
        return None
    try:
        scheme = urlsplit(text).scheme.lower()
    except ValueError:
        return None
    if scheme not in WEB_SCHEMES:
        return None
    if text.isascii() and " " not in text:
        return text
    if scheme == "mailto":
        return mail_uri(text[len("mailto:") :])
    return web_uri(text)


def _file_link(file: str | None) -> str | None:
    text = (file or "").strip()
    if not text or "://" in text or any(ord(character) < 0x20 for character in text):
        return None
    return text if text.lower().endswith(".pdf") else None


def _same_link(first: BookmarkItem, second: BookmarkItem) -> bool:
    return (first.target, first.uri, first.file, first.page) == (
        second.target,
        second.uri,
        second.file,
        second.page,
    )


def _kept_actions(document: pymupdf.Document) -> dict[int, tuple[BookmarkItem, str]]:
    kept: dict[int, tuple[BookmarkItem, str]] = {}
    for item in _read_outline(document):
        if item.target == "page" or item.source is None:
            continue
        kind, value = document.xref_get_key(item.source, "A")
        if kind in ("dict", "xref"):
            kept[item.source] = (item, value)
    return kept


def _kept_action(item: BookmarkItem, kept: dict[int, tuple[BookmarkItem, str]]) -> str | None:
    original = kept.get(item.source) if item.source is not None else None
    if original is not None and _same_link(original[0], item):
        return original[1]
    return None


def _action(item: BookmarkItem, kept: dict[int, tuple[BookmarkItem, str]]) -> str | None:
    original = _kept_action(item, kept)
    if original is not None:
        return original
    if item.target == "web":
        link = _web_link(item.uri)
        return None if link is None else f"<</S/URI/URI{pymupdf.get_pdf_str(link)}>>"
    if item.target == "file":
        link = _file_link(item.file)
        if link is None:
            return None
        return f"<</S/GoToR/F{pymupdf.get_pdf_str(link)}/D[{max(item.page, 1) - 1}/Fit]>>"
    return None


def _page_destination(page: pymupdf.Page, item: BookmarkItem) -> str:
    if item.fit is not None and item.fit != "XYZ":
        arguments = item.fit_args or [None] * FIT_ARITY[item.fit]
        values = "".join(f" {_number(value)}" for value in arguments)
        return f"[{page.xref} 0 R/{item.fit}{values}]"
    left, top = _pdf_position(page, item.left, item.top)
    return f"[{page.xref} 0 R/XYZ {_number(left)} {_number(top)} {_number(item.zoom or None)}]"


def _color_array(color: str) -> str:
    channels = (int(color[index : index + 2], 16) / 255 for index in (1, 3, 5))
    return "[" + " ".join(_number(channel) for channel in channels) + "]"


def _write_items(
    document: pymupdf.Document,
    items: list[BookmarkItem],
    kept: dict[int, tuple[BookmarkItem, str]],
) -> None:
    xrefs = write_outline(
        document,
        [[item.level, item.title, -1] for item in items],
        [item.collapsed for item in items],
    )
    for item, xref in zip(items, xrefs, strict=True):
        if not xref:
            continue
        for key in ("A", "Dest"):
            if document.xref_get_key(xref, key)[0] != "null":
                document.xref_set_key(xref, key, "null")
        if item.target == "page":
            if 1 <= item.page <= document.page_count:
                destination = _page_destination(document[item.page - 1], item)
                document.xref_set_key(xref, "Dest", destination)
        else:
            action = _action(item, kept)
            if action is not None:
                document.xref_set_key(xref, "A", action)
        if item.color is not None and item.color.lower() != "#000000":
            document.xref_set_key(xref, "C", _color_array(item.color))
        flags = (ITALIC_FLAG if item.italic else 0) | (BOLD_FLAG if item.bold else 0)
        if flags:
            document.xref_set_key(xref, "F", str(flags))
