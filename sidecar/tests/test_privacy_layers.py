from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.privacy import InspectParams, inspect
from vivepdf.ops.privacy_sanitize import SanitizeParams, sanitize
from vivepdf.rpc.progress import silent_progress


@pytest.fixture
def layered_pdf(tmp_path: Path) -> Path:
    document = pymupdf.Document()
    page = document.new_page(width=595, height=842)
    hidden_ocg = document.add_ocg("Hidden", on=False)
    visible_ocg = document.add_ocg("Visible", on=True)
    page.insert_text((72, 72), "plain visible text")
    page.insert_text((72, 120), "secret hidden text", oc=hidden_ocg)
    page.insert_text((72, 160), "layered visible text", oc=visible_ocg)
    path = tmp_path / "layered.pdf"
    document.save(path)
    document.close()
    return path


@pytest.fixture
def bookmarked_pdf(tmp_path: Path) -> Path:
    document = pymupdf.Document()
    document.new_page()
    document.new_page()
    document.set_toc([[1, "Chapter 1", 1], [1, "Chapter 2", 2]])
    path = tmp_path / "bookmarked.pdf"
    document.save(path)
    document.close()
    return path


def test_inspect_reports_hidden_layers(layered_pdf: Path) -> None:
    report = inspect(InspectParams(path=str(layered_pdf)), silent_progress())
    assert report.layers == 2
    assert report.hidden_layers == 1


def test_sanitize_flattens_hidden_layers(layered_pdf: Path, tmp_path: Path) -> None:
    target = tmp_path / "flat.pdf"
    result = sanitize(
        SanitizeParams(path=str(layered_pdf), output=str(target), hidden_layers=True),
        silent_progress(),
    )
    assert result.removed["hiddenLayers"] == 1
    after = inspect(InspectParams(path=str(target)), silent_progress())
    assert after.hidden_layers == 0
    with pymupdf.open(target) as document:
        text = document[0].get_text()
    assert "secret hidden text" not in text
    assert "plain visible text" in text
    assert "layered visible text" in text


def test_inspect_reports_bookmark_count(bookmarked_pdf: Path) -> None:
    report = inspect(InspectParams(path=str(bookmarked_pdf)), silent_progress())
    assert report.bookmarks == 2


def test_sanitize_removes_bookmarks(bookmarked_pdf: Path, tmp_path: Path) -> None:
    target = tmp_path / "clean.pdf"
    result = sanitize(
        SanitizeParams(path=str(bookmarked_pdf), output=str(target), bookmarks=True),
        silent_progress(),
    )
    assert result.removed["bookmarks"] == 2
    with pymupdf.open(target) as document:
        toc = document.get_toc()
    assert toc == []


def test_sanitize_with_only_new_switches_off_changes_neither(
    layered_pdf: Path, tmp_path: Path
) -> None:
    target = tmp_path / "unchanged.pdf"
    result = sanitize(
        SanitizeParams(path=str(layered_pdf), output=str(target)),
        silent_progress(),
    )
    assert "hiddenLayers" not in result.removed
    assert "bookmarks" not in result.removed
    after = inspect(InspectParams(path=str(target)), silent_progress())
    assert after.hidden_layers == 1
    assert after.layers == 2
