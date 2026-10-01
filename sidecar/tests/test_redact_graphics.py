from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._redact_search import RedactArea
from vivepdf.ops.edit import RedactParams, redact
from vivepdf.rpc.progress import silent_progress

BOX = pymupdf.Rect(100, 100, 200, 160)


def _drawn(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=400, height=400)
    page.draw_line((50, 130), (350, 130), color=(0, 0, 1), width=2)
    page.draw_rect(pymupdf.Rect(120, 110, 180, 150), color=(1, 0, 0), width=1)
    page.draw_rect(pymupdf.Rect(260, 260, 320, 320), color=(0, 1, 0), width=1)
    page.insert_text((110, 140), "SECRET", fontsize=14)
    source = tmp_path / "drawn.pdf"
    document.save(source)
    document.close()
    return source


def _redacted(tmp_path: Path, **options: object) -> tuple[list[tuple[float, ...]], str]:
    source = _drawn(tmp_path)
    result = redact(
        RedactParams(
            path=str(source),
            output=str(tmp_path / f"out-{len(options)}.pdf"),
            areas=[RedactArea(page=1, x0=BOX.x0, y0=BOX.y0, x1=BOX.x1, y1=BOX.y1)],
            **options,
        ),
        silent_progress(),
    )
    with pymupdf.open(result.output) as document:
        return _colours(document[0]), document[0].get_text()


def _colours(page: pymupdf.Page) -> list[tuple[float, ...]]:
    return [tuple(drawing["color"]) for drawing in page.get_drawings() if drawing.get("color")]


def test_a_path_crossing_the_box_is_removed_by_default(tmp_path: Path) -> None:
    colours, text = _redacted(tmp_path)
    assert (0.0, 0.0, 1.0) not in colours
    assert (1.0, 0.0, 0.0) not in colours
    assert (0.0, 1.0, 0.0) in colours
    assert "SECRET" not in text


def test_contained_mode_keeps_paths_that_leave_the_box(tmp_path: Path) -> None:
    colours, text = _redacted(tmp_path, graphics="contained")
    assert (0.0, 0.0, 1.0) in colours
    assert (1.0, 0.0, 0.0) not in colours
    assert "SECRET" not in text


def test_an_unknown_graphics_mode_is_refused() -> None:
    with pytest.raises(ValueError):
        RedactParams(path="a.pdf", output="b.pdf", graphics="everything")
