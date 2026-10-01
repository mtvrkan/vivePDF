from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pymupdf

from vivepdf.ops._document import unwrap_document


@contextmanager
def walking_page_tree(document: pymupdf.Document) -> Iterator[None]:
    pdf = pymupdf._as_pdf_document(unwrap_document(document))
    internal = pdf.m_internal
    previous = internal.use_page_tree_map
    internal.use_page_tree_map = 0
    try:
        yield
    finally:
        internal.use_page_tree_map = previous


def page_object_number(page: pymupdf.Page) -> int:
    return pymupdf.mupdf.pdf_to_num(pymupdf._as_pdf_page(page).obj())


def _font_dictionary(document: pymupdf.Document, page_xref: int) -> tuple[int, str] | None:
    kind, value = document.xref_get_key(page_xref, "Resources")
    if kind == "xref":
        holder, prefix = int(value.split()[0]), ""
    elif kind == "dict":
        holder, prefix = page_xref, "Resources/"
    else:
        return None
    kind, value = document.xref_get_key(holder, prefix + "Font")
    if kind == "xref":
        return int(value.split()[0]), ""
    if kind == "null":
        document.xref_set_key(holder, prefix + "Font", "<<>>")
        return holder, prefix + "Font/"
    if kind == "dict":
        return holder, prefix + "Font/"
    return None


class SharedFonts:
    def __init__(self, document: pymupdf.Document) -> None:
        self._document = document
        self._xrefs: dict[str, int] = {}

    def _register(
        self, page: pymupdf.Page, page_xref: int, name: str, font_file: Path
    ) -> int | None:
        xref = self._xrefs.get(name)
        if xref is None:
            xref = page.insert_font(fontname=name, fontfile=str(font_file))
            self._xrefs[name] = xref
            return xref
        found = _font_dictionary(self._document, page_xref)
        if found is None:
            return None
        holder, key = found
        kind, value = self._document.xref_get_key(holder, key + name)
        if kind == "null":
            self._document.xref_set_key(holder, key + name, f"{xref} 0 R")
            return xref
        if kind == "xref":
            return int(value.split()[0])
        return None

    @contextmanager
    def using(
        self, page: pymupdf.Page, page_xref: int, name: str, font_file: Path
    ) -> Iterator[None]:
        xref = self._register(page, page_xref, name, font_file)
        if xref is None:
            yield
            return
        entry = (xref, "", "", "", name, "")
        page.get_fonts = lambda full=False: [entry]
        try:
            yield
        finally:
            del page.get_fonts
