import json
from pathlib import Path

import pymupdf
from pydantic import ValidationError

from vivepdf.ops._bookmark_actions import _kept_actions, _write_items
from vivepdf.ops._bookmark_model import BookmarkItem, BookmarksGenerateResult
from vivepdf.ops._bookmark_outline import _read_outline
from vivepdf.ops._document import open_document
from vivepdf.ops._output import (
    prepare_data_output,
    prepare_output,
    save_document,
)
from vivepdf.ops.bookmarks import BookmarksResult, _validate_items
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class BookmarksExportParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False


class BookmarksExportResult(RpcModel):
    output: str
    count: int


class BookmarksImportParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    data_path: str
    replace: bool = True


class BookmarksParseParams(RpcModel):
    path: str
    password: str | None = None
    data_path: str
    replace: bool = True


IMPORTED_FIELDS = (
    "left",
    "top",
    "zoom",
    "collapsed",
    "target",
    "uri",
    "file",
    "fit",
    "fitArgs",
    "color",
    "bold",
    "italic",
)


def _exported_entry(item: BookmarkItem) -> dict:
    extra = item.model_dump(
        by_alias=True,
        exclude_defaults=True,
        exclude_none=True,
        exclude={"level", "title", "page", "source"},
    )
    return {"level": item.level, "title": item.title, "page": item.page, **extra}


def _bookmark_file_error(message: str) -> OpError:
    return OpError(ErrorCode.INVALID_PARAMS, message, {"reason": "bookmarkFile"})


def _items_from_entries(entries: list, page_count: int) -> list[BookmarkItem]:
    items: list[BookmarkItem] = []
    previous_level = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise _bookmark_file_error("a bookmark entry is not an object")
        try:
            level = int(entry.get("level", 1))
            page = int(entry.get("page", 1))
        except (TypeError, ValueError) as error:
            raise _bookmark_file_error(f"a bookmark has an invalid number: {error}") from error
        raw_title = entry.get("title")
        title = "" if raw_title is None else str(raw_title).strip()
        if not title:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "a bookmark has no title", {"reason": "bookmarkTitle"}
            )
        is_page = entry.get("target", "page") == "page"
        if is_page and (page < 1 or page > page_count):
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                f"page {page} is outside 1..{page_count}",
                {"reason": "pageOutOfRange", "page": page, "pageCount": page_count},
            )
        level = min(max(1, level), previous_level + 1)
        fields = {key: entry[key] for key in IMPORTED_FIELDS if key in entry}
        try:
            item = BookmarkItem.model_validate(
                {**fields, "level": level, "title": title, "page": max(0, page)}
            )
        except ValidationError as error:
            detail = error.errors()[0].get("msg", "invalid value")
            raise _bookmark_file_error(f"a bookmark has an invalid field: {detail}") from error
        items.append(item)
        previous_level = level
    return items


@op("bookmarks.export", BookmarksExportParams)
def export_bookmarks(params: BookmarksExportParams, progress: Progress) -> BookmarksExportResult:
    target = prepare_data_output(params.output, "json", params.overwrite)
    with open_document(params.path, params.password, mutable=False) as document:
        entries = [_exported_entry(item) for item in _read_outline(document)]
    target.write_text(
        json.dumps({"bookmarks": entries}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return BookmarksExportResult(output=str(target), count=len(entries))


def _read_bookmark_file(data_path: str) -> list:
    source = Path(data_path)
    if not source.is_file():
        raise OpError(ErrorCode.FILE_NOT_FOUND, f"no such file: {data_path}")
    try:
        payload = json.loads(source.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise _bookmark_file_error(f"not a bookmark file: {error}") from error
    entries = payload.get("bookmarks") if isinstance(payload, dict) else payload
    if not isinstance(entries, list):
        raise _bookmark_file_error("the file holds no bookmark list")
    return entries


def _imported_outline(
    document: pymupdf.Document, entries: list, replace: bool
) -> list[BookmarkItem]:
    items = _items_from_entries(entries, document.page_count)
    if not replace:
        items = _read_outline(document) + items
    return items


@op("bookmarks.parse", BookmarksParseParams)
def parse_bookmarks(params: BookmarksParseParams, progress: Progress) -> BookmarksResult:
    entries = _read_bookmark_file(params.data_path)
    with open_document(params.path, params.password, mutable=False) as document:
        items = _imported_outline(document, entries, params.replace)
    return BookmarksResult(items=items)


@op("bookmarks.import", BookmarksImportParams)
def import_bookmarks(params: BookmarksImportParams, progress: Progress) -> BookmarksGenerateResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    entries = _read_bookmark_file(params.data_path)
    with open_document(params.path, params.password) as document:
        kept = _kept_actions(document)
        items = _imported_outline(document, entries, params.replace)
        _validate_items(items, document.page_count, kept)
        _write_items(document, items, kept)
        progress.report(0.9, "progress.saving")
        saved = save_document(document, target)
    return BookmarksGenerateResult(**saved.model_dump(), items=items)
