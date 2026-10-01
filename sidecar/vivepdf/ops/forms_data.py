import xml.etree.ElementTree as ElementTree
from pathlib import Path
from typing import Any, Literal

import pymupdf
from pydantic import Field

from vivepdf.ops._document import open_document
from vivepdf.ops._form_appearance import (
    UnicodeAppearance,
    is_multi_select,
    selected_options,
)
from vivepdf.ops._form_calc import recalculate
from vivepdf.ops._name_syntax import pdf_name
from vivepdf.ops._output import prepare_data_output, prepare_output
from vivepdf.ops._pdf_syntax import PdfRef, PdfSyntaxReader, read_objects, trailer_root
from vivepdf.ops.forms import (
    FIELD_TYPES,
    FillReport,
    close_form,
    fill_field,
    form_widgets,
    open_form,
    save_form,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

XFDF_NAMESPACE = "http://ns.adobe.com/xfdf/"
MAX_DATA_BYTES = 16 * 1024 * 1024
FILLABLE = ("text", "checkbox", "radio", "combobox", "listbox")


class FormDataExportParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    format: Literal["xfdf", "fdf"] = "xfdf"
    overwrite: bool = False
    values: dict[str, str | bool | list[str]] | None = None


class FormDataExportResult(RpcModel):
    output: str
    fields: int


class FormDataImportParams(RpcModel):
    path: str
    password: str | None = None
    data_path: str
    output: str
    overwrite: bool = False
    flatten: bool = False
    language: str | None = Field(default=None, max_length=16)


class FormDataImportResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    filled: int
    unmatched: list[str]
    recalculated: int = 0
    calc_skipped: int = 0


def _collect_values(document: pymupdf.Document) -> dict[str, str | list[str]]:
    values: dict[str, str | list[str]] = {}
    for page in document:
        for widget in page.widgets():
            name = widget.field_name
            kind = FIELD_TYPES.get(widget.field_type, "other")
            if not name or kind not in FILLABLE:
                continue
            raw = widget.field_value
            if is_multi_select(widget):
                values[name] = selected_options(document, widget)
                continue
            if kind in ("checkbox", "radio"):
                if raw is True:
                    state = str(widget.on_state() or "Yes")
                elif raw in (None, False, "", "Off"):
                    state = "Off"
                else:
                    state = str(raw)
                if kind == "radio" and state == "Off":
                    values.setdefault(name, "Off")
                else:
                    values[name] = state
            elif isinstance(raw, list | tuple):
                values[name] = [str(item) for item in raw]
            else:
                values[name] = "" if raw is None else str(raw)
    return values


def _xfdf_bytes(values: dict[str, str | list[str]], source_name: str) -> bytes:
    root = ElementTree.Element("xfdf", {"xmlns": XFDF_NAMESPACE, "xml:space": "preserve"})
    fields = ElementTree.SubElement(root, "fields")
    for name, value in values.items():
        field = ElementTree.SubElement(fields, "field", {"name": name})
        for item in value if isinstance(value, list) else [value]:
            ElementTree.SubElement(field, "value").text = item
    ElementTree.SubElement(root, "f", {"href": source_name})
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ElementTree.tostring(
        root, encoding="utf-8", xml_declaration=False
    )


def _pdf_string(text: str) -> bytes:
    if text.isascii():
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        escaped = escaped.replace("\r", "\\r").replace("\n", "\\n")
        return b"(" + escaped.encode("ascii") + b")"
    return b"<FEFF" + text.encode("utf-16-be").hex().upper().encode("ascii") + b">"


def _fdf_bytes(values: dict[str, str | list[str]], states: set[str], source_name: str) -> bytes:
    entries = []
    for name, value in values.items():
        if isinstance(value, list):
            rendered = b"[" + b" ".join(_pdf_string(item) for item in value) + b"]"
        elif name in states:
            rendered = pdf_name(value).encode("ascii")
        else:
            rendered = _pdf_string(value)
        entries.append(b"<< /T " + _pdf_string(name) + b" /V " + rendered + b" >>")
    body = (
        b"1 0 obj\n<< /FDF << /F "
        + _pdf_string(source_name)
        + b" /Fields [\n"
        + b"\n".join(entries)
        + b"\n] >> >>\nendobj\n"
    )
    return b"%FDF-1.2\n%\xe2\xe3\xcf\xd3\n" + body + b"trailer\n<< /Root 1 0 R >>\n%%EOF\n"


@op("forms.export_data", FormDataExportParams)
def export_data(params: FormDataExportParams, progress: Progress) -> FormDataExportResult:
    target = prepare_data_output(params.output, params.format, params.overwrite)
    with open_document(params.path, params.password) as document:
        if not document.is_form_pdf:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "document has no form fields", {"reason": "noForm"}
            )
        progress.report(0.3, "progress.analyzing")
        values = _collect_values(document)
        states = {
            widget.field_name
            for page in document
            for widget in page.widgets()
            if FIELD_TYPES.get(widget.field_type) in ("checkbox", "radio")
        }
        radios = {
            widget.field_name
            for page in document
            for widget in page.widgets()
            if FIELD_TYPES.get(widget.field_type) == "radio"
        }
        on_states = {
            widget.field_name: str(widget.on_state() or "Yes")
            for page in document
            for widget in page.widgets()
            if FIELD_TYPES.get(widget.field_type) == "checkbox"
        }
    for name, value in (params.values or {}).items():
        if name not in values:
            continue
        if name in radios:
            if value in ("", False):
                values[name] = "Off"
            elif isinstance(value, str):
                values[name] = value
        elif isinstance(value, bool):
            values[name] = on_states.get(name, "Yes") if value else "Off"
        else:
            values[name] = value
    if not values:
        raise OpError(ErrorCode.INVALID_PARAMS, "document has no form fields", {"reason": "noForm"})
    source_name = Path(params.path).name
    data = (
        _xfdf_bytes(values, source_name)
        if params.format == "xfdf"
        else _fdf_bytes(values, states, source_name)
    )
    target.write_bytes(data)
    return FormDataExportResult(output=str(target), fields=len(values))


def _read_xfdf(data: bytes) -> dict[str, Any]:
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "form data file is not valid XFDF", {"reason": "badData"}
        )
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "form data file is not valid XFDF", {"reason": "badData"}
        ) from error
    values: dict[str, Any] = {}

    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    def walk(element: ElementTree.Element, prefix: str) -> None:
        for child in element:
            if local(child.tag) != "field":
                continue
            name = child.get("name") or ""
            full = f"{prefix}.{name}" if prefix else name
            items = [item.text or "" for item in child if local(item.tag) == "value"]
            if items:
                values[full] = items if len(items) > 1 else items[0]
            walk(child, full)

    for section in root:
        if local(section.tag) == "fields":
            walk(section, "")
    return values


def _fdf_catalog(data: bytes) -> tuple[Any, dict[int, Any]]:
    objects = read_objects(data)
    root = trailer_root(data)
    if root is not None and isinstance(objects.get(root.number), dict):
        return objects[root.number], objects
    marker = data.find(b"/FDF")
    start = data.rfind(b"<<", 0, marker) if marker >= 0 else -1
    if start < 0:
        return None, objects
    return PdfSyntaxReader(data, start).value(), objects


def _read_fdf(data: bytes) -> dict[str, Any]:
    try:
        catalog, objects = _fdf_catalog(data)
    except (ValueError, IndexError) as error:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "form data file is not valid FDF", {"reason": "badData"}
        ) from error

    def resolve(value: Any) -> Any:
        seen: set[int] = set()
        while isinstance(value, PdfRef) and value.number not in seen:
            seen.add(value.number)
            value = objects.get(value.number)
        return None if isinstance(value, PdfRef) else value

    fdf = resolve(catalog.get("FDF")) if isinstance(catalog, dict) else None
    fields = resolve(fdf.get("Fields")) if isinstance(fdf, dict) else None
    if not isinstance(fields, list):
        raise OpError(
            ErrorCode.INVALID_PARAMS, "form data file is not valid FDF", {"reason": "badData"}
        )
    values: dict[str, Any] = {}

    def text(value: Any) -> str:
        if isinstance(value, float):
            return f"{value:g}"
        return str(value)

    def walk(items: list, prefix: str, depth: int) -> None:
        if depth > 32:
            return
        for entry in items:
            item = resolve(entry)
            if not isinstance(item, dict):
                continue
            name = str(resolve(item.get("T")) or "")
            full = f"{prefix}.{name}" if prefix and name else (name or prefix)
            if "V" in item and full:
                value = resolve(item["V"])
                if isinstance(value, list):
                    values[full] = [text(resolve(part)) for part in value]
                elif value is not None:
                    values[full] = text(value)
            kids = resolve(item.get("Kids"))
            if isinstance(kids, list):
                walk(kids, full, depth + 1)

    walk(fields, "", 0)
    return values


def _coerce(widget: pymupdf.Widget, value: Any) -> Any:
    kind = FIELD_TYPES.get(widget.field_type, "other")
    if isinstance(value, list):
        if is_multi_select(widget):
            return [str(item) for item in value]
        value = value[0] if value else ""
    text = str(value)
    if kind == "checkbox":
        return text not in ("", "Off", "off", "false", "0")
    if kind == "radio":
        return text
    return text


@op("forms.import_data", FormDataImportParams)
def import_data(params: FormDataImportParams, progress: Progress) -> FormDataImportResult:
    source = Path(params.data_path)
    if not source.is_file():
        raise OpError(
            ErrorCode.FILE_NOT_FOUND, f"file not found: {source.name}", {"path": params.data_path}
        )
    if source.stat().st_size > MAX_DATA_BYTES:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "form data file is too large", {"reason": "badData"}
        )
    target = prepare_output(params.output, [params.path], params.overwrite)
    data = source.read_bytes()
    stripped = data.lstrip(b"\xef\xbb\xbf \t\r\n")
    values = _read_fdf(data) if stripped.startswith(b"%FDF") else _read_xfdf(stripped)
    if not values:
        raise OpError(
            ErrorCode.INVALID_PARAMS, "form data file holds no values", {"reason": "noValues"}
        )
    filled = 0
    document, partial = open_form(params.path, params.password, target)
    try:
        if not document.is_form_pdf:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "document has no form fields", {"reason": "noForm"}
            )
        if partial is not None and params.flatten:
            raise OpError(
                ErrorCode.INVALID_PARAMS,
                "a signed form cannot be flattened without breaking its signatures",
                {"reason": "signedFlatten"},
            )
        appearance = UnicodeAppearance(document)
        report = FillReport()
        _pages, groups = form_widgets(document)
        matched = [name for name in values if name in groups]
        for position, name in enumerate(matched):
            progress.check_cancelled()
            widgets = groups[name]
            if fill_field(widgets, _coerce(widgets[0], values[name]), appearance, report):
                filled += 1
            progress.report((position + 1) / len(matched), "progress.filling")
        calculation = recalculate(document, appearance, params.language)
        appearance.finish()
        if params.flatten:
            document.bake(annots=False, widgets=True)
        saved, _kept = save_form(document, target, partial)
    finally:
        close_form(document, partial)
    return FormDataImportResult(
        output=saved.output,
        page_count=saved.page_count,
        bytes=saved.bytes,
        filled=filled,
        unmatched=sorted(name for name in values if name not in matched),
        recalculated=calculation.recalculated,
        calc_skipped=calculation.skipped,
    )
