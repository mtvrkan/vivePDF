import json
import re
import sys
from pathlib import Path

import pymupdf
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature

from vivepdf.ops.comments import CommentsListParams, list_comments
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

NO_BREAK_SPACE = chr(0xA0)


def signatures(path: Path) -> list[dict]:
    with path.open("rb") as stream:
        reader = PdfFileReader(stream)
        found = []
        for signature in reader.embedded_signatures:
            status = validate_pdf_signature(signature)
            found.append(
                {
                    "field": signature.field_name,
                    "intact": status.intact,
                    "coverage": status.coverage.name,
                }
            )
        return found


def comments(path: Path, password: str | None) -> list[dict]:
    try:
        listed = list_comments(CommentsListParams(path=str(path), password=password), silent_progress())
    except OpError:
        return []
    by_xref = {item.xref: item for item in listed.items}
    return [
        {
            "content": item.content,
            "author": item.author,
            "state": item.state,
            "replyTo": by_xref[item.parent].content if item.parent in by_xref else None,
        }
        for item in listed.items
    ]


def pdfa_part(document: pymupdf.Document) -> str | None:
    found = re.search(r"pdfaid:part(?:>|=\")\s*(\d)", document.get_xml_metadata() or "")
    return found.group(1) if found else None


def figure_alts(document: pymupdf.Document) -> list[str]:
    alts = []
    for xref in range(1, document.xref_length()):
        try:
            if document.xref_get_key(xref, "S") != ("name", "/Figure"):
                continue
        except (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase):
            continue
        kind, value = document.xref_get_key(xref, "Alt")
        alts.append(value if kind == "string" else "")
    return alts


def visible(page: pymupdf.Page, box: tuple) -> list[float]:
    rect = pymupdf.Rect(box[:4]) * page.rotation_matrix
    return [round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1)]


def spans(page: pymupdf.Page) -> list[dict]:
    found = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", ()):
            for span in line["spans"]:
                if span["text"].strip():
                    found.append(
                        {
                            "text": span["text"].replace(NO_BREAK_SPACE, " "),
                            "size": round(span["size"], 1),
                            "bold": bool(span["flags"] & 16) or "bold" in span["font"].lower(),
                            "color": f"#{span['color']:06x}",
                            "box": visible(page, span["bbox"]),
                        }
                    )
    return found


def describe(path: Path, password: str | None) -> dict:
    document = pymupdf.open(path)
    encrypted = bool(document.needs_pass)
    if encrypted and not (password and document.authenticate(password)):
        return {"exists": True, "encrypted": True, "unlocked": False}
    pages = []
    for page in document:
        pages.append(
            {
                "text": page.get_text().replace(NO_BREAK_SPACE, " "),
                "rotation": page.rotation,
                "label": page.get_label(),
                "width": round(page.rect.width, 1),
                "height": round(page.rect.height, 1),
                "annotations": [annot.type[1] for annot in page.annots()],
                "images": len(page.get_images(full=True)),
                "drawings": len(page.get_drawings()),
                "links": [link.get("uri", "") for link in page.get_links()],
                "linkBoxes": [
                    [round(value, 1) for value in link["from"]] for link in page.get_links()
                ],
                "spans": spans(page),
                "imageBoxes": [
                    visible(page, info["bbox"])
                    for info in page.get_image_info()
                    if info["width"] > 1 and info["height"] > 1
                ],
            }
        )
    fields = {}
    signature_fields = 0
    for page in document:
        for widget in page.widgets():
            if widget.field_type == pymupdf.PDF_WIDGET_TYPE_SIGNATURE:
                signature_fields += 1
            else:
                fields[widget.field_name] = widget.field_value
    signatures_present = signature_fields > 0 and not encrypted
    return {
        "exists": True,
        "encrypted": encrypted,
        "unlocked": True,
        "bytes": path.stat().st_size,
        "pageCount": document.page_count,
        "pages": pages,
        "fields": fields,
        "signatureFields": signature_fields,
        "pdfaPart": pdfa_part(document),
        "signatures": signatures(path) if signatures_present else [],
        "comments": comments(path, password),
        "figureAlts": figure_alts(document),
        "attachments": document.embfile_names(),
        "layers": len(document.get_ocgs()),
    }


def main() -> None:
    path = Path(sys.argv[1])
    password = sys.argv[2] if len(sys.argv) > 2 else None
    result = describe(path, password) if path.is_file() else {"exists": False}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
