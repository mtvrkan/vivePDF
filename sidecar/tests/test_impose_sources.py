from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.analyze import ImposeParams, impose
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


def _pages(tmp_path: Path, count: int, rotation: int = 0) -> Path:
    document = pymupdf.open()
    for index in range(count):
        page = document.new_page(width=600, height=800)
        page.insert_text((40, 60), f"TOP{index + 1}", fontsize=20)
        page.insert_text((40, 760), f"BOTTOM{index + 1}", fontsize=20)
        page.set_rotation(rotation)
    path = tmp_path / f"pages-{count}-{rotation}.pdf"
    document.save(path)
    document.close()
    return path


def test_rotated_pages_are_placed_whole(tmp_path: Path) -> None:
    source = _pages(tmp_path, 2, rotation=90)
    output = tmp_path / "out.pdf"
    impose(ImposeParams(path=str(source), output=str(output), layout="2up"), silent_progress())
    document = pymupdf.open(output)
    words = {word[4] for word in document[0].get_text("words")}
    assert {"TOP1", "BOTTOM1", "TOP2", "BOTTOM2"} <= words
    document.close()


def test_filled_fields_and_highlights_are_printed(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    widget = pymupdf.Widget()
    widget.field_name = "name"
    widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    widget.rect = pymupdf.Rect(40, 40, 300, 70)
    widget.field_value = "FILLEDVALUE"
    page.add_widget(widget)
    source = tmp_path / "form.pdf"
    document.save(source)
    document.close()
    output = tmp_path / "out.pdf"
    impose(ImposeParams(path=str(source), output=str(output), layout="2up"), silent_progress())
    result = pymupdf.open(output)
    assert "FILLEDVALUE" in result[0].get_text()
    result.close()


def test_short_edge_flip_turns_the_back_of_a_booklet_around(tmp_path: Path) -> None:
    source = _pages(tmp_path, 4)
    plain = tmp_path / "plain.pdf"
    flipped = tmp_path / "flipped.pdf"
    impose(ImposeParams(path=str(source), output=str(plain), layout="booklet"), silent_progress())
    impose(
        ImposeParams(path=str(source), output=str(flipped), layout="booklet", flip_short_edge=True),
        silent_progress(),
    )
    normal = pymupdf.open(plain)
    turned = pymupdf.open(flipped)
    front_normal = [(w[4], round(w[0])) for w in normal[0].get_text("words")]
    front_turned = [(w[4], round(w[0])) for w in turned[0].get_text("words")]
    assert front_normal == front_turned
    back_normal = {w[4]: w for w in normal[1].get_text("words")}
    back_turned = {w[4]: w for w in turned[1].get_text("words")}
    width = turned[1].rect.width
    assert back_normal["TOP2"][0] < width / 2
    assert back_turned["TOP2"][0] > width / 2
    assert back_turned["TOP2"][1] > back_turned["BOTTOM2"][1]
    normal.close()
    turned.close()


@pytest.mark.parametrize("extra", [{"margin": 5000}, {"gap": 5000}])
def test_impossible_spacing_is_refused(tmp_path: Path, extra: dict) -> None:
    source = _pages(tmp_path, 2)
    with pytest.raises(OpError) as caught:
        impose(
            ImposeParams(path=str(source), output=str(tmp_path / "x.pdf"), layout="4up", **extra),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_a_protected_document_stays_protected(tmp_path: Path) -> None:
    document = pymupdf.open()
    for index in range(4):
        document.new_page(width=600, height=800).insert_text((40, 60), f"PAGE{index + 1}")
    document.set_toc([[1, "Start", 1]])
    source = tmp_path / "protected.pdf"
    document.save(source, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
    document.close()
    output = tmp_path / "sheets.pdf"
    result = impose(
        ImposeParams(path=str(source), password="u", output=str(output), layout="2up"),
        silent_progress(),
    )
    assert result.sheets == 2
    sheets = pymupdf.open(output)
    assert sheets.needs_pass
    assert sheets.authenticate("u")
    assert sheets.page_count == 2
    assert sheets.get_toc() == []
    assert {"PAGE1", "PAGE2"} <= {word[4] for word in sheets[0].get_text("words")}
    sheets.close()
