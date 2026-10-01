from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.textedit import (
    TextEdit,
    TextEditParams,
    TextSpansParams,
    get_spans,
    replace_text,
)
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


@pytest.fixture
def layered(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((60, 100), "gizli katman", fontsize=12, render_mode=3)
    page.insert_text(
        (60, 140), "yarı saydam", fontsize=12, fontname="dejavu", fontfile=FONT, fill_opacity=0.5
    )
    page.insert_text((60, 180), "silinecek satır", fontsize=12, fontname="dejavu", fontfile=FONT)
    path = tmp_path / "layered.pdf"
    document.save(path)
    document.close()
    return path


def _spans(path: Path):
    return get_spans(TextSpansParams(path=str(path), page=0), silent_progress()).spans


def test_hidden_text_is_not_offered_for_editing(layered: Path):
    assert [span.text for span in _spans(layered)] == ["yarı saydam", "silinecek satır"]


def test_spans_report_their_opacity(layered: Path):
    opacities = {span.text: span.opacity for span in _spans(layered)}
    assert opacities["yarı saydam"] == pytest.approx(0.5, abs=0.01)
    assert opacities["silinecek satır"] == 1.0


def test_a_deleted_run_counts_as_a_change(layered: Path, tmp_path: Path):
    target = next(span for span in _spans(layered) if span.text == "silinecek satır")
    result = replace_text(
        TextEditParams(
            path=str(layered),
            output=str(tmp_path / "out.pdf"),
            page=0,
            edits=[TextEdit(bbox=target.bbox, text="", size=target.size, color=target.color)],
        ),
        silent_progress(),
    )
    assert result.replaced == 1
    with pymupdf.open(result.output) as document:
        assert "silinecek" not in document[0].get_text()


def test_a_zero_size_is_refused(layered: Path, tmp_path: Path):
    with pytest.raises(ValueError):
        TextEditParams(
            path=str(layered),
            output=str(tmp_path / "zero.pdf"),
            page=0,
            edits=[TextEdit(bbox=[0, 0, 10, 10], text="x", size=0, color="#000000")],
        )
    with pytest.raises(OpError):
        replace_text(
            TextEditParams(
                path=str(layered),
                output=str(tmp_path / "colour.pdf"),
                page=0,
                edits=[TextEdit(bbox=[60, 128, 160, 144], text="x", size=12, color="red")],
            ),
            silent_progress(),
        )
