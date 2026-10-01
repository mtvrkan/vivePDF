from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.progress import silent_progress


def _rewritten(path: Path, build) -> None:
    with pymupdf.open(path) as document:
        page = document[0]
        names = {kind_name: xref for kind_name, xref, kind in page.get_oc_items() if kind == "ocg"}
        stream = build(page.read_contents().decode("latin-1"), names)
        xref = document.get_new_xref()
        document.update_object(xref, "<<>>")
        document.update_stream(xref, stream.encode("latin-1"))
        page.set_contents(xref)
        document.saveIncr()


def _text_run(y: int, words: str) -> str:
    payload = words.encode("latin-1").hex()
    return f"BT\n1 0 0 1 72 {y} Tm\n/helv 11 Tf [<{payload}>]TJ\nET\n"


@pytest.fixture
def nested_layers(tmp_path: Path) -> Path:
    document = pymupdf.Document()
    page = document.new_page(width=595, height=842)
    hidden = document.add_ocg("Hidden", on=False)
    visible = document.add_ocg("Visible", on=True)
    page.insert_text((72, 72), "plain body")
    page.insert_text((72, 120), "hidden opener", oc=hidden)
    page.insert_text((72, 160), "visible opener", oc=visible)
    path = tmp_path / "nested.pdf"
    document.save(path)
    document.close()

    def build(_content: str, names: dict[str, int]) -> str:
        hidden_name = next(name for name, xref in names.items() if xref == hidden)
        visible_name = next(name for name, xref in names.items() if xref == visible)
        return (
            "q\n"
            + _text_run(770, "plain body")
            + "Q\nq\n"
            + f"/OC /{hidden_name} BDC\n"
            + "/Artifact BMC\n"
            + _text_run(722, "hidden artifact")
            + "EMC\n"
            + _text_run(700, "hidden tail")
            + "EMC\nQ\nq\n"
            + f"/OC /{visible_name} BDC\n"
            + "/Artifact BMC\n"
            + _text_run(660, "visible artifact")
            + "EMC\n"
            + _text_run(640, "visible tail")
            + "EMC\nQ\n"
        )

    _rewritten(path, build)
    return path


def test_the_fixture_really_nests(nested_layers: Path) -> None:
    with pymupdf.open(nested_layers) as document:
        content = document[0].read_contents()
    assert content.count(b"BMC") == 2
    assert content.count(b"BDC") == 2
    assert content.count(b"EMC") == 4


def test_a_hidden_layer_goes_even_when_it_wraps_marked_content(
    nested_layers: Path, tmp_path: Path
) -> None:
    target = tmp_path / "flat.pdf"
    sanitize(
        SanitizeParams(path=str(nested_layers), output=str(target), hidden_layers=True),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        text = document[0].get_text()
    assert "hidden artifact" not in text
    assert "hidden tail" not in text


def test_what_the_reader_could_see_is_still_there(nested_layers: Path, tmp_path: Path) -> None:
    target = tmp_path / "flat.pdf"
    sanitize(
        SanitizeParams(path=str(nested_layers), output=str(target), hidden_layers=True),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        text = document[0].get_text()
    assert "plain body" in text
    assert "visible artifact" in text
    assert "visible tail" in text


def test_no_layers_are_left_behind(nested_layers: Path, tmp_path: Path) -> None:
    target = tmp_path / "flat.pdf"
    sanitize(
        SanitizeParams(path=str(nested_layers), output=str(target), hidden_layers=True),
        silent_progress(),
    )
    after = inspect(InspectParams(path=str(target)), silent_progress())
    assert after.hidden_layers == 0
    assert after.layers == 0


def _with_layered_xobjects(tmp_path: Path) -> Path:
    inner = pymupdf.Document()
    inner.new_page(width=200, height=100).insert_text((10, 50), "inside the form")
    source = tmp_path / "inner.pdf"
    inner.save(source)
    inner.close()

    document = pymupdf.Document()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "plain body")
    page.show_pdf_page(pymupdf.Rect(72, 200, 272, 300), pymupdf.open(source), 0)
    visible = document.add_ocg("Visible", on=True)
    path = tmp_path / "forms.pdf"
    document.save(path)
    document.close()

    with pymupdf.open(path) as document:
        xref = document[0].get_xobjects()[0][0]
        document.xref_set_key(xref, "OC", f"{visible} 0 R")
        document.saveIncr()
    return path


def test_a_form_that_belonged_to_a_visible_layer_still_shows(tmp_path: Path) -> None:
    path = _with_layered_xobjects(tmp_path)
    target = tmp_path / "flat.pdf"
    sanitize(
        SanitizeParams(path=str(path), output=str(target), hidden_layers=True),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        text = document[0].get_text()
    assert "inside the form" in text
    assert "plain body" in text
