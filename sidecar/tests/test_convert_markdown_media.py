import io
import threading
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from vivepdf.ops.convert_text import MarkdownParams, MarkdownResult, to_markdown
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress


def _png(colour: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (400, 300), colour).save(buffer, "PNG")
    return buffer.getvalue()


def _link(page: pymupdf.Page, point: tuple[float, float], before: str, word: str, uri: str) -> None:
    start = point[0] + pymupdf.get_text_length(before, fontsize=12)
    width = pymupdf.get_text_length(word, fontsize=12)
    area = pymupdf.Rect(start, point[1] - 10, start + width, point[1] + 3)
    page.insert_link({"kind": pymupdf.LINK_URI, "from": area, "uri": uri})


@pytest.fixture
def media_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Project Report", fontsize=22)
    page.insert_text((72, 110), "Visit our website for more details about it.", fontsize=12)
    page.insert_text((72, 130), "Write to the team or open the script link.", fontsize=12)
    _link(page, (72, 110), "Visit our ", "website", "https://example.com/a b(1)")
    _link(page, (72, 130), "Write to the ", "team", "mailto:team@example.com")
    _link(page, (72, 130), "Write to the team or open the ", "script", "javascript:alert(1)")
    page.insert_image(pymupdf.Rect(72, 200, 372, 425), stream=_png((200, 40, 40)))
    page.insert_text((72, 460), "Text below the picture.", fontsize=12)
    scan = document.new_page()
    scan.insert_image(scan.rect, stream=_png((40, 40, 200)))
    target = tmp_path / "my notes.pdf"
    document.save(target)
    return target


def _convert(source: Path, output: Path, pictures: str, **extra) -> MarkdownResult:
    return to_markdown(
        MarkdownParams(path=str(source), output=str(output), pictures=pictures, **extra),
        silent_progress(),
    )


def test_links_become_markdown_links_for_safe_schemes_only(media_pdf: Path, tmp_path: Path) -> None:
    result = _convert(media_pdf, tmp_path / "links.md", "none")
    text = Path(result.output).read_text(encoding="utf-8")
    assert "[website](https://example.com/a%20b%281%29)" in text
    assert "[team](mailto:team@example.com)" in text
    assert "javascript" not in text and "script" in text
    assert result.picture_count == 0 and result.picture_folder is None
    assert "![](" not in text


def test_pictures_are_saved_in_a_folder_next_to_the_file(media_pdf: Path, tmp_path: Path) -> None:
    output = tmp_path / "my notes.md"
    result = _convert(media_pdf, output, "files")
    folder = tmp_path / "my notes-images"
    names = sorted(entry.name for entry in folder.iterdir())
    assert names == ["page-0001-01.png", "page-0002-01.png"]
    assert result.picture_count == 2 and result.picture_folder == str(folder)
    text = output.read_text(encoding="utf-8")
    assert "![](my%20notes-images/page-0001-01.png)" in text
    assert "![](my%20notes-images/page-0002-01.png)" in text
    assert result.textless_pages == [2]
    with Image.open(folder / "page-0001-01.png") as picture:
        assert picture.size[0] > 500
    assert sorted(entry.name for entry in tmp_path.iterdir()) == sorted(
        ["my notes.pdf", "my notes.md", "my notes-images"]
    )


def test_pictures_can_be_embedded_in_the_file(media_pdf: Path, tmp_path: Path) -> None:
    result = _convert(media_pdf, tmp_path / "inline.md", "embed")
    text = Path(result.output).read_text(encoding="utf-8")
    assert text.count("![](data:image/png;base64,") == 2
    assert result.picture_count == 2 and result.picture_folder is None
    assert sorted(entry.name for entry in tmp_path.iterdir()) == ["inline.md", "my notes.pdf"]


def test_an_existing_picture_folder_is_asked_about_and_kept_on_overwrite(
    media_pdf: Path, tmp_path: Path
) -> None:
    folder = tmp_path / "notes-images"
    folder.mkdir()
    (folder / "mine.txt").write_text("keep", encoding="utf-8")
    output = tmp_path / "notes.md"
    with pytest.raises(OpError) as caught:
        _convert(media_pdf, output, "files")
    assert caught.value.data == {"exists": True, "path": str(folder)}
    assert not output.exists()
    _convert(media_pdf, output, "files", overwrite=True)
    assert (folder / "mine.txt").read_text(encoding="utf-8") == "keep"
    assert (folder / "page-0001-01.png").exists()


def test_a_cancelled_run_leaves_no_folder_or_file(media_pdf: Path, tmp_path: Path) -> None:
    cancel = threading.Event()

    def sink(_value, message, _detail):
        if message == "progress.convertingPages":
            cancel.set()

    with pytest.raises(OpError) as caught:
        to_markdown(
            MarkdownParams(path=str(media_pdf), output=str(tmp_path / "x.md"), pictures="files"),
            Progress(sink, cancel),
        )
    assert caught.value.code == ErrorCode.CANCELLED
    assert [entry.name for entry in tmp_path.iterdir()] == ["my notes.pdf"]
