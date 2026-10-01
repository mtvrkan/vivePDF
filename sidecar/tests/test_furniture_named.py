from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.furniture import RemoveFurnitureParams, remove_header_footer
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

HEADER = b"<</Type /Pagination /Subtype /Header>>"
FOOTER = b"<</Type /Pagination /Subtype /Footer>>"


def _words(path: Path, index: int = 0) -> list[str]:
    document = pymupdf.open(path)
    words = [word[4] for word in document[index].get_text("words")]
    document.close()
    return words


def _append_stream(document: pymupdf.Document, page: pymupdf.Page, data: bytes) -> None:
    xref = document.get_new_xref()
    document.update_object(xref, "<<>>")
    document.update_stream(xref, data)
    contents = [*page.get_contents(), xref]
    document.xref_set_key(
        page.xref, "Contents", "[" + " ".join(f"{item} 0 R" for item in contents) + "]"
    )


def _resources(document: pymupdf.Document, page: pymupdf.Page) -> int:
    kind, value = document.xref_get_key(page.xref, "Resources")
    if kind == "xref":
        return int(value.split()[0])
    xref = document.get_new_xref()
    document.update_object(xref, value if kind == "dict" else "<<>>")
    document.xref_set_key(page.xref, "Resources", f"{xref} 0 R")
    return xref


def _form(document: pymupdf.Document, font_holder: int, data: bytes) -> int:
    _kind, fonts = document.xref_get_key(font_holder, "Font")
    xref = document.get_new_xref()
    document.update_object(
        xref, f"<</Type/XObject/Subtype/Form/BBox[0 0 595 842]/Resources<</Font {fonts}>>>>"
    )
    document.update_stream(xref, data)
    return xref


def _text(label: bytes, y: int) -> bytes:
    return b"q BT /helv 9 Tf 1 0 0 1 50 " + str(y).encode() + b" Tm (" + label + b") Tj ET Q"


@pytest.fixture
def named(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((50, 400), "govde")
    resources = _resources(document, page)
    header = document.get_new_xref()
    document.update_object(header, HEADER.decode())
    document.xref_set_key(
        resources, "Properties", f"<</HF0 {header} 0 R /HF1 {FOOTER.decode()} /MC0 <</X 1>>>>"
    )
    _append_stream(
        document,
        page,
        b"/Artifact /HF0 BDC " + _text(b"UST", 820) + b" EMC\n"
        b"/Artifact /HF1 BDC " + _text(b"ALT", 20) + b" EMC\n"
        b"/Artifact /MC0 BDC " + _text(b"DIGER", 300) + b" EMC\n"
        b"/Artifact /Missing BDC " + _text(b"KAYIP", 250) + b" EMC",
    )
    path = tmp_path / "adlı özellik.pdf"
    document.save(path)
    document.close()
    return path


def test_named_property_lists_are_resolved(named: Path, tmp_path: Path):
    result = remove_header_footer(
        RemoveFurnitureParams(path=str(named), output=str(tmp_path / "out.pdf"), scope="all"),
        silent_progress(),
    )
    assert result.removed == 2
    assert _words(Path(result.output)) == ["govde", "DIGER", "KAYIP"]


def test_named_properties_are_not_taken_for_vivepdf_furniture(named: Path, tmp_path: Path):
    with pytest.raises(OpError):
        remove_header_footer(
            RemoveFurnitureParams(path=str(named), output=str(tmp_path / "out.pdf")),
            silent_progress(),
        )


def _forms_document(tmp_path: Path, pages: int, partial: bool) -> Path:
    document = pymupdf.open()
    for index in range(pages):
        page = document.new_page()
        page.insert_text((50, 400), f"govde{index + 1}")
    first = document[0]
    resources = _resources(document, first)
    body = _text(b"FORMGOVDE", 500) if partial else b""
    form = _form(
        document,
        resources,
        b"q /Artifact " + FOOTER + b" BDC " + _text(b"SAYFAALTI", 20) + b" EMC Q " + body,
    )
    for page in document:
        holder = _resources(document, page)
        document.xref_set_key(holder, "XObject", f"<</Fm0 {form} 0 R>>")
        _append_stream(document, page, b"q /Fm0 Do Q")
    path = tmp_path / f"forms-{pages}-{partial}.pdf"
    document.save(path)
    document.close()
    return path


def test_a_form_that_only_draws_a_footer_is_no_longer_drawn(tmp_path: Path):
    source = _forms_document(tmp_path, 2, partial=False)
    assert "SAYFAALTI" in _words(source)
    result = remove_header_footer(
        RemoveFurnitureParams(
            path=str(source), output=str(tmp_path / "out.pdf"), scope="all", pages="1"
        ),
        silent_progress(),
    )
    assert result.removed == 1
    assert _words(Path(result.output), 0) == ["govde1"]
    assert _words(Path(result.output), 1) == ["govde2", "SAYFAALTI"]


def test_a_mixed_form_loses_only_its_footer(tmp_path: Path):
    source = _forms_document(tmp_path, 2, partial=True)
    result = remove_header_footer(
        RemoveFurnitureParams(path=str(source), output=str(tmp_path / "out.pdf"), scope="all"),
        silent_progress(),
    )
    assert result.removed == 1
    assert result.pages_changed == 1
    for index in (0, 1):
        assert _words(Path(result.output), index) == [f"govde{index + 1}", "FORMGOVDE"]


def _form_names(path: Path, index: int) -> list[str]:
    document = pymupdf.open(path)
    names = [item[1] for item in document[index].get_xobjects()]
    document.close()
    return names


@pytest.mark.parametrize("pages", ["1", "2"])
def test_a_shared_mixed_form_is_copied_for_the_pages_in_range(tmp_path: Path, pages: str):
    source = _forms_document(tmp_path, 2, partial=True)
    result = remove_header_footer(
        RemoveFurnitureParams(
            path=str(source), output=str(tmp_path / "out.pdf"), scope="all", pages=pages
        ),
        silent_progress(),
    )
    chosen = int(pages) - 1
    other = 1 - chosen
    output = Path(result.output)
    assert result.removed == 1
    assert result.pages_changed == 1
    assert _words(output, chosen) == [f"govde{chosen + 1}", "FORMGOVDE"]
    assert _words(output, other) == [f"govde{other + 1}", "SAYFAALTI", "FORMGOVDE"]
    assert _form_names(output, other) == ["Fm0"]
    assert _form_names(output, chosen) != ["Fm0"]
    assert _words(source, 0) == ["govde1", "SAYFAALTI", "FORMGOVDE"]


def test_a_shared_mixed_form_on_inherited_resources_is_copied(tmp_path: Path):
    source = _forms_document(tmp_path, 2, partial=True)
    document = pymupdf.open(source)
    first = document[0]
    _kind, resources = document.xref_get_key(first.xref, "Resources")
    pages_root = int(document.xref_get_key(first.xref, "Parent")[1].split()[0])
    document.xref_set_key(pages_root, "Resources", resources)
    document.xref_set_key(first.xref, "Resources", "null")
    inherited = tmp_path / "inherited.pdf"
    document.save(inherited)
    document.close()
    result = remove_header_footer(
        RemoveFurnitureParams(
            path=str(inherited), output=str(tmp_path / "out.pdf"), scope="all", pages="1"
        ),
        silent_progress(),
    )
    output = Path(result.output)
    assert _words(output, 0) == ["govde1", "FORMGOVDE"]
    assert _words(output, 1) == ["govde2", "SAYFAALTI", "FORMGOVDE"]


def _nested_document(tmp_path: Path, shared: bool) -> Path:
    document = pymupdf.open()
    for index in range(2):
        page = document.new_page()
        page.insert_text((50, 400), f"govde{index + 1}")
    resources = _resources(document, document[0])
    inner = _form(
        document,
        resources,
        b"q /Artifact " + FOOTER + b" BDC " + _text(b"SAYFAALTI", 20) + b" EMC Q "
        b"" + _text(b"ICGOVDE", 500),
    )
    outer = _form(document, resources, _text(b"DISGOVDE", 600) + b" q /In Do Q")
    document.xref_set_key(outer, "Resources/XObject", f"<</In {inner} 0 R>>")
    users = list(document) if shared else [document[0]]
    for page in users:
        holder = _resources(document, page)
        document.xref_set_key(holder, "XObject", f"<</Fm0 {outer} 0 R>>")
        _append_stream(document, page, b"q /Fm0 Do Q")
    path = tmp_path / f"nested-{shared}.pdf"
    document.save(path)
    document.close()
    return path


def test_a_mixed_form_inside_a_shared_form_is_copied_down_the_chain(tmp_path: Path):
    source = _nested_document(tmp_path, shared=True)
    assert sorted(_words(source, 1)) == sorted(["govde2", "DISGOVDE", "SAYFAALTI", "ICGOVDE"])
    result = remove_header_footer(
        RemoveFurnitureParams(
            path=str(source), output=str(tmp_path / "out.pdf"), scope="all", pages="1"
        ),
        silent_progress(),
    )
    output = Path(result.output)
    assert result.removed == 1
    assert result.pages_changed == 1
    assert sorted(_words(output, 0)) == sorted(["govde1", "DISGOVDE", "ICGOVDE"])
    assert sorted(_words(output, 1)) == sorted(["govde2", "DISGOVDE", "SAYFAALTI", "ICGOVDE"])
    assert not any(name.startswith("Fm0_vp") for name in _form_names(output, 1))
    assert any(name.startswith("Fm0_vp") for name in _form_names(output, 0))


def test_a_mixed_form_inside_an_unshared_form_is_cleaned_in_place(tmp_path: Path):
    source = _nested_document(tmp_path, shared=False)
    result = remove_header_footer(
        RemoveFurnitureParams(
            path=str(source), output=str(tmp_path / "out.pdf"), scope="all", pages="1"
        ),
        silent_progress(),
    )
    output = Path(result.output)
    assert result.removed == 1
    assert sorted(_words(output, 0)) == sorted(["govde1", "DISGOVDE", "ICGOVDE"])
    assert _words(output, 1) == ["govde2"]
    assert not any(name.startswith("Fm0_vp") for name in _form_names(output, 0))


def test_a_form_that_draws_itself_does_not_loop(tmp_path: Path):
    source = _nested_document(tmp_path, shared=False)
    document = pymupdf.open(source)
    outer = next(item[0] for item in document[0].get_xobjects() if item[1] == "Fm0")
    inner = int(document.xref_get_key(outer, "Resources/XObject/In")[1].split()[0])
    document.xref_set_key(inner, "Resources/XObject", f"<</Up {outer} 0 R>>")
    looped = tmp_path / "looped.pdf"
    document.save(looped)
    document.close()
    result = remove_header_footer(
        RemoveFurnitureParams(
            path=str(looped), output=str(tmp_path / "out.pdf"), scope="all", pages="1"
        ),
        silent_progress(),
    )
    assert result.removed == 1
