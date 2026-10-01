from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._actions import parse_object, risky_count, serialized, without_risky
from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.progress import silent_progress

MARKER = "SECRETSCRIPT"


def _objects_text(path: Path) -> str:
    with pymupdf.open(path) as document:
        return "\n".join(
            document.xref_object(xref, compressed=True) for xref in range(1, document.xref_length())
        )


def _with_link(document: pymupdf.Document) -> tuple[pymupdf.Page, int]:
    page = document.new_page()
    page.insert_text((72, 72), "Body")
    page.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 60, 200, 80), "uri": "https://a"}
    )
    page = document.reload_page(page)
    return page, page.get_links()[0]["xref"]


def _save(document: pymupdf.Document, tmp_path: Path, name: str) -> Path:
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def _clean(path: Path, tmp_path: Path) -> tuple[int, int, Path]:
    before = inspect(InspectParams(path=str(path)), silent_progress()).javascript
    result = sanitize(
        SanitizeParams(path=str(path), output=str(tmp_path / f"clean-{path.name}")),
        silent_progress(),
    )
    after = inspect(InspectParams(path=result.output), silent_progress()).javascript
    return before, after, Path(result.output)


def test_inline_javascript_on_a_link_is_found_and_removed(tmp_path: Path) -> None:
    document = pymupdf.open()
    _, link = _with_link(document)
    document.xref_set_key(link, "A", f"<</S/JavaScript/JS(app.alert\\({MARKER}\\))>>")
    before, after, output = _clean(_save(document, tmp_path, "link.pdf"), tmp_path)
    assert before == 1
    assert after == 0
    assert MARKER not in _objects_text(output)
    with pymupdf.open(output) as cleaned:
        assert "Body" in cleaned[0].get_text()


def test_inline_launch_on_a_widget_is_found_and_removed(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_BUTTON
    widget.field_name = "run"
    widget.rect = pymupdf.Rect(72, 72, 160, 100)
    page.add_widget(widget)
    xref = next(page.widgets()).xref
    document.xref_set_key(xref, "A", f"<</S/Launch/F({MARKER}.exe)>>")
    before, after, output = _clean(_save(document, tmp_path, "widget.pdf"), tmp_path)
    assert before == 1
    assert after == 0
    assert MARKER not in _objects_text(output)


def test_a_parent_field_script_is_found_and_removed(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    widget = pymupdf.Widget()
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.field_name = "child"
    widget.rect = pymupdf.Rect(72, 72, 200, 100)
    page.add_widget(widget)
    child = next(page.widgets()).xref
    parent = document.get_new_xref()
    document.update_object(
        parent,
        f"<</T(parent)/Kids[{child} 0 R]/AA<</K<</S/JavaScript/JS({MARKER})>>>>>>",
    )
    document.xref_set_key(child, "Parent", f"{parent} 0 R")
    document.xref_set_key(document.pdf_catalog(), "AcroForm/Fields", f"[{parent} 0 R]")
    before, after, output = _clean(_save(document, tmp_path, "parent.pdf"), tmp_path)
    assert before == 1
    assert after == 0
    assert MARKER not in _objects_text(output)


def test_a_script_chained_after_navigation_goes_and_the_navigation_stays(tmp_path: Path) -> None:
    document = pymupdf.open()
    page, link = _with_link(document)
    document.new_page()
    target = document[1].xref
    document.xref_set_key(
        link,
        "A",
        f"<</S/GoTo/D[{target} 0 R/Fit]/Next[<</S/JavaScript/JS({MARKER})>>]>>",
    )
    before, after, output = _clean(_save(document, tmp_path, "chain.pdf"), tmp_path)
    assert before == 1
    assert after == 0
    assert MARKER not in _objects_text(output)
    with pymupdf.open(output) as cleaned:
        link_xref = cleaned[0].get_links()[0]["xref"]
        assert cleaned.xref_get_key(link_xref, "A/S")[1] == "/GoTo"


def test_remote_file_actions_are_found_and_removed(tmp_path: Path) -> None:
    document = pymupdf.open()
    _, link = _with_link(document)
    document.xref_set_key(link, "A", f"<</S/GoToR/F({MARKER}.pdf)/D[0/Fit]>>")
    before, after, output = _clean(_save(document, tmp_path, "remote.pdf"), tmp_path)
    assert before == 1
    assert after == 0
    assert MARKER not in _objects_text(output)


def test_xfa_forms_are_found_and_removed(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Body")
    xfa = document.get_new_xref()
    document.update_object(xfa, "<<>>")
    document.update_stream(xfa, f"<xdp:xdp><script>{MARKER}</script></xdp:xdp>".encode())
    document.xref_set_key(document.pdf_catalog(), "AcroForm", f"<</Fields[]/XFA {xfa} 0 R>>")
    document.xref_set_key(document.pdf_catalog(), "NeedsRendering", "true")
    source = _save(document, tmp_path, "xfa.pdf")
    before, after, output = _clean(source, tmp_path)
    assert before == 1
    assert after == 0
    with pymupdf.open(output) as cleaned:
        catalog = cleaned.pdf_catalog()
        assert cleaned.xref_get_key(catalog, "AcroForm/XFA")[0] == "null"
        assert cleaned.xref_get_key(catalog, "NeedsRendering")[0] == "null"


def test_actions_stay_when_scripts_are_not_asked(tmp_path: Path) -> None:
    document = pymupdf.open()
    _, link = _with_link(document)
    document.xref_set_key(link, "A", f"<</S/JavaScript/JS({MARKER})>>")
    source = _save(document, tmp_path, "kept.pdf")
    result = sanitize(
        SanitizeParams(path=str(source), output=str(tmp_path / "out.pdf"), javascript=False),
        silent_progress(),
    )
    assert inspect(InspectParams(path=result.output), silent_progress()).javascript == 1


def test_the_parser_keeps_strings_whole_and_removes_only_risky_parts() -> None:
    node = parse_object(
        "<</A<</S/GoTo/D[3 0 R/Fit]/Next 7 0 R>>/T(a \\) >> <</S/JavaScript>> \\()"
        "/H<3E3E>/AA<</K<</S/Java#53cript/JS<616c657274>>>/F<</S/URI/URI(x)>>>>>>"
    )
    assert risky_count(node) == 1
    cleaned = serialized(without_risky(node))
    assert "(a \\) >> <</S/JavaScript>> \\()" in cleaned
    assert "/Next 7 0 R" in cleaned
    assert "616c657274" not in cleaned
    assert "/URI (x)" in cleaned
    assert risky_count(parse_object(cleaned)) == 0


def test_the_parser_refuses_runaway_nesting() -> None:
    with pytest.raises(ValueError):
        parse_object("[" * 200 + "]" * 200)
