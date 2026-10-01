from pathlib import Path

import pymupdf

from vivepdf.ops._comment_format import (
    DROPPED_KEYS,
    MAX_FDF_OBJECTS,
    SUBTYPE_TAGS,
    _annotation_name,
)
from vivepdf.ops._pdf_syntax import (
    PdfName,
    PdfRef,
    PdfStream,
    PdfString,
    is_page_object,
    load_object,
    read_objects,
    serialize,
    trailer_root,
)
from vivepdf.rpc.errors import ErrorCode, OpError


def _fdf_annotation(
    document: pymupdf.Document, xref: int, page_number: int, rewrite: object, numbers: dict
) -> dict | None:
    loaded = load_object(document, xref)
    if not isinstance(loaded, dict):
        return None
    body: dict[str, object] = {"Type": PdfName("Annot")}
    for key, value in loaded.items():
        if key not in DROPPED_KEYS and key != "Type":
            body[key] = rewrite(value)
    body["Page"] = page_number
    if "NM" not in body:
        body["NM"] = PdfString(_annotation_name(document, xref))
    reply = loaded.get("IRT")
    if isinstance(reply, PdfRef) and reply.number in numbers:
        body["IRT"] = PdfRef(numbers[reply.number])
    return body


def write_fdf(
    document: pymupdf.Document,
    source_name: str,
    target: Path,
    xrefs: set[int],
    companions: set[int] | None = None,
) -> int:
    companions = companions or set()
    selected = [
        (page.number, annot.xref)
        for page in document
        for annot in page.annots()
        if (annot.xref in xrefs or annot.xref in companions) and annot.type[1] in SUBTYPE_TAGS
    ]
    annotation_numbers = {xref: position + 2 for position, (_page, xref) in enumerate(selected)}
    numbers: dict[int, int] = {}
    pending: list[int] = []
    counter = [len(selected) + 2]

    def assign(source: int) -> int | None:
        if source in numbers:
            return numbers[source]
        if source in annotation_numbers or not 0 < source < document.xref_length():
            return None
        if len(numbers) >= MAX_FDF_OBJECTS or is_page_object(load_object(document, source)):
            return None
        numbers[source] = counter[0]
        counter[0] += 1
        pending.append(source)
        return numbers[source]

    def rewrite(value: object) -> object:
        if isinstance(value, PdfRef):
            number = assign(value.number)
            return PdfRef(number) if number is not None else None
        if isinstance(value, dict):
            return {key: rewrite(item) for key, item in value.items()}
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        return value

    bodies: dict[int, bytes] = {}
    written: list[int] = []
    counted = 0
    for page_number, xref in selected:
        body = _fdf_annotation(document, xref, page_number, rewrite, annotation_numbers)
        if body is None:
            continue
        bodies[annotation_numbers[xref]] = serialize(body)
        written.append(annotation_numbers[xref])
        counted += xref not in companions
    while pending:
        source = pending.pop()
        loaded = load_object(document, source)
        if isinstance(loaded, PdfStream):
            dictionary = rewrite(loaded.dictionary)
            dictionary["Length"] = len(loaded.data)
            bodies[numbers[source]] = (
                serialize(dictionary) + b"\nstream\n" + loaded.data + b"\nendstream"
            )
        else:
            bodies[numbers[source]] = serialize(rewrite(loaded))
    catalog = {
        "FDF": {
            "F": PdfString(source_name),
            "Annots": [PdfRef(number) for number in written],
        }
    }
    bodies[1] = serialize(catalog)
    with target.open("wb") as handle:
        handle.write(b"%FDF-1.2\n%\xe2\xe3\xcf\xd3\n")
        for number in sorted(bodies):
            handle.write(f"{number} 0 obj\n".encode("ascii") + bodies[number] + b"\nendobj\n")
        handle.write(b"trailer\n<< /Root 1 0 R >>\n%%EOF\n")
    return counted


def _resolve(value: object, objects: dict[int, object]) -> object:
    seen: set[int] = set()
    while isinstance(value, PdfRef) and value.number not in seen:
        seen.add(value.number)
        value = objects.get(value.number)
    return None if isinstance(value, PdfRef) else value


def _fdf_entries(data: bytes) -> tuple[dict[int, object], list[tuple[int | None, object]]]:
    objects = read_objects(data)
    root = trailer_root(data)
    catalog = objects.get(root.number) if root is not None else None
    if not isinstance(catalog, dict):
        catalog = next(
            (item for item in objects.values() if isinstance(item, dict) and "FDF" in item), None
        )
    fdf = _resolve(catalog.get("FDF"), objects) if isinstance(catalog, dict) else None
    if not isinstance(fdf, dict):
        raise OpError(ErrorCode.INVALID_PARAMS, "not an FDF file", {"reason": "notFdf"})
    annots = _resolve(fdf.get("Annots"), objects)
    entries: list[tuple[int | None, object]] = []
    for entry in annots if isinstance(annots, list) else []:
        if isinstance(entry, PdfRef):
            entries.append((entry.number, objects.get(entry.number)))
        else:
            entries.append((None, entry))
    return objects, entries


def _valid_rect(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(isinstance(item, int | float) and not isinstance(item, bool) for item in value)
    )
