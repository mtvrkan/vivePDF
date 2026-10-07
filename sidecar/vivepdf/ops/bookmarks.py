import pymupdf
from pydantic import Field

from vivepdf.ops._bookmark_actions import (
    _file_link,
    _kept_action,
    _kept_actions,
    _page_destination,
    _web_link,
    _write_items,
)
from vivepdf.ops._bookmark_headings import _suggested_outline
from vivepdf.ops._bookmark_model import (
    BookmarkItem,
    BookmarksGenerateParams,
    BookmarksGenerateResult,
    BookmarksSuggestParams,
)
from vivepdf.ops._bookmark_outline import _read_outline
from vivepdf.ops._document import open_document
from vivepdf.ops._inplace import save_in_place
from vivepdf.ops._output import (
    OutputResult,
    prepare_output,
    save_document,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class BookmarksParams(RpcModel):
    path: str
    password: str | None = None


class BookmarksResult(RpcModel):
    items: list[BookmarkItem]


@op("bookmarks.get", BookmarksParams)
def get_bookmarks(params: BookmarksParams, progress: Progress) -> BookmarksResult:
    with open_document(params.path, params.password, mutable=False) as document:
        return BookmarksResult(items=_read_outline(document))


def _link_error(item: BookmarkItem, message: str) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS, message, {"reason": "bookmarkLink", "title": item.title}
    )


def _validate_items(
    items: list[BookmarkItem],
    page_count: int,
    kept: dict[int, tuple[BookmarkItem, str]],
) -> None:
    previous_level = 0
    for index, item in enumerate(items):
        if item.level > previous_level + 1:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"bookmark level jumps from {previous_level} to {item.level}",
                {"title": item.title, "level": item.level},
            )
        if not item.title.strip():
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "a bookmark has no title",
                {"reason": "bookmarkTitle", "index": index},
            )
        if item.target == "page" and item.page > page_count:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"page {item.page} is outside 1..{page_count}",
                {"reason": "pageOutOfRange", "page": item.page, "pageCount": page_count},
            )
        if _kept_action(item, kept) is None:
            if item.target == "web" and _web_link(item.uri) is None:
                raise _link_error(
                    item, "a bookmark link must be an http, https, ftp or mailto address"
                )
            if item.target == "file" and _file_link(item.file) is None:
                raise _link_error(item, "a bookmark can only open another PDF file")
        previous_level = item.level


class BookmarksSetParams(RpcModel):
    path: str
    password: str | None = None
    output: str | None = None
    in_place: bool = False
    overwrite: bool = False
    items: list[BookmarkItem]
    open_panel: bool = False


def _show_outline_panel(document: pymupdf.Document) -> None:
    document.xref_set_key(document.pdf_catalog(), "PageMode", "/UseOutlines")


def _check_destination(params: BookmarksSetParams) -> None:
    if params.in_place and params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "give either an output file or in-place, not both",
            {"reason": "outputAndInPlace"},
        )
    if not params.in_place and not params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "an output file or in-place is required",
            {"reason": "outputRequired"},
        )


@op("bookmarks.set", BookmarksSetParams)
def set_bookmarks(params: BookmarksSetParams, progress: Progress) -> OutputResult:
    _check_destination(params)
    target = (
        None if params.in_place else prepare_output(params.output, [params.path], params.overwrite)
    )
    document = open_document(params.path, params.password)
    try:
        kept = _kept_actions(document)
        _validate_items(params.items, document.page_count, kept)
        _write_items(document, params.items, kept)
        if params.open_panel and params.items:
            _show_outline_panel(document)
        progress.report(0.9, "progress.saving")
        if target is None:
            return save_in_place(document, params.path)
        return save_document(document, target)
    finally:
        if not document.is_closed:
            document.close()


@op("bookmarks.suggest", BookmarksSuggestParams)
def suggest_bookmarks(params: BookmarksSuggestParams, progress: Progress) -> BookmarksResult:
    with open_document(params.path, params.password) as document:
        items = _suggested_outline(document, params, progress)
    return BookmarksResult(items=items)


@op("bookmarks.generate", BookmarksGenerateParams)
def generate_bookmarks(
    params: BookmarksGenerateParams, progress: Progress
) -> BookmarksGenerateResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    with open_document(params.path, params.password) as document:
        items = _suggested_outline(document, params, progress)
        _write_items(document, items, {})
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return BookmarksGenerateResult(**saved.model_dump(), items=items)


class BookmarkAddParams(RpcModel):
    path: str
    password: str | None = None
    title: str = Field(min_length=1, max_length=500)
    page: int = Field(ge=1)
    x: float | None = None
    y: float | None = None


class BookmarkAddResult(OutputResult):
    index: int


def _reference(document: pymupdf.Document, xref: int, key: str) -> int:
    kind, value = document.xref_get_key(xref, key)
    return int(value.split()[0]) if kind == "xref" else 0


def _outline_root(document: pymupdf.Document) -> int:
    catalog = document.pdf_catalog()
    root = _reference(document, catalog, "Outlines")
    if root:
        return root
    root = document.get_new_xref()
    document.update_object(root, "<</Type/Outlines/Count 0>>")
    document.xref_set_key(catalog, "Outlines", f"{root} 0 R")
    return root


def _following_top_item(document: pymupdf.Document, page: int) -> tuple[int, int]:
    toc = document.get_toc(simple=False)
    for position, (level, _title, target, destination) in enumerate(toc):
        if level != 1 or target <= page or not isinstance(destination, dict):
            continue
        if destination.get("xref"):
            return int(destination["xref"]), position
    return 0, len(toc)


def _link_outline_item(document: pymupdf.Document, root: int, item: int, before: int) -> None:
    previous = (
        _reference(document, before, "Prev") if before else _reference(document, root, "Last")
    )
    if previous:
        document.xref_set_key(previous, "Next", f"{item} 0 R")
        document.xref_set_key(item, "Prev", f"{previous} 0 R")
    else:
        document.xref_set_key(root, "First", f"{item} 0 R")
    if before:
        document.xref_set_key(before, "Prev", f"{item} 0 R")
        document.xref_set_key(item, "Next", f"{before} 0 R")
    else:
        document.xref_set_key(root, "Last", f"{item} 0 R")
    kind, count = document.xref_get_key(root, "Count")
    visible = int(count) if kind == "int" else 0
    document.xref_set_key(root, "Count", str(visible + 1 if visible >= 0 else visible - 1))


@op("bookmarks.add", BookmarkAddParams)
def add_bookmark(params: BookmarkAddParams, _progress: Progress) -> BookmarkAddResult:
    title = params.title.strip()
    if not title:
        raise OpError(ErrorCode.INVALID_PARAMS, "a bookmark has no title", {"reason": "empty"})
    document = open_document(params.path, params.password)
    try:
        if params.page > document.page_count:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"page {params.page} is outside 1..{document.page_count}",
                {"reason": "pageOutOfRange", "page": params.page, "pageCount": document.page_count},
            )
        page = document[params.page - 1]
        before, index = _following_top_item(document, params.page)
        root = _outline_root(document)
        item = document.get_new_xref()
        destination = _page_destination(
            page, BookmarkItem(level=1, title=title, page=params.page, top=params.y)
        )
        document.update_object(
            item,
            f"<</Title{pymupdf.get_pdf_str(title)}/Parent {root} 0 R/Dest{destination}>>",
        )
        _link_outline_item(document, root, item, before)
        saved = save_in_place(document, params.path)
        return BookmarkAddResult(**saved.model_dump(), index=index)
    finally:
        if not document.is_closed:
            document.close()
