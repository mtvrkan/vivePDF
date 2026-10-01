from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.preflight import PreflightParams
from vivepdf.ops.preflight import check as preflight
from vivepdf.rpc.progress import silent_progress


def _built(path: Path, draw) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    draw(document, page)
    document.save(path)
    document.close()
    return path


def _status(report, name: str) -> str:
    for item in report.checks:
        if item.id == name:
            return item.status
    raise AssertionError(f"no check called {name}")


@pytest.fixture
def hairline(tmp_path: Path) -> Path:
    return _built(
        tmp_path / "hairline.pdf",
        lambda _document, page: page.draw_line(
            pymupdf.Point(100, 100), pymupdf.Point(400, 100), width=0.1
        ),
    )


@pytest.fixture
def solid_line(tmp_path: Path) -> Path:
    return _built(
        tmp_path / "solid.pdf",
        lambda _document, page: page.draw_line(
            pymupdf.Point(100, 100), pymupdf.Point(400, 100), width=1.5
        ),
    )


def test_a_line_too_thin_to_print_is_reported(hairline: Path):
    report = preflight(PreflightParams(path=str(hairline)), silent_progress())
    assert report.hairline_pages == 1
    assert _status(report, "hairlines") == "warn"


def test_an_ordinary_line_is_not(solid_line: Path):
    report = preflight(PreflightParams(path=str(solid_line)), silent_progress())
    assert report.hairline_pages == 0
    assert _status(report, "hairlines") == "pass"


def test_ink_running_to_the_paper_edge_without_bleed_is_reported(tmp_path: Path):
    path = _built(
        tmp_path / "edge.pdf",
        lambda _document, page: page.draw_rect(pymupdf.Rect(0, 0, 595, 200), fill=(0.2, 0.4, 0.8)),
    )
    report = preflight(PreflightParams(path=str(path)), silent_progress())
    assert report.edge_pages == 1
    assert not report.has_bleed
    assert _status(report, "bleed") == "warn"


def test_a_page_that_keeps_its_margins_is_not_reported(tmp_path: Path):
    path = _built(
        tmp_path / "inside.pdf",
        lambda _document, page: page.draw_rect(
            pymupdf.Rect(60, 60, 500, 200), fill=(0.2, 0.4, 0.8)
        ),
    )
    report = preflight(PreflightParams(path=str(path)), silent_progress())
    assert report.edge_pages == 0
    assert _status(report, "bleed") == "pass"


def test_a_page_with_a_bleed_box_may_run_to_the_edge(tmp_path: Path):
    def draw(document, page):
        page.draw_rect(pymupdf.Rect(0, 0, 595, 200), fill=(0.2, 0.4, 0.8))
        document.xref_set_key(page.xref, "TrimBox", "[14 14 581 828]")
        document.xref_set_key(page.xref, "BleedBox", "[0 0 595 842]")

    path = _built(tmp_path / "bled.pdf", draw)
    report = preflight(PreflightParams(path=str(path)), silent_progress())
    assert report.has_bleed
    assert _status(report, "bleed") == "pass"
