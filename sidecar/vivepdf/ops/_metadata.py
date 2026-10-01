import contextlib

import pymupdf


def clear_metadata(document: pymupdf.Document, info: bool = True, xmp: bool = True) -> None:
    if info:
        with contextlib.suppress(Exception):
            document.set_metadata({})
    if xmp:
        with contextlib.suppress(Exception):
            document.del_xml_metadata()
