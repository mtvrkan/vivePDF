from collections.abc import Iterator
from typing import Any

import pymupdf

MAX_TREE_DEPTH = 32
READ_CHUNK = 4096


def name_tree_values(document: pymupdf.Document, path: str) -> Iterator[Any]:
    mupdf = pymupdf.mupdf
    seen: set[int] = set()

    def walk(node: Any, depth: int) -> Iterator[Any]:
        if depth > MAX_TREE_DEPTH or not mupdf.pdf_is_dict(node):
            return
        if mupdf.pdf_is_indirect(node):
            number = mupdf.pdf_to_num(node)
            if number in seen:
                return
            seen.add(number)
        names = mupdf.pdf_dict_gets(node, "Names")
        if mupdf.pdf_is_array(names):
            for index in range(1, mupdf.pdf_array_len(names), 2):
                yield mupdf.pdf_array_get(names, index)
        kids = mupdf.pdf_dict_gets(node, "Kids")
        if mupdf.pdf_is_array(kids):
            for index in range(mupdf.pdf_array_len(kids)):
                yield from walk(mupdf.pdf_array_get(kids, index), depth + 1)

    pdf = pymupdf._as_pdf_document(document)
    root = mupdf.pdf_dict_gets(mupdf.pdf_trailer(pdf), "Root")
    yield from walk(mupdf.pdf_dict_getp(root, path), 0)


def stream_prefix(stream_object: Any, limit: int) -> bytes | None:
    mupdf = pymupdf.mupdf
    stream = mupdf.pdf_open_stream(stream_object)
    window = mupdf.fz_open_null_filter(stream, limit + 1, mupdf.fz_tell(stream))
    data = mupdf.fz_buffer_extract_copy(mupdf.fz_read_all(window, READ_CHUNK))
    return None if len(data) > limit else data
