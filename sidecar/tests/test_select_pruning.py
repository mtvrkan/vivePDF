from pathlib import Path

import pikepdf
import pymupdf

from vivepdf.ops.pages import (
    PagesParams,
    SourceParams,
    delete_pages,
    extract_pages,
    reverse_pages,
)
from vivepdf.rpc.progress import silent_progress


def _image_count(document: pymupdf.Document) -> int:
    return sum(
        1
        for xref in range(1, document.xref_length())
        if document.xref_get_key(xref, "Subtype") == ("name", "/Image")
    )


def _pictured(path: Path, count: int = 4) -> Path:
    document = pymupdf.open()
    for index in range(count):
        page = document.new_page(width=300, height=300)
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), 0)
        pixmap.set_rect(pixmap.irect, (index * 50, 200 - index * 40, 90))
        page.insert_image(pymupdf.Rect(20, 20, 280, 250), pixmap=pixmap)
        page.insert_text((30, 280), f"Sayfa {index + 1}")
    document.save(path)
    document.close()
    return path


def _tagged(path: Path, count: int = 4, **encryption: object) -> Path:
    plain = _pictured(path.with_name(f"untagged-{path.name}"), count)
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
                ParentTreeNextKey=count,
            )
        )
        for element in elements:
            element.P = document_element
        document_element.P = root
        pdf.Root.StructTreeRoot = root
        pdf.Root.MarkInfo = pikepdf.Dictionary(Marked=True)
        pdf.save(path, **encryption)
    return path


def _structure_pages(path: Path, password: str | None = None) -> int:
    with pikepdf.open(path, password=password or "") as pdf:
        tree = pdf.Root.StructTreeRoot
        kids = tree.K.K
        kids = list(kids) if isinstance(kids, pikepdf.Array) else [kids]
        return len(kids)


def test_extracting_one_page_of_a_tagged_file_writes_only_that_page(tmp_path: Path):
    source = _tagged(tmp_path / "etiketli.pdf")
    target = tmp_path / "one.pdf"
    extract_pages(PagesParams(path=str(source), pages=[2], output=str(target)), silent_progress())
    with pymupdf.open(target) as document:
        assert document.page_count == 1
        assert _image_count(document) == 1
        assert document[0].get_text().strip() == "Sayfa 2"
    assert _structure_pages(target) == 1


def test_deleting_pages_of_a_tagged_file_drops_their_resources(tmp_path: Path):
    source = _tagged(tmp_path / "etiketli.pdf")
    target = tmp_path / "kept.pdf"
    delete_pages(PagesParams(path=str(source), pages=[1, 3], output=str(target)), silent_progress())
    with pymupdf.open(target) as document:
        assert [page.get_text().strip() for page in document] == ["Sayfa 2", "Sayfa 4"]
        assert _image_count(document) == 2
    assert _structure_pages(target) == 2


def test_a_protected_tagged_extract_is_small_and_still_protected(tmp_path: Path):
    source = _tagged(
        tmp_path / "gizli etiketli ş.pdf",
        encryption=pikepdf.Encryption(user="kullanıcı", owner="sahip", R=6),
    )
    target = tmp_path / "one.pdf"
    extract_pages(
        PagesParams(path=str(source), password="kullanıcı", pages=[3], output=str(target)),
        silent_progress(),
    )
    with pymupdf.open(target) as document:
        assert document.needs_pass
        assert document.authenticate("kullanıcı") == 2
        assert _image_count(document) == 1
        assert document[0].get_text().strip() == "Sayfa 3"
    with pymupdf.open(target) as document:
        assert document.authenticate("sahip") & 4


def _form(path: Path) -> Path:
    document = pymupdf.open()
    for index in range(3):
        page = document.new_page()
        widget = pymupdf.Widget()
        widget.field_name = f"alan{index + 1}"
        widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        widget.rect = pymupdf.Rect(50, 50, 250, 80)
        widget.field_value = f"değer {index + 1}"
        page.add_widget(widget)
    document.save(path)
    document.close()
    return path


def _field_names(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        assert document.is_form_pdf
        with pikepdf.open(path) as pdf:
            listed = [str(field.T) for field in pdf.Root.AcroForm.Fields]
        on_pages = [widget.field_name for page in document for widget in page.widgets()]
        assert sorted(listed) == sorted(on_pages)
        return on_pages


def test_form_fields_on_kept_pages_survive_delete_and_extract(tmp_path: Path):
    source = _form(tmp_path / "form.pdf")
    deleted = tmp_path / "deleted.pdf"
    delete_pages(PagesParams(path=str(source), pages=[2], output=str(deleted)), silent_progress())
    assert _field_names(deleted) == ["alan1", "alan3"]
    extracted = tmp_path / "extracted.pdf"
    extract_pages(
        PagesParams(path=str(source), pages=[3], output=str(extracted)), silent_progress()
    )
    assert _field_names(extracted) == ["alan3"]
    reversed_file = tmp_path / "reversed.pdf"
    reverse_pages(SourceParams(path=str(source), output=str(reversed_file)), silent_progress())
    assert _field_names(reversed_file) == ["alan3", "alan2", "alan1"]


def test_links_and_named_destinations_to_removed_pages_do_not_keep_them(tmp_path: Path):
    source = _pictured(tmp_path / "links.pdf")
    with pikepdf.open(source, allow_overwriting_input=True) as pdf:
        last = pdf.pages[3].obj
        link = pdf.make_indirect(
            pikepdf.Dictionary(
                Type=pikepdf.Name.Annot,
                Subtype=pikepdf.Name.Link,
                Rect=pikepdf.Array([10, 10, 60, 30]),
                Border=pikepdf.Array([0, 0, 0]),
                Dest=pikepdf.Array([last, pikepdf.Name.Fit]),
            )
        )
        pdf.pages[0].obj.Annots = pikepdf.Array([link])
        pdf.Root.Names = pikepdf.Dictionary(
            Dests=pikepdf.Dictionary(
                Names=pikepdf.Array(
                    [
                        pikepdf.String("son"),
                        pikepdf.Array([last, pikepdf.Name.Fit]),
                        pikepdf.String("ilk"),
                        pikepdf.Array([pdf.pages[0].obj, pikepdf.Name.Fit]),
                    ]
                )
            )
        )
        pdf.Root.OpenAction = pikepdf.Array([last, pikepdf.Name.Fit])
        pdf.save(source)
    target = tmp_path / "first.pdf"
    extract_pages(PagesParams(path=str(source), pages=[1], output=str(target)), silent_progress())
    with pymupdf.open(target) as document:
        assert _image_count(document) == 1
        assert document[0].get_links() == []
    with pikepdf.open(target) as pdf:
        names = list(pdf.Root.Names.Dests.Names)
        assert [str(name) for name in names[::2]] == ["ilk"]
        assert "/OpenAction" not in pdf.Root
