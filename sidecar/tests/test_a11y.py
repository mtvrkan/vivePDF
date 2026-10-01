from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.a11y import CheckParams, check
from vivepdf.ops.a11y_fix import FixParams, fix, pdf_text_string
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def tagged_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "Başlık")
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    pixmap.set_rect(pixmap.irect, (200, 50, 50))
    page.insert_image(pymupdf.Rect(72, 100, 172, 200), pixmap=pixmap)
    catalog = document.pdf_catalog()
    page_xref = document.page_xref(0)
    root = document.get_new_xref()
    heading = document.get_new_xref()
    figure_with_alt = document.get_new_xref()
    figure_without_alt = document.get_new_xref()
    document.update_object(
        root,
        f"<</Type/StructTreeRoot/K[{heading} 0 R {figure_with_alt} 0 R {figure_without_alt} 0 R]>>",
    )
    document.update_object(
        heading, f"<</Type/StructElem/S/H1/P {root} 0 R/Pg {page_xref} 0 R/K 0>>"
    )
    document.update_object(
        figure_with_alt,
        f"<</Type/StructElem/S/Figure/P {root} 0 R/Pg {page_xref} 0 R/Alt(Logo)/K 1>>",
    )
    document.update_object(
        figure_without_alt, f"<</Type/StructElem/S/Figure/P {root} 0 R/Pg {page_xref} 0 R/K 2>>"
    )
    document.xref_set_key(catalog, "StructTreeRoot", f"{root} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<</Marked true>>")
    path = tmp_path / "tagged.pdf"
    document.save(path)
    document.close()
    return path


def test_pdf_text_string_handles_ascii_and_unicode() -> None:
    assert pdf_text_string("a(b)") == "(a\\(b\\))"
    assert pdf_text_string("Şema") == "<FEFF015E0065006D0061>"


def test_check_untagged_document(sample_pdf: Path) -> None:
    report = check(CheckParams(path=str(sample_pdf)), silent_progress())
    assert report.tagged is False
    assert report.title == "Sample"
    assert report.language is None
    statuses = {item.id: item.status for item in report.checks}
    assert statuses["tagged"] == "fail"
    assert statuses["title"] == "pass"
    assert statuses["language"] == "fail"
    assert statuses["scanned"] == "pass"
    assert 0 < report.score < 100


def test_untagged_document_without_images_needs_no_alt_text(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Metin")
    path = tmp_path / "plain.pdf"
    document.save(path)
    document.close()
    statuses = {
        item.id: item.status
        for item in check(CheckParams(path=str(path)), silent_progress()).checks
    }
    assert statuses["altText"] == "pass"


def test_untagged_document_with_images_warns_about_alt_text(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    page.insert_image(pymupdf.Rect(72, 100, 172, 200), pixmap=pixmap)
    path = tmp_path / "image.pdf"
    document.save(path)
    document.close()
    report = check(CheckParams(path=str(path)), silent_progress())
    item = next(entry for entry in report.checks if entry.id == "altText")
    assert (item.status, item.count) == ("warn", 1)


def test_check_tagged_document_lists_figures(tagged_pdf: Path) -> None:
    report = check(CheckParams(path=str(tagged_pdf)), silent_progress())
    assert report.tagged is True
    assert report.figures_total == 2
    assert report.figures_without_alt == 1
    assert report.headings == {"h1": 1}
    assert [figure.page for figure in report.figures] == [1, 1]
    assert {item.id: item.status for item in report.checks}["altText"] == "fail"


def test_fix_sets_title_language_display_and_alt(tagged_pdf: Path, tmp_path: Path) -> None:
    before = check(CheckParams(path=str(tagged_pdf)), silent_progress())
    missing = next(figure for figure in before.figures if not figure.alt)
    result = fix(
        FixParams(
            path=str(tagged_pdf),
            output=str(tmp_path / "fixed.pdf"),
            title="Erişilebilir Rapor",
            language="tr-TR",
            display_doc_title=True,
            alt_texts={missing.xref: "Şirket logosu"},
        ),
        silent_progress(),
    )
    assert result.changes == 4
    after = check(CheckParams(path=result.output), silent_progress())
    assert after.title == "Erişilebilir Rapor"
    assert after.language == "tr-TR"
    assert after.display_doc_title is True
    assert after.figures_without_alt == 0
    assert (
        next(figure.alt for figure in after.figures if figure.xref == missing.xref)
        == "Şirket logosu"
    )
    assert after.score > before.score


def test_fix_rejects_non_figure_xref(tagged_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as error:
        fix(
            FixParams(path=str(tagged_pdf), output=str(tmp_path / "x.pdf"), alt_texts={1: "nope"}),
            silent_progress(),
        )
    assert error.value.code == ErrorCode.INVALID_PARAMS
