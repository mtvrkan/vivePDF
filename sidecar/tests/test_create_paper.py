from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops._paper import PaperPattern
from vivepdf.ops.create_paper import CreatePaperParams, create_paper
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress


def _segments(page: pymupdf.Page) -> int:
    return sum(len(drawing["items"]) for drawing in page.get_drawings())


def test_lined_paper_repeats_one_shared_pattern_on_every_page(tmp_path: Path):
    params = CreatePaperParams(
        size="a5",
        pages=40,
        pattern=PaperPattern(style="lined", spacing=8, margin=True),
        output=str(tmp_path / "lined.pdf"),
    )

    result = create_paper(params, silent_progress())

    assert result.page_count == 40
    with pymupdf.open(result.output) as document:
        assert document[0].rect == pymupdf.paper_rect("a5")
        assert _segments(document[0]) > 10
        assert _segments(document[39]) == _segments(document[0])
    single = create_paper(
        params.model_copy(update={"pages": 1, "output": str(tmp_path / "one.pdf")}),
        silent_progress(),
    )
    assert result.bytes < single.bytes * 40 / 3


def test_plain_landscape_paper_has_empty_pages(tmp_path: Path):
    params = CreatePaperParams(
        size="a4", landscape=True, pages=3, output=str(tmp_path / "plain.pdf")
    )

    result = create_paper(params, silent_progress())

    with pymupdf.open(result.output) as document:
        assert document.page_count == 3
        assert document[0].rect.width > document[0].rect.height
        assert document[2].get_drawings() == []


def test_existing_output_is_kept_unless_overwrite(tmp_path: Path):
    target = tmp_path / "dots.pdf"
    target.write_bytes(b"keep")
    params = CreatePaperParams(
        pages=1, pattern=PaperPattern(style="dots", spacing=5), output=str(target)
    )

    with pytest.raises(OpError):
        create_paper(params, silent_progress())
    assert target.read_bytes() == b"keep"
    assert (
        create_paper(params.model_copy(update={"overwrite": True}), silent_progress()).page_count
        == 1
    )
