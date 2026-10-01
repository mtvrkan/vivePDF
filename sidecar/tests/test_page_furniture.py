from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.furniture import RemoveFurnitureParams, remove_header_footer
from vivepdf.ops.header_footer import HeaderFooterParams, header_footer
from vivepdf.ops.letterhead import LetterheadParams, letterhead
from vivepdf.ops.page_numbers import PageNumberParams, number_pages
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def mixed(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for rotation in (0, 90, 270):
        page = document.new_page(width=595, height=842)
        page.insert_text((60, 400), f"govde {rotation}")
        page.set_rotation(rotation)
    path = tmp_path / "karışık sayfa.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def template(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((30, 40), "LOGO")
    path = tmp_path / "antet.pdf"
    document.save(path)
    document.close()
    return path


def _visible_words(path: Path, index: int) -> list[tuple[pymupdf.Rect, str]]:
    document = pymupdf.open(path)
    page = document[index]
    matrix = page.rotation_matrix
    words = [(pymupdf.Rect(word[:4]) * matrix, word[4]) for word in page.get_text("words")]
    document.close()
    return words


def _words(path: Path, index: int) -> list[str]:
    return [word for _rect, word in _visible_words(path, index)]


def test_page_numbers_are_marked_as_pagination_artifacts(mixed: Path, tmp_path: Path):
    result = number_pages(
        PageNumberParams(path=str(mixed), output=str(tmp_path / "n.pdf")), silent_progress()
    )
    document = pymupdf.open(result.output)
    content = document[0].read_contents()
    document.close()
    assert b"/Artifact <</Type /Pagination /Subtype /Footer /VivePDFRole /PageNumber>> BDC" in (
        content
    )


def test_renumbering_with_replace_leaves_one_set_of_numbers(mixed: Path, tmp_path: Path):
    first = number_pages(
        PageNumberParams(path=str(mixed), output=str(tmp_path / "a.pdf"), template="Sayfa {n}"),
        silent_progress(),
    )
    second = number_pages(
        PageNumberParams(
            path=first.output,
            output=str(tmp_path / "b.pdf"),
            template="S-{n}",
            replace_existing=True,
        ),
        silent_progress(),
    )
    for index in range(3):
        words = _words(Path(second.output), index)
        assert "Sayfa" not in words
        assert f"S-{index + 1}" in words


def test_header_start_number_and_replace(mixed: Path, tmp_path: Path):
    first = header_footer(
        HeaderFooterParams(
            path=str(mixed),
            output=str(tmp_path / "h.pdf"),
            footer_left="Gizli {n}/{total}",
            start=5,
        ),
        silent_progress(),
    )
    assert "5/7" in _words(Path(first.output), 0)
    assert "7/7" in _words(Path(first.output), 2)
    second = header_footer(
        HeaderFooterParams(
            path=first.output,
            output=str(tmp_path / "h2.pdf"),
            footer_left="Açık",
            replace_existing=True,
        ),
        silent_progress(),
    )
    words = _words(Path(second.output), 0)
    assert "Açık" in words
    assert "Gizli" not in words


def test_replacing_headers_keeps_page_numbers(mixed: Path, tmp_path: Path):
    numbered = number_pages(
        PageNumberParams(path=str(mixed), output=str(tmp_path / "n.pdf"), template="No {n}"),
        silent_progress(),
    )
    headed = header_footer(
        HeaderFooterParams(
            path=numbered.output,
            output=str(tmp_path / "h.pdf"),
            header_center="Başlık",
            replace_existing=True,
        ),
        silent_progress(),
    )
    assert {"No", "Başlık"} <= set(_words(Path(headed.output), 1))


def test_remove_takes_off_what_vivepdf_added_and_keeps_the_body(mixed: Path, tmp_path: Path):
    numbered = number_pages(
        PageNumberParams(path=str(mixed), output=str(tmp_path / "n.pdf")), silent_progress()
    )
    headed = header_footer(
        HeaderFooterParams(path=numbered.output, output=str(tmp_path / "h.pdf"), header_left="Üst"),
        silent_progress(),
    )
    cleaned = remove_header_footer(
        RemoveFurnitureParams(path=headed.output, output=str(tmp_path / "c.pdf")),
        silent_progress(),
    )
    assert cleaned.removed == 6
    assert cleaned.pages_changed == 3
    assert _words(Path(cleaned.output), 1) == ["govde", "90"]


def test_remove_with_nothing_to_remove_is_reported(mixed: Path, tmp_path: Path):
    with pytest.raises(OpError) as caught:
        remove_header_footer(
            RemoveFurnitureParams(path=str(mixed), output=str(tmp_path / "c.pdf")),
            silent_progress(),
        )
    assert caught.value.data == {"reason": "noHeaderFooter"}


def _foreign_furniture(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((50, 400), "body")
    xref = document.get_new_xref()
    document.update_object(xref, "<<>>")
    document.update_stream(
        xref,
        b"/Artifact <</Attached [/Top]/Subtype /Header /Type /Pagination >>BDC q BT /helv 9 Tf"
        b" 1 0 0 1 50 820 Tm (FOREIGN \\(EMC\\)) Tj ET Q EMC\n"
        b"/Artifact <</Subtype /Watermark /Type /Pagination >>BDC q BT /helv 30 Tf"
        b" 1 0 0 1 100 300 Tm (MARK) Tj ET Q EMC",
    )
    contents = [*page.get_contents(), xref]
    document.xref_set_key(
        page.xref, "Contents", "[" + " ".join(f"{item} 0 R" for item in contents) + "]"
    )
    path = tmp_path / "foreign.pdf"
    document.save(path)
    document.close()
    return path


def test_scope_all_removes_foreign_headers_but_not_watermarks(tmp_path: Path):
    source = _foreign_furniture(tmp_path)
    with pytest.raises(OpError):
        remove_header_footer(
            RemoveFurnitureParams(path=str(source), output=str(tmp_path / "v.pdf")),
            silent_progress(),
        )
    result = remove_header_footer(
        RemoveFurnitureParams(path=str(source), output=str(tmp_path / "a.pdf"), scope="all"),
        silent_progress(),
    )
    assert result.removed == 1
    assert _words(Path(result.output), 0) == ["body", "MARK"]


def test_letterhead_is_upright_on_rotated_pages(mixed: Path, template: Path, tmp_path: Path):
    result = letterhead(
        LetterheadParams(
            path=str(mixed), output=str(tmp_path / "l.pdf"), template_path=str(template)
        ),
        silent_progress(),
    )
    for index in range(3):
        logo = next(
            rect for rect, word in _visible_words(Path(result.output), index) if word == "LOGO"
        )
        assert logo.width > logo.height
        assert logo.y0 < 60


def test_letterhead_replace_swaps_the_template(mixed: Path, template: Path, tmp_path: Path):
    other = pymupdf.open()
    other.new_page(width=595, height=842).insert_text((300, 40), "YENI")
    other_path = tmp_path / "yeni.pdf"
    other.save(other_path)
    other.close()
    first = letterhead(
        LetterheadParams(
            path=str(mixed), output=str(tmp_path / "1.pdf"), template_path=str(template)
        ),
        silent_progress(),
    )
    second = letterhead(
        LetterheadParams(
            path=first.output,
            output=str(tmp_path / "2.pdf"),
            template_path=str(other_path),
            replace_existing=True,
        ),
        silent_progress(),
    )
    words = _words(Path(second.output), 0)
    assert "YENI" in words
    assert "LOGO" not in words


def test_letterhead_output_cannot_be_the_first_page_template(
    mixed: Path, template: Path, tmp_path: Path
):
    first_page = tmp_path / "ilk.pdf"
    first_page.write_bytes(template.read_bytes())
    with pytest.raises(OpError):
        letterhead(
            LetterheadParams(
                path=str(mixed),
                output=str(first_page),
                overwrite=True,
                template_path=str(template),
                first_page_template_path=str(first_page),
            ),
            silent_progress(),
        )
