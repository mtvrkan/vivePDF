import re
import shutil
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pymupdf
from pydantic import Field

from vivepdf.ops._document import forget_document, open_document
from vivepdf.ops._form_appearance import (
    UnicodeAppearance,
    choice_pairs,
    field_holder,
    is_multi_select,
    is_signed_field,
    selected_options,
)
from vivepdf.ops._form_calc import recalculate
from vivepdf.ops._inplace import INCREMENTAL_SAVE_ERRORS
from vivepdf.ops._name_syntax import pdf_name
from vivepdf.ops._output import OutputResult, prepare_output, replace_patiently, save_document
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op

FIELD_TYPES: dict[int, str] = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "combobox",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "listbox",
    pymupdf.PDF_WIDGET_TYPE_BUTTON: "button",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "signature",
}
UNFILLABLE = ("button", "signature", "other")
OFF_WORDS = ("", "off", "false", "0")
CHOICE_IS_EDITABLE = 262144


class FieldWidget(RpcModel):
    page: int
    visible_rect: list[float]
    state: str | None = None


class FormField(RpcModel):
    name: str
    kind: str
    page: int
    value: str | bool | list[str] | None
    options: list[str]
    label: str | None
    read_only: bool
    required: bool
    multiline: bool
    rect: list[float]
    visible_rect: list[float] = Field(default_factory=list)
    multi_select: bool = False
    option_labels: list[str] = Field(default_factory=list)
    max_length: int | None = None
    editable: bool = False
    widgets: list[FieldWidget] = Field(default_factory=list)


class FieldsParams(RpcModel):
    path: str
    password: str | None = None


class FieldBox(RpcModel):
    name: str
    page: int
    left: float
    top: float
    width: float
    height: float


class FieldsResult(RpcModel):
    fields: list[FormField]
    is_form: bool
    xfa: bool
    signed: bool = False
    boxes: list[FieldBox] = Field(default_factory=list)


def field_box(page: pymupdf.Page, page_number: int, widget: pymupdf.Widget) -> FieldBox | None:
    crop = page.cropbox
    if crop.width <= 0 or crop.height <= 0 or widget.rect.is_empty:
        return None
    return FieldBox(
        name=widget.field_name,
        page=page_number,
        left=widget.rect.x0 / crop.width,
        top=widget.rect.y0 / crop.height,
        width=widget.rect.width / crop.width,
        height=widget.rect.height / crop.height,
    )


def _field_value(widget: pymupdf.Widget) -> str | bool | list[str] | None:
    if is_multi_select(widget):
        return selected_options(widget.parent.parent, widget)
    value = widget.field_value
    if widget.field_type in (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON):
        if isinstance(value, bool):
            return value
        return bool(value) and str(value).lower() not in ("off", "false", "")
    if value is None:
        return None
    return str(value)


def _kind(widget: pymupdf.Widget) -> str:
    return FIELD_TYPES.get(widget.field_type, "other")


def _is_on(document: pymupdf.Document, widget: pymupdf.Widget) -> bool:
    kind, value = document.xref_get_key(widget.xref, "AS")
    return kind == "name" and value not in ("/Off", "")


def _radio_states(widgets: list[pymupdf.Widget]) -> list[str]:
    states: list[str] = []
    for widget in widgets:
        state = str(widget.on_state())
        if state not in states:
            states.append(state)
    return states


def _radio_labels(document: pymupdf.Document, widgets: list[pymupdf.Widget]) -> list[str]:
    from vivepdf.ops._pdf_syntax import parse_value

    states = _radio_states(widgets)
    holder = field_holder(document, widgets[0].xref)
    kind, value = document.xref_get_key(holder, "Opt")
    kids_kind, kids = document.xref_get_key(holder, "Kids")
    if kind != "array" or kids_kind != "array":
        return states
    try:
        labels = parse_value(value.encode("latin-1", errors="replace"))
    except (ValueError, IndexError):
        return states
    order = [int(number) for number in re.findall(r"(\d+)\s+\d+\s+R", kids)]
    if not isinstance(labels, list) or len(labels) != len(order):
        return states
    by_state: dict[str, str] = {}
    for widget in widgets:
        if widget.xref in order and isinstance(labels[order.index(widget.xref)], str):
            by_state.setdefault(str(widget.on_state()), labels[order.index(widget.xref)])
    return [by_state.get(state, state) for state in states]


def form_widgets(
    document: pymupdf.Document,
) -> tuple[list[pymupdf.Page], dict[str, list[pymupdf.Widget]]]:
    pages: list[pymupdf.Page] = []
    groups: dict[str, list[pymupdf.Widget]] = {}
    for page in document:
        pages.append(page)
        for widget in page.widgets():
            if widget.field_name:
                groups.setdefault(widget.field_name, []).append(widget)
    return pages, groups


def visible_rect(widget: pymupdf.Widget) -> list[float]:
    turned = widget.rect * widget.parent.rotation_matrix
    turned.normalize()
    return [turned.x0, turned.y0, turned.x1, turned.y1]


def _field_widget(widget: pymupdf.Widget, kind: str) -> FieldWidget:
    state = str(widget.on_state()) if kind in ("radio", "checkbox") else None
    return FieldWidget(
        page=widget.parent.number + 1, visible_rect=visible_rect(widget), state=state
    )


def describe_field(
    document: pymupdf.Document, name: str, widgets: list[pymupdf.Widget], page: int
) -> FormField:
    first = widgets[0]
    kind = _kind(first)
    options: list[str] = []
    labels: list[str] = []
    value = _field_value(first)
    if kind == "radio":
        options = _radio_states(widgets)
        labels = _radio_labels(document, widgets)
        chosen = [str(widget.on_state()) for widget in widgets if _is_on(document, widget)]
        value = chosen[0] if chosen else None
    elif kind in ("combobox", "listbox"):
        pairs = choice_pairs(first)
        options = [export for export, _label in pairs]
        labels = [label for _export, label in pairs]
    elif kind == "checkbox":
        value = any(_is_on(document, widget) for widget in widgets)
    max_length = int(first.text_maxlen or 0) if kind == "text" else 0
    return FormField(
        name=name,
        kind=kind,
        page=page,
        value=value,
        options=options,
        option_labels=labels,
        label=first.field_label or None,
        read_only=bool(first.field_flags & pymupdf.PDF_FIELD_IS_READ_ONLY),
        required=bool(first.field_flags & pymupdf.PDF_FIELD_IS_REQUIRED),
        multiline=bool(first.field_flags & pymupdf.PDF_TX_FIELD_IS_MULTILINE)
        if kind == "text"
        else False,
        rect=[first.rect.x0, first.rect.y0, first.rect.x1, first.rect.y1],
        visible_rect=visible_rect(first),
        multi_select=is_multi_select(first),
        max_length=max_length or None,
        editable=kind == "combobox" and bool(first.field_flags & CHOICE_IS_EDITABLE),
        widgets=[_field_widget(widget, kind) for widget in widgets],
    )


def has_xfa(document: pymupdf.Document) -> bool:
    try:
        catalog = document.pdf_catalog()
        if document.xref_get_key(catalog, "AcroForm")[0] == "null":
            return False
        return document.xref_get_key(catalog, "AcroForm/XFA")[0] != "null"
    except Exception:  # noqa: BLE001
        return False


def is_signed_document(document: pymupdf.Document) -> bool:
    for page in document:
        for widget in page.widgets(types=[pymupdf.PDF_WIDGET_TYPE_SIGNATURE]):
            if is_signed_field(document, widget):
                return True
    return False


@op("forms.fields", FieldsParams)
def list_fields(params: FieldsParams, progress: Progress) -> FieldsResult:
    fields: list[FormField] = []
    with open_document(params.path, params.password) as document:
        pages: list[pymupdf.Page] = []
        groups: dict[str, list[pymupdf.Widget]] = {}
        first_page: dict[str, int] = {}
        boxes: list[FieldBox] = []
        for index, page in enumerate(document):
            progress.check_cancelled()
            pages.append(page)
            for widget in page.widgets():
                name = widget.field_name
                if not name:
                    continue
                groups.setdefault(name, []).append(widget)
                first_page.setdefault(name, index + 1)
                box = field_box(page, index + 1, widget)
                if box is not None:
                    boxes.append(box)
        for name, widgets in groups.items():
            fields.append(describe_field(document, name, widgets, first_page[name]))
        signed = any(
            _kind(widgets[0]) == "signature" and is_signed_field(document, widgets[0])
            for widgets in groups.values()
        )
        return FieldsResult(
            fields=fields,
            is_form=bool(document.is_form_pdf),
            xfa=has_xfa(document),
            signed=signed,
            boxes=boxes,
        )


class FillParams(RpcModel):
    path: str
    password: str | None = None
    output: str | None = None
    in_place: bool = False
    overwrite: bool = False
    values: dict[str, Any] = Field(default_factory=dict)
    flatten: bool = False
    language: str | None = Field(default=None, max_length=16)


class FillResult(RpcModel):
    output: str
    page_count: int
    bytes: int
    filled: int
    recalculated: int = 0
    calc_skipped: int = 0
    truncated: list[str] = Field(default_factory=list)
    missing_glyphs: list[str] = Field(default_factory=list)
    xfa_removed: bool = False
    signatures_kept: bool = False


@dataclass
class FillReport:
    truncated: list[str] = field(default_factory=list)


def _not_an_option(name: str, value: str) -> OpError:
    return OpError(
        ErrorCode.INVALID_PARAMS,
        f"'{value}' is not an option of {name}",
        {"reason": "notAnOption", "field": name, "value": value},
    )


def _resolve_choice(widget: pymupdf.Widget, text: str, editable: bool) -> str:
    pairs = choice_pairs(widget)
    if not pairs:
        return text
    for export, _label in pairs:
        if export == text:
            return export
    for export, label in pairs:
        if label == text:
            return export
    folded = text.casefold()
    for export, label in pairs:
        if folded in (export.casefold(), label.casefold()):
            return export
    if editable:
        return text
    raise _not_an_option(str(widget.field_name), text)


def _resolve_radio(name: str, widgets: list[pymupdf.Widget], value: Any) -> str | None:
    states = _radio_states(widgets)
    if value is None or value is False:
        return None
    if value is True:
        if len(states) == 1:
            return states[0]
        raise _not_an_option(name, "true")
    text = str(value[0] if isinstance(value, list | tuple) and value else value)
    if text.strip().casefold() in ("", "off"):
        return None
    if text in states:
        return text
    for state in states:
        if state.casefold() == text.strip().casefold():
            return state
    labels = _radio_labels(widgets[0].parent.parent, widgets)
    for state, label in zip(states, labels, strict=True):
        if label.casefold() == text.strip().casefold():
            return state
    raise _not_an_option(name, text)


def _fill_radio(widgets: list[pymupdf.Widget], state: str | None) -> None:
    document = widgets[0].parent.parent
    holder = field_holder(document, widgets[0].xref)
    if state is not None:
        chosen = next(widget for widget in widgets if str(widget.on_state()) == state)
        chosen.field_value = True
        chosen.update()
    for widget in widgets:
        on = state is not None and str(widget.on_state()) == state
        document.xref_set_key(widget.xref, "AS", pdf_name(state) if on else "/Off")
    document.xref_set_key(holder, "V", pdf_name(state) if state is not None else "/Off")


def _is_checked(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().casefold() not in OFF_WORDS
    if isinstance(value, list | tuple):
        return bool(value) and _is_checked(value[0])
    return bool(value)


def _has_labels(widget: pymupdf.Widget) -> bool:
    return any(export != label for export, label in choice_pairs(widget))


def _apply_value(widget: pymupdf.Widget, value: Any, appearance: UnicodeAppearance) -> None:
    kind = _kind(widget)
    document = widget.parent.parent
    holder = field_holder(document, widget.xref)
    if kind == "checkbox":
        widget.field_value = bool(value)
    elif kind in ("combobox", "listbox"):
        chosen: list[str] = value
        if is_multi_select(widget) and chosen:
            _set_multiple(widget, chosen, appearance)
            return
        widget.field_value = chosen[0] if chosen else ""
        if not chosen:
            document.xref_set_key(holder, "V", "()")
        if is_multi_select(widget):
            widget.update()
            document.xref_set_key(holder, "I", "null")
    else:
        widget.field_value = str(value)
        if not value:
            document.xref_set_key(holder, "V", "()")
    widget.update()
    appearance.redraw(widget, force=kind in ("combobox", "listbox") and _has_labels(widget))


def _choices(value: Any) -> list[str]:
    if value is None or value is False:
        return []
    items = value if isinstance(value, list | tuple) else [value]
    chosen: list[str] = []
    for item in items:
        text = str(item)
        if text and text not in chosen:
            chosen.append(text)
    return chosen


def _set_multiple(widget: pymupdf.Widget, chosen: list[str], appearance: UnicodeAppearance) -> None:
    document = widget.parent.parent
    options = [export for export, _label in choice_pairs(widget)]
    widget.field_value = chosen[0]
    widget.update()
    holder = field_holder(document, widget.xref)
    listing = " ".join(pymupdf.get_pdf_str(text) for text in chosen)
    document.xref_set_key(holder, "V", f"[{listing}]")
    indices = sorted(options.index(text) for text in chosen if text in options)
    if indices:
        document.xref_set_key(holder, "I", "[" + " ".join(str(index) for index in indices) + "]")
    appearance.redraw(widget, force=True)


def fill_field(
    widgets: list[pymupdf.Widget],
    value: Any,
    appearance: UnicodeAppearance,
    report: FillReport,
) -> bool:
    first = widgets[0]
    kind = _kind(first)
    name = str(first.field_name)
    if kind in UNFILLABLE or first.field_flags & pymupdf.PDF_FIELD_IS_READ_ONLY:
        return False
    if kind == "radio":
        _fill_radio(widgets, _resolve_radio(name, widgets, value))
        return True
    if kind == "checkbox":
        resolved: Any = _is_checked(value)
    elif kind in ("combobox", "listbox"):
        editable = kind == "combobox" and bool(first.field_flags & CHOICE_IS_EDITABLE)
        chosen = [_resolve_choice(first, text, editable) for text in _choices(value)]
        resolved = list(dict.fromkeys(chosen)) if is_multi_select(first) else chosen[:1]
    else:
        resolved = "" if value is None else str(value)
        limit = int(first.text_maxlen or 0)
        if limit and len(resolved) > limit:
            resolved = resolved[:limit]
            report.truncated.append(name)
    for widget in widgets:
        _apply_value(widget, resolved, appearance)
    return True


def remove_xfa(document: pymupdf.Document) -> bool:
    if not has_xfa(document):
        return False
    acroform = document.xref_get_key(document.pdf_catalog(), "AcroForm")
    if acroform[0] == "xref":
        document.xref_set_key(int(acroform[1].split()[0]), "XFA", "null")
    else:
        document.xref_set_key(document.pdf_catalog(), "AcroForm/XFA", "null")
    return True


def _partial_path(target: Path) -> Path:
    return target.parent / f".vivepdf-{uuid.uuid4().hex[:12]}.part"


def open_form(
    path: str, password: str | None, target: Path, copy: bool = False
) -> tuple[pymupdf.Document, Path | None]:
    document = open_document(path, password)
    if not copy and not is_signed_document(document):
        return document, None
    document.close()
    partial = _partial_path(target)
    shutil.copyfile(path, partial)
    try:
        return open_document(str(partial), password), partial
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def save_form(
    document: pymupdf.Document, target: Path, partial: Path | None
) -> tuple[OutputResult, bool]:
    if partial is None or not document.can_save_incrementally():
        return save_document(document, target), False
    try:
        document.save(str(partial), incremental=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)
    except INCREMENTAL_SAVE_ERRORS as error:
        print(f"[forms] incremental save failed, rewriting: {error}", file=sys.stderr)
        return save_document(document, target), False
    page_count = document.page_count
    document.close()
    if target.exists():
        forget_document(str(target))
    replace_patiently(partial, target)
    return OutputResult(
        output=str(target), page_count=page_count, bytes=target.stat().st_size
    ), True


def close_form(document: pymupdf.Document, partial: Path | None) -> None:
    if not document.is_closed:
        document.close()
    if partial is not None:
        partial.unlink(missing_ok=True)


def _refuse_signed_flatten(partial: Path | None, flatten: bool) -> None:
    if partial is not None and flatten:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "a signed form cannot be flattened without breaking its signatures",
            {"reason": "signedFlatten"},
        )


def _fill_target(params: FillParams) -> Path:
    if params.in_place and params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "give either an output file or in-place, not both",
            {"reason": "outputAndInPlace"},
        )
    if params.in_place:
        return Path(params.path).resolve()
    if not params.output:
        raise OpError(
            ErrorCode.INVALID_PARAMS,
            "an output file or in-place is required",
            {"reason": "outputRequired"},
        )
    return prepare_output(params.output, [params.path], params.overwrite)


@op("forms.fill", FillParams)
def fill_fields(params: FillParams, progress: Progress) -> FillResult:
    target = _fill_target(params)
    report = FillReport()
    filled = 0
    document, partial = open_form(params.path, params.password, target, copy=params.in_place)
    try:
        if not document.is_form_pdf:
            raise OpError(
                ErrorCode.INVALID_PARAMS, "document has no form fields", {"reason": "noForm"}
            )
        signed = partial is not None and (not params.in_place or is_signed_document(document))
        _refuse_signed_flatten(partial if signed else None, params.flatten)
        appearance = UnicodeAppearance(document)
        _pages, groups = form_widgets(document)
        names = [name for name in params.values if name in groups]
        for position, name in enumerate(names):
            progress.check_cancelled()
            if fill_field(groups[name], params.values[name], appearance, report):
                filled += 1
            progress.report((position + 1) / max(1, len(names)), "progress.filling")
        calculation = recalculate(document, appearance, params.language)
        appearance.finish()
        xfa_removed = not signed and remove_xfa(document)
        if params.flatten:
            document.bake(annots=False, widgets=True)
        saved, incremental = save_form(document, target, partial)
        kept = signed and incremental
        return FillResult(
            output=saved.output,
            page_count=saved.page_count,
            bytes=saved.bytes,
            filled=filled,
            recalculated=calculation.recalculated,
            calc_skipped=calculation.skipped,
            truncated=report.truncated,
            missing_glyphs=sorted(appearance.missing),
            xfa_removed=xfa_removed,
            signatures_kept=kept,
        )
    finally:
        close_form(document, partial)


class ResetParams(RpcModel):
    path: str
    password: str | None = None
    output: str
    overwrite: bool = False
    language: str | None = Field(default=None, max_length=16)


def default_value(document: pymupdf.Document, widget: pymupdf.Widget) -> Any:
    from vivepdf.ops._pdf_syntax import parse_value

    kind, value = document.xref_get_key(field_holder(document, widget.xref), "DV")
    if kind == "name":
        return value[1:]
    if kind == "string":
        return value
    if kind == "array":
        try:
            items = parse_value(value.encode("latin-1", errors="replace"))
        except (ValueError, IndexError):
            return None
        return [str(item) for item in items if isinstance(item, str)]
    return None


def reset_field(
    widgets: list[pymupdf.Widget], appearance: UnicodeAppearance, report: FillReport
) -> bool:
    document = widgets[0].parent.parent
    default = default_value(document, widgets[0])
    try:
        return fill_field(widgets, default, appearance, report)
    except OpError:
        return fill_field(widgets, None, appearance, report)


@op("forms.reset", ResetParams)
def reset_fields(params: ResetParams, progress: Progress) -> OutputResult:
    target = prepare_output(params.output, [params.path], params.overwrite)
    report = FillReport()
    document, partial = open_form(params.path, params.password, target)
    try:
        appearance = UnicodeAppearance(document)
        _pages, groups = form_widgets(document)
        for widgets in groups.values():
            progress.check_cancelled()
            reset_field(widgets, appearance, report)
        recalculate(document, appearance, params.language)
        appearance.finish()
        saved, _kept = save_form(document, target, partial)
        return saved
    finally:
        close_form(document, partial)
