from pathlib import Path

import pymupdf

from vivepdf.ops._a11y_tree import MAX_FIGURES
from vivepdf.ops.a11y import CheckParams, check
from vivepdf.rpc.progress import silent_progress


def _statuses(path: Path) -> dict[str, str]:
    return {
        item.id: item.status
        for item in check(CheckParams(path=str(path)), silent_progress()).checks
    }


def _tagged_with(tmp_path: Path, name: str, elements: list[str], role_map: str = "") -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Metin")
    catalog = document.pdf_catalog()
    page_xref = document.page_xref(0)
    root = document.get_new_xref()
    kids = []
    for index, element in enumerate(elements):
        xref = document.get_new_xref()
        document.update_object(
            xref, f"<</Type/StructElem/S/{element}/P {root} 0 R/Pg {page_xref} 0 R/K {index}>>"
        )
        kids.append(f"{xref} 0 R")
    document.update_object(root, f"<</Type/StructTreeRoot{role_map}/K[{' '.join(kids)}]>>")
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<</Marked true>>")
    path = tmp_path / name
    document.save(path)
    document.close()
    return path


def test_custom_tags_are_read_through_the_role_map(tmp_path: Path) -> None:
    path = _tagged_with(
        tmp_path,
        "rolemap.pdf",
        ["Baslik", "Resim"],
        "/RoleMap<</Baslik/H1/Resim/Figure>>",
    )
    report = check(CheckParams(path=str(path)), silent_progress())
    assert report.headings == {"h1": 1}
    assert report.figures_total == 1
    assert report.figures_without_alt == 1


def test_plain_h_headings_count_as_headings(tmp_path: Path) -> None:
    path = _tagged_with(tmp_path, "h.pdf", ["H", "P"])
    report = check(CheckParams(path=str(path)), silent_progress())
    assert report.headings == {"h": 1}
    assert _statuses(path)["headings"] == "pass"


def test_a_tagged_file_without_headings_only_warns(tmp_path: Path) -> None:
    path = _tagged_with(tmp_path, "noheading.pdf", ["P"])
    assert _statuses(path)["headings"] == "warn"


def test_figures_past_the_listing_limit_are_still_counted(tmp_path: Path) -> None:
    path = _tagged_with(tmp_path, "many.pdf", ["Figure"] * (MAX_FIGURES + 20))
    report = check(CheckParams(path=str(path)), silent_progress())
    assert len(report.figures) == MAX_FIGURES
    assert report.figures_total == MAX_FIGURES + 20
    assert report.figures_without_alt == MAX_FIGURES + 20


def test_a_title_only_in_xmp_counts(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Metin")
    document.set_xml_metadata(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
        'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Yıllık &amp; Rapor</rdf:li>'
        "</rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>"
    )
    path = tmp_path / "xmp.pdf"
    document.save(path)
    document.close()
    report = check(CheckParams(path=str(path)), silent_progress())
    assert report.title == "Yıllık & Rapor"
    assert _statuses(path)["title"] == "pass"


def test_text_over_a_see_through_panel_is_judged_against_the_page(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.draw_rect(pymupdf.Rect(50, 50, 400, 120), color=None, fill=(0.1, 0.1, 0.3), fill_opacity=0)
    page.insert_text((72, 90), "Kontrast örneği", fontsize=11, color=(1, 1, 1))
    path = tmp_path / "saydam.pdf"
    document.save(path)
    document.close()
    assert _statuses(path)["contrast"] == "warn"
