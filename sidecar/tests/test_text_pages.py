from pathlib import Path

from vivepdf.ops.info import PageTextParams, page_text
from vivepdf.rpc.progress import silent_progress


def test_page_text_returns_selected_pages(sample_pdf: Path) -> None:
    result = page_text(PageTextParams(path=str(sample_pdf)), silent_progress())
    assert result.page_count == 3
    assert [entry.page for entry in result.pages] == [1, 2, 3]
    assert result.pages[1].text == "Page 2"
    subset = page_text(PageTextParams(path=str(sample_pdf), pages="3"), silent_progress())
    assert [entry.page for entry in subset.pages] == [3]
    assert subset.pages[0].text == "Page 3"
