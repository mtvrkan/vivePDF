from pathlib import Path

import pikepdf
import pymupdf
import pytest

from vivepdf.ops import pages as pages_module
from vivepdf.ops.pages import (
    PagesParams,
    SourceParams,
    delete_pages,
    extract_pages,
    reverse_pages,
)
from vivepdf.rpc.progress import silent_progress

PAGE_COUNT = 6


def _rich_source(path: Path) -> Path:
    plain = path.with_name(f"plain-{path.name}")
    document = pymupdf.open()
    for index in range(PAGE_COUNT):
        page = document.new_page(width=300, height=300)
        page.insert_text((30, 40), f"Sayfa {index + 1}")
        widget = pymupdf.Widget()
        widget.field_name = f"alan{index + 1}"
        widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        widget.rect = pymupdf.Rect(50, 200, 250, 230)
        widget.field_value = f"değer {index + 1}"
        page.add_widget(widget)
    for index in range(PAGE_COUNT):
        target = (index + 2) % PAGE_COUNT
        document[index].insert_link(
            {
                "kind": pymupdf.LINK_GOTO,
                "from": pymupdf.Rect(30, 60, 120, 80),
                "page": target,
                "to": pymupdf.Point(0, 0),
            }
        )
    document.set_toc([[1, f"Bölüm {index + 1}", index + 1] for index in range(PAGE_COUNT)])
    document.save(plain)
    document.close()
    with pikepdf.open(plain) as pdf:
        elements = []
        parents = []
        for index, page in enumerate(pdf.pages):
            element = pdf.make_indirect(
                pikepdf.Dictionary(Type=pikepdf.Name.StructElem, S=pikepdf.Name.P, Pg=page.obj, K=0)
            )
            elements.append(element)
            page.obj.StructParents = index
            parents.extend((index, pikepdf.Array([element])))
        document_element = pdf.make_indirect(
            pikepdf.Dictionary(
                Type=pikepdf.Name.StructElem, S=pikepdf.Name.Document, K=pikepdf.Array(elements)
            )
        )
        root = pdf.make_indirect(
            pikepdf.Dictionary(
                Type=pikepdf.Name.StructTreeRoot,
                K=document_element,
                ParentTree=pdf.make_indirect(pikepdf.Dictionary(Nums=pikepdf.Array(parents))),
                ParentTreeNextKey=PAGE_COUNT,
            )
        )
        for element in elements:
            element.P = document_element
        document_element.P = root
        pdf.Root.StructTreeRoot = root
        pdf.Root.MarkInfo = pikepdf.Dictionary(Marked=True)
        names = []
        for index, page in enumerate(pdf.pages):
            names.extend(
                (pikepdf.String(f"hedef{index + 1}"), pikepdf.Array([page.obj, pikepdf.Name.Fit]))
            )
        pdf.Root.Names = pikepdf.Dictionary(Dests=pikepdf.Dictionary(Names=pikepdf.Array(names)))
        pdf.save(path)
    return path


def _structure_fingerprint(path: Path) -> dict:
    with pymupdf.open(path) as document:
        texts = [page.get_text().split("\n")[0] for page in document]
        links = [
            sorted(
                link.get("page", -1)
                for link in page.get_links()
                if link["kind"] == pymupdf.LINK_GOTO
            )
            for page in document
        ]
        widgets = [sorted(widget.field_name for widget in page.widgets()) for page in document]
        toc = document.get_toc(simple=True)
        dests = {
            name: target.get("page")
            for name, target in document.resolve_names().items()
            if target.get("page", -1) >= 0
        }
    with pikepdf.open(path) as pdf:
        page_of = {page.obj.objgen: index for index, page in enumerate(pdf.pages)}
        fields = sorted(str(field.T) for field in pdf.Root.AcroForm.Fields)
        tree = pdf.Root.get("/StructTreeRoot")
        tagged: list[int] = []
        if tree is not None:
            kids = tree.K.K
            kids = list(kids) if isinstance(kids, pikepdf.Array) else [kids]
            tagged = sorted(page_of.get(kid.Pg.objgen, -1) for kid in kids if "/Pg" in kid)
    return {
        "texts": texts,
        "links": links,
        "widgets": widgets,
        "fields": fields,
        "toc": toc,
        "dests": dests,
        "tagged": tagged,
    }


def _forced_select(document: pymupdf.Document, indices: list[int]) -> None:
    document.select(indices)


CASES = [
    (
        "delete-one",
        lambda source, output: delete_pages(
            PagesParams(path=source, pages=[2], output=output), silent_progress()
        ),
    ),
    (
        "delete-run",
        lambda source, output: delete_pages(
            PagesParams(path=source, pages=[1, 2, 5], output=output), silent_progress()
        ),
    ),
    (
        "extract-most",
        lambda source, output: extract_pages(
            PagesParams(path=source, pages=[1, 3, 4, 6], output=output), silent_progress()
        ),
    ),
    (
        "extract-few",
        lambda source, output: extract_pages(
            PagesParams(path=source, pages=[2, 5], output=output), silent_progress()
        ),
    ),
    (
        "reverse",
        lambda source, output: reverse_pages(
            SourceParams(path=source, output=output), silent_progress()
        ),
    ),
]


@pytest.mark.parametrize(("name", "run"), CASES, ids=[name for name, _ in CASES])
def test_fast_rearrange_matches_select_structure(tmp_path: Path, monkeypatch, name, run):
    source = _rich_source(tmp_path / "zengin.pdf")
    fast = tmp_path / f"{name}-fast.pdf"
    run(str(source), str(fast))
    monkeypatch.setattr(pages_module, "_rearrange", _forced_select)
    slow = tmp_path / f"{name}-select.pdf"
    run(str(source), str(slow))
    fast_print = _structure_fingerprint(fast)
    assert fast_print["toc"] and fast_print["dests"] and fast_print["tagged"]
    assert any(fast_print["links"]) or name == "extract-few"
    assert fast_print == _structure_fingerprint(slow)


@pytest.mark.parametrize("name", ["delete-one", "delete-run", "extract-most", "reverse"])
def test_structure_preserving_cases_skip_select(tmp_path: Path, monkeypatch, name):
    source = _rich_source(tmp_path / "zengin.pdf")
    run = dict(CASES)[name]

    def refuse(self, indices):
        raise AssertionError("select should not run")

    monkeypatch.setattr(pymupdf.Document, "select", refuse)
    output = tmp_path / f"{name}.pdf"
    run(str(source), str(output))
    fingerprint = _structure_fingerprint(output)
    assert fingerprint["fields"] == sorted(name for page in fingerprint["widgets"] for name in page)
    assert len(fingerprint["tagged"]) == len(fingerprint["texts"])


def test_reversing_keeps_every_structure_pointer_on_its_page(tmp_path: Path):
    source = _rich_source(tmp_path / "zengin.pdf")
    output = tmp_path / "ters.pdf"
    reverse_pages(SourceParams(path=str(source), output=str(output)), silent_progress())
    before = _structure_fingerprint(source)
    after = _structure_fingerprint(output)
    assert after["texts"] == list(reversed(before["texts"]))
    assert after["widgets"] == list(reversed(before["widgets"]))
    last = PAGE_COUNT - 1
    assert after["dests"] == {name: last - page for name, page in before["dests"].items()}
    assert after["tagged"] == list(range(PAGE_COUNT))


def test_a_shared_page_object_falls_back_to_select(tmp_path: Path):
    source = tmp_path / "paylasilan.pdf"
    with pikepdf.new() as pdf:
        pdf.add_blank_page(page_size=(200, 200))
        pdf.add_blank_page(page_size=(300, 300))
        shared = pdf.pages[0].obj
        pdf.Root.Pages.Kids.append(shared)
        pdf.Root.Pages.Count = 3
        pdf.save(source)
    output = tmp_path / "ters.pdf"
    reverse_pages(SourceParams(path=str(source), output=str(output)), silent_progress())
    with pymupdf.open(output) as document:
        assert [round(page.rect.width) for page in document] == [200, 300, 200]
