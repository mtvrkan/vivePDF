import os
import re
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.compress import CompressParams, compress
from vivepdf.ops.editor import EditorApplyParams, apply
from vivepdf.ops.info import PageTextParams, page_text
from vivepdf.ops.pages import RotateParams, rotate_pages
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

pytestmark = pytest.mark.robustness_full

REAL_DIR = os.environ.get("VIVEPDF_ROBUSTNESS_REAL_DIR")
MARKER = "vivePDF journey marker"
PRIVATE_USE = re.compile("[-]")
MIN_WORDS_FOR_TEXT_CHECK = 20
KEPT_WORD_SHARE = 0.95
MAX_JOURNEY_PAGES = 400


def _documents() -> list[Path]:
    if not REAL_DIR:
        return []
    return sorted(Path(REAL_DIR).rglob("*.pdf"))


def _openable(source: Path) -> tuple[int, int] | None:
    try:
        with pymupdf.open(source) as document:
            if document.needs_pass or document.page_count == 0:
                return None
            return document.page_count, document[0].rotation
    except Exception:
        return None


def _words(path: Path, index: int) -> list[str]:
    with pymupdf.open(path) as document:
        return document[index].get_text().split()


def _page_text(path: Path, index: int) -> str:
    with pymupdf.open(path) as document:
        return document[index].get_text()


def _kept_share(before: list[str], after: list[str]) -> float:
    remaining = list(after)
    kept = 0
    for word in before:
        if word in remaining:
            remaining.remove(word)
            kept += 1
    return kept / len(before)


def _run(action):
    try:
        return action()
    except OpError as error:
        pytest.skip(f"{error.code.value}: {error.message}")


@pytest.mark.skipif(not REAL_DIR, reason="set VIVEPDF_ROBUSTNESS_REAL_DIR to a folder of PDFs")
@pytest.mark.parametrize("source", _documents(), ids=lambda path: f"{path.parent.name}/{path.name}")
def test_a_student_session_on_a_real_document(source: Path, tmp_path: Path):
    opened = _openable(source)
    if opened is None:
        pytest.skip("encrypted, empty or unreadable by PyMuPDF")
    page_count, first_rotation = opened
    if page_count > MAX_JOURNEY_PAGES:
        pytest.skip(f"{page_count} pages")

    reading = _run(
        lambda: page_text(
            PageTextParams(path=str(source), pages=f"1-{min(page_count, 5)}"), silent_progress()
        )
    )
    leftovers = [page.page for page in reading.pages if PRIVATE_USE.search(page.text)]
    assert not leftovers, f"private-use glyphs left in the reading text of pages {leftovers}"

    with pymupdf.open(source) as document:
        width, height = document[0].rect.width, document[0].rect.height
    edited = tmp_path / "edited.pdf"
    result = _run(
        lambda: apply(
            EditorApplyParams(
                path=str(source),
                output=str(edited),
                objects=[
                    {
                        "kind": "text",
                        "page": 1,
                        "x0": width * 0.1,
                        "y0": height * 0.05,
                        "x1": width * 0.9,
                        "y1": height * 0.05 + 30,
                        "text": MARKER,
                        "fontSize": 12,
                    }
                ],
            ),
            silent_progress(),
        )
    )
    overflowed = any(warning.code == "textOverflow" for warning in result.warnings)
    with pymupdf.open(edited) as document:
        assert document.page_count == page_count
        written = MARKER in " ".join(document[0].get_text().split())
        assert written or overflowed, "the new text vanished without a textOverflow warning"
    if page_count > 1:
        assert _page_text(edited, 1) == _page_text(source, 1), (
            "adding text to page 1 changed page 2"
        )

    compressed = tmp_path / "compressed.pdf"
    _run(
        lambda: compress(
            CompressParams(path=str(source), output=str(compressed)), silent_progress()
        )
    )
    with pymupdf.open(compressed) as document:
        assert document.page_count == page_count
    before = _words(source, 0)
    if len(before) >= MIN_WORDS_FOR_TEXT_CHECK:
        assert _kept_share(before, _words(compressed, 0)) >= KEPT_WORD_SHARE, (
            "compressing lost text on page 1"
        )

    turned = tmp_path / "turned.pdf"
    _run(
        lambda: rotate_pages(
            RotateParams(path=str(source), output=str(turned), pages="1", degrees=90),
            silent_progress(),
        )
    )
    with pymupdf.open(turned) as document:
        assert document[0].rotation == (first_rotation + 90) % 360
        assert document.page_count == page_count
