from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._ranges import filter_side
from vivepdf.ops._watermark_style import WatermarkParams
from vivepdf.ops.edit import RedactParams, redact
from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.ops.security_watermark import watermark
from vivepdf.ops.stamp import StampParams, stamp
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def six_pages(tmp_path: Path) -> Path:
    document = pymupdf.open()
    for index in range(6):
        document.new_page(width=595, height=842).insert_text(
            (60, 80), f"Sayfa {index + 1}", fontsize=12
        )
    path = tmp_path / "six.pdf"
    document.save(path)
    document.close()
    return path


def _marked(path: Path, needle: str) -> list[int]:
    reader = pymupdf.open(path)
    pages = [index + 1 for index in range(reader.page_count) if reader[index].search_for(needle)]
    reader.close()
    return pages


def _draw_order(path: Path) -> list[str]:
    reader = pymupdf.open(path)
    order = [
        span["text"].strip()
        for block in reader[0].get_text("dict")["blocks"]
        if block.get("type") == 0
        for line in block["lines"]
        for span in line["spans"]
    ]
    reader.close()
    return order


def test_filter_side_picks_odd_and_even_page_numbers():
    assert filter_side([0, 1, 2, 3], "all") == [0, 1, 2, 3]
    assert filter_side([0, 1, 2, 3], "odd") == [0, 2]
    assert filter_side([0, 1, 2, 3], "even") == [1, 3]
    with pytest.raises(OpError):
        filter_side([0], "middle")


def test_a_mark_can_be_put_behind_the_page_content(six_pages: Path, tmp_path: Path):
    over = tmp_path / "over.pdf"
    under = tmp_path / "under.pdf"
    watermark(
        WatermarkParams(path=str(six_pages), output=str(over), text="ALT", opacity=1.0),
        silent_progress(),
    )
    watermark(
        WatermarkParams(
            path=str(six_pages), output=str(under), text="ALT", opacity=1.0, behind=True
        ),
        silent_progress(),
    )
    assert _draw_order(over)[-1] == "ALT"
    assert _draw_order(under)[0] == "ALT"


def test_a_watermark_can_have_several_lines(six_pages: Path, tmp_path: Path):
    target = tmp_path / "lines.pdf"
    watermark(
        WatermarkParams(path=str(six_pages), output=str(target), text="BIR\nIKI\nUC"),
        silent_progress(),
    )
    reader = pymupdf.open(target)
    boxes = [reader[0].search_for(word)[0] for word in ("BIR", "IKI", "UC")]
    reader.close()
    centres = [(box.y0 + box.y1) / 2 for box in boxes]
    assert centres == sorted(centres)
    assert centres[2] - centres[0] > 20


def test_tile_spacing_changes_how_many_marks_fit(six_pages: Path, tmp_path: Path):
    counts = []
    for gap in (60, 250):
        target = tmp_path / f"tile-{gap}.pdf"
        watermark(
            WatermarkParams(
                path=str(six_pages),
                output=str(target),
                text="X",
                position="tile",
                font_size=20,
                tile_gap=gap,
            ),
            silent_progress(),
        )
        reader = pymupdf.open(target)
        counts.append(len(reader[0].search_for("X")))
        reader.close()
    assert counts[0] > counts[1]


def test_odd_and_even_pages_can_be_marked_on_their_own(six_pages: Path, tmp_path: Path):
    odd = tmp_path / "odd.pdf"
    even = tmp_path / "even.pdf"
    watermark(
        WatermarkParams(path=str(six_pages), output=str(odd), text="ONAY", side="odd"),
        silent_progress(),
    )
    watermark(
        WatermarkParams(path=str(six_pages), output=str(even), text="ONAY", side="even"),
        silent_progress(),
    )
    assert _marked(odd, "ONAY") == [1, 3, 5]
    assert _marked(even, "ONAY") == [2, 4, 6]


def test_a_range_and_a_side_apply_together(six_pages: Path, tmp_path: Path):
    target = tmp_path / "both.pdf"
    watermark(
        WatermarkParams(
            path=str(six_pages), output=str(target), text="ONAY", pages="2-5", side="odd"
        ),
        silent_progress(),
    )
    assert _marked(target, "ONAY") == [3, 5]


def test_an_empty_selection_is_refused(six_pages: Path, tmp_path: Path):
    with pytest.raises(OpError) as caught:
        watermark(
            WatermarkParams(
                path=str(six_pages),
                output=str(tmp_path / "none.pdf"),
                text="ONAY",
                pages="2",
                side="odd",
            ),
            silent_progress(),
        )
    assert caught.value.code == ErrorCode.INVALID_PARAMS


def test_the_offsets_move_the_mark(six_pages: Path, tmp_path: Path):
    centres = []
    for dx, dy in ((0, 0), (25, -30)):
        target = tmp_path / f"offset-{dx}-{dy}.pdf"
        watermark(
            WatermarkParams(
                path=str(six_pages),
                output=str(target),
                text="KAY",
                rotation=0,
                offset_x=dx,
                offset_y=dy,
            ),
            silent_progress(),
        )
        reader = pymupdf.open(target)
        box = reader[0].search_for("KAY")[0]
        reader.close()
        centres.append(((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2))
    assert centres[1][0] - centres[0][0] == pytest.approx(595 * 0.25, abs=2)
    assert centres[1][1] - centres[0][1] == pytest.approx(-842 * 0.30, abs=2)


def test_a_pdf_page_can_be_used_as_the_watermark(six_pages: Path, tmp_path: Path):
    template = tmp_path / "template.pdf"
    document = pymupdf.open()
    document.new_page(width=595, height=842).insert_text((100, 400), "SABLON", fontsize=40)
    document.save(template)
    document.close()

    target = tmp_path / "from-pdf.pdf"
    watermark(
        WatermarkParams(
            path=str(six_pages),
            output=str(target),
            kind="pdf",
            template_path=str(template),
            template_page=1,
        ),
        silent_progress(),
    )
    reader = pymupdf.open(target)
    counts = [len(reader[index].get_images()) for index in range(reader.page_count)]
    reader.close()
    assert all(count == 1 for count in counts)


def test_a_missing_template_is_refused(six_pages: Path, tmp_path: Path):
    with pytest.raises(OpError):
        watermark(
            WatermarkParams(
                path=str(six_pages), output=str(tmp_path / "x.pdf"), kind="pdf", template_path=""
            ),
            silent_progress(),
        )


def test_the_stamp_takes_the_same_options(six_pages: Path, tmp_path: Path):
    target = tmp_path / "stamp.pdf"
    result = stamp(
        StampParams(
            path=str(six_pages),
            output=str(target),
            text="ONAYLANDI\nIKINCI",
            side="even",
            behind=True,
            offset_x=-10,
        ),
        silent_progress(),
    )
    assert result.stamped == 3
    assert _marked(target, "ONAYLANDI") == [2, 4, 6]
    assert _marked(target, "IKINCI") == [2, 4, 6]


def test_invisible_text_is_reported_and_only_removed_when_asked(tmp_path: Path):
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((60, 100), "gorunur metin", fontsize=12)
    page.insert_text((60, 140), "GIZLENMIS", fontsize=12, render_mode=3)
    source = tmp_path / "hidden.pdf"
    document.save(source)
    document.close()

    assert inspect(InspectParams(path=str(source)), silent_progress()).hidden_text == 1

    kept = tmp_path / "kept.pdf"
    sanitize(SanitizeParams(path=str(source), output=str(kept)), silent_progress())
    assert inspect(InspectParams(path=str(kept)), silent_progress()).hidden_text == 1

    stripped = tmp_path / "stripped.pdf"
    result = sanitize(
        SanitizeParams(path=str(source), output=str(stripped), hidden_text=True), silent_progress()
    )
    reader = pymupdf.open(stripped)
    text = reader[0].get_text()
    reader.close()
    assert result.removed.get("hiddenText") == 1
    assert inspect(InspectParams(path=str(stripped)), silent_progress()).hidden_text == 0
    assert "gorunur metin" in text
    assert "GIZLENMIS" not in text


def test_a_redaction_box_can_carry_a_label_and_a_colour(tmp_path: Path):
    document = pymupdf.open()
    document.new_page(width=595, height=842).insert_text(
        (60, 100), "iletisim: ali.veli@ornek.com", fontsize=12
    )
    source = tmp_path / "redact.pdf"
    document.save(source)
    document.close()

    target = tmp_path / "labelled.pdf"
    redact(
        RedactParams(
            path=str(source),
            output=str(target),
            presets=["email"],
            overlay_text="KVKK",
            fill="#1F3A93",
        ),
        silent_progress(),
    )
    reader = pymupdf.open(target)
    text = reader[0].get_text()
    fills = {
        tuple(round(channel, 2) for channel in item["fill"])
        for item in reader[0].get_drawings()
        if item.get("fill")
    }
    reader.close()
    assert "KVKK" in text
    assert "ali.veli@ornek.com" not in text
    assert (0.12, 0.23, 0.58) in fills


GRID_THIRDS = {
    "top-left": (0, 0),
    "top-center": (1, 0),
    "top-right": (2, 0),
    "middle-left": (0, 1),
    "center": (1, 1),
    "middle-right": (2, 1),
    "bottom-left": (0, 2),
    "bottom-center": (1, 2),
    "bottom-right": (2, 2),
}


def _third_of(rect: pymupdf.Rect, page: pymupdf.Rect) -> tuple[int, int]:
    column = min(2, int((rect.x0 + rect.x1) / 2 / (page.width / 3)))
    row = min(2, int((rect.y0 + rect.y1) / 2 / (page.height / 3)))
    return column, row


def _mark_rect(path: Path, needle: str) -> tuple[pymupdf.Rect, pymupdf.Rect]:
    reader = pymupdf.open(path)
    found = reader[0].search_for(needle)
    assert found, f"'{needle}' not on the page"
    rect, page_rect = found[0], reader[0].rect
    reader.close()
    return rect, page_rect


@pytest.mark.parametrize("position", sorted(GRID_THIRDS))
def test_a_watermark_lands_in_the_grid_cell_it_was_given(
    position: str, six_pages: Path, tmp_path: Path
):
    target = tmp_path / f"watermark-{position}.pdf"
    watermark(
        WatermarkParams(
            path=str(six_pages),
            output=str(target),
            text="ISARET",
            font_size=16,
            rotation=0,
            position=position,
        ),
        silent_progress(),
    )
    rect, page_rect = _mark_rect(target, "ISARET")
    assert _third_of(rect, page_rect) == GRID_THIRDS[position]


@pytest.mark.parametrize("position", sorted(GRID_THIRDS))
def test_a_stamp_lands_in_the_grid_cell_it_was_given(
    position: str, six_pages: Path, tmp_path: Path
):
    target = tmp_path / f"stamp-{position}.pdf"
    stamp(
        StampParams(
            path=str(six_pages),
            output=str(target),
            text="MUHUR",
            font_size=14,
            rotation=0,
            position=position,
        ),
        silent_progress(),
    )
    rect, page_rect = _mark_rect(target, "MUHUR")
    assert _third_of(rect, page_rect) == GRID_THIRDS[position]
