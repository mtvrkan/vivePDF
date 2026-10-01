from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.comments import (
    CommentsDeleteParams,
    CommentsExportParams,
    CommentsListParams,
    CommentsUpdateParams,
    delete_comments,
    export_comments,
    iso_date,
    list_comments,
    set_resolved,
)
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def annotated_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    first = document.new_page(width=595, height=842)
    first.insert_text((72, 72), "Bir cümle vurgulanacak")
    note = first.add_text_annot((300, 300), "Gözden geçir")
    note.set_info(title="Ayşe", subject="Soru", creationDate="D:20260905101500+03'00'")
    note.update()
    highlight = first.add_highlight_annot(pymupdf.Rect(70, 60, 200, 80))
    highlight.set_info(title="Mehmet", content="Önemli")
    highlight.update()
    second = document.new_page(width=595, height=842)
    box = second.add_rect_annot(pymupdf.Rect(100, 100, 200, 200))
    box.set_info(title="Ayşe", content="Kutu")
    box.set_colors(stroke=(1, 0, 0))
    box.update()
    second.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(0, 0, 50, 50), "uri": "https://x"}
    )
    path = tmp_path / "notes.pdf"
    document.save(path)
    document.close()
    return path


def test_iso_date_parses_pdf_dates() -> None:
    assert iso_date("D:20260905101500+03'00'") == "2026-09-05 10:15:00"
    assert iso_date("D:20260905") == "2026-09-05"
    assert iso_date("") == ""


def test_list_collects_annotations_without_links(annotated_pdf: Path) -> None:
    result = list_comments(CommentsListParams(path=str(annotated_pdf)), silent_progress())
    assert result.page_count == 2
    assert [item.page for item in result.items] == [1, 1, 2]
    assert result.authors == ["Ayşe", "Mehmet"]
    assert set(result.types) == {"Text", "Highlight", "Square"}
    note = result.items[0]
    assert note.content == "Gözden geçir"
    assert note.created == "2026-09-05 10:15:00"
    assert not note.resolved
    assert result.items[2].color == "#ff0000"


def test_resolve_and_unresolve_persist(annotated_pdf: Path) -> None:
    listed = list_comments(CommentsListParams(path=str(annotated_pdf)), silent_progress())
    xref = listed.items[0].xref
    changed = set_resolved(
        CommentsUpdateParams(path=str(annotated_pdf), xrefs=[xref], resolved=True),
        silent_progress(),
    )
    assert changed.changed == 1
    again = list_comments(CommentsListParams(path=str(annotated_pdf)), silent_progress())
    assert again.items[0].resolved is True
    assert again.items[1].resolved is False
    set_resolved(
        CommentsUpdateParams(path=str(annotated_pdf), xrefs=[xref], resolved=False),
        silent_progress(),
    )
    assert (
        not list_comments(CommentsListParams(path=str(annotated_pdf)), silent_progress())
        .items[0]
        .resolved
    )


def test_delete_removes_only_selected(annotated_pdf: Path) -> None:
    listed = list_comments(CommentsListParams(path=str(annotated_pdf)), silent_progress())
    target = listed.items[1].xref
    result = delete_comments(
        CommentsDeleteParams(path=str(annotated_pdf), xrefs=[target]), silent_progress()
    )
    assert result.changed == 1
    remaining = list_comments(CommentsListParams(path=str(annotated_pdf)), silent_progress())
    assert len(remaining.items) == 2
    assert all(item.xref != target for item in remaining.items)


def test_export_csv_and_pdf(annotated_pdf: Path, tmp_path: Path) -> None:
    csv_result = export_comments(
        CommentsExportParams(path=str(annotated_pdf), output=str(tmp_path / "notes"), format="csv"),
        silent_progress(),
    )
    assert csv_result.count == 3
    text = Path(csv_result.output).read_text(encoding="utf-8-sig")
    assert text.splitlines()[0].startswith("page;type;author")
    assert "Gözden geçir" in text
    pdf_result = export_comments(
        CommentsExportParams(
            path=str(annotated_pdf), output=str(tmp_path / "summary.pdf"), format="pdf"
        ),
        silent_progress(),
    )
    with pymupdf.open(pdf_result.output) as summary:
        content = summary[0].get_text()
        assert "Page 1" in content and "Gözden geçir" in content and "Kutu" in content
    with pytest.raises(OpError) as error:
        export_comments(
            CommentsExportParams(
                path=str(annotated_pdf), output=str(tmp_path / "notes.csv"), format="csv"
            ),
            silent_progress(),
        )
    assert error.value.code == ErrorCode.INVALID_PARAMS


@pytest.mark.parametrize("layout", ["list", "pages"])
def test_export_uses_the_type_labels_sent_by_the_ui(
    annotated_pdf: Path, tmp_path: Path, layout: str
) -> None:
    labels = {"Text": "Not", "Highlight": "Vurgu", "Square": "  Dikdörtgen  "}
    result = export_comments(
        CommentsExportParams(
            path=str(annotated_pdf),
            output=str(tmp_path / f"summary-{layout}.pdf"),
            format="pdf",
            layout=layout,
            type_labels=labels,
        ),
        silent_progress(),
    )
    document = pymupdf.open(result.output)
    text = " ".join(page.get_text() for page in document)
    document.close()
    assert "Vurgu" in text and "Dikdörtgen" in text and "Not" in text
    assert "Highlight" not in text and "Square" not in text


def test_csv_uses_type_labels_and_falls_back_to_the_subtype(
    annotated_pdf: Path, tmp_path: Path
) -> None:
    result = export_comments(
        CommentsExportParams(
            path=str(annotated_pdf),
            output=str(tmp_path / "rows.csv"),
            format="csv",
            type_labels={"Highlight": "=Vurgu", "Text": ""},
        ),
        silent_progress(),
    )
    rows = Path(result.output).read_text(encoding="utf-8-sig").splitlines()
    assert any(";'=Vurgu;" in row for row in rows)
    assert any(";Text;" in row for row in rows)
    assert any(";Square;" in row for row in rows)


def _highlighted_pdf(tmp_path: Path, rotation: int = 0) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 100), "The experi-", fontsize=12)
    page.insert_text((72, 116), "ment was repeated twice.", fontsize=12)
    page.insert_text((72, 200), "An unmarked sentence stays out.", fontsize=12)
    quads = page.search_for("experi-") + page.search_for("ment was repeated")
    highlight = page.add_highlight_annot(quads)
    highlight.set_info(title="Ayşe", content="Key *result*\nsee [2]")
    highlight.update()
    underline = page.add_underline_annot(page.search_for("unmarked"))
    underline.update()
    page.set_rotation(rotation)
    document.set_page_labels([{"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 3}])
    path = tmp_path / f"highlighted-{rotation}.pdf"
    document.save(path)
    document.close()
    return path


@pytest.mark.parametrize("rotation", [0, 90])
def test_list_reads_the_text_under_text_markup(tmp_path: Path, rotation: int) -> None:
    result = list_comments(
        CommentsListParams(path=str(_highlighted_pdf(tmp_path, rotation))), silent_progress()
    )
    quotes = {item.type: item.quote for item in result.items}
    assert quotes == {"Highlight": "experiment was repeated", "Underline": "unmarked"}


def test_markdown_export_quotes_marked_text_under_printed_page_labels(tmp_path: Path) -> None:
    result = export_comments(
        CommentsExportParams(
            path=str(_highlighted_pdf(tmp_path)),
            output=str(tmp_path / "notes"),
            format="md",
            page_label="Sayfa",
            type_labels={"Highlight": "Vurgu"},
        ),
        silent_progress(),
    )
    assert result.output.endswith(".md") and result.count == 2
    text = Path(result.output).read_text(encoding="utf-8")
    assert text.startswith("# highlighted-0.pdf\n\n## Sayfa iii\n\n> experiment was repeated\n")
    assert "Key \\*result\\*  \nsee \\[2\\]" in text
    assert "*Vurgu · Ayşe" in text
    assert "> unmarked" in text


def test_markdown_export_of_a_document_without_comments_is_a_title_and_a_dash(
    tmp_path: Path,
) -> None:
    document = pymupdf.open()
    document.new_page()
    source = tmp_path / "empty_notes.pdf"
    document.save(source)
    document.close()
    result = export_comments(
        CommentsExportParams(path=str(source), output=str(tmp_path / "out.md"), format="md"),
        silent_progress(),
    )
    assert result.count == 0
    assert Path(result.output).read_text(encoding="utf-8") == "# empty\\_notes.pdf\n\n—\n"
