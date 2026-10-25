import html
import threading
from pathlib import Path

import pymupdf
import pytest

from vivepdf.ops.convert_svg import SvgParams, to_svg
from vivepdf.rpc.errors import ErrorCode, OpError
from vivepdf.rpc.progress import Progress, silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)


def _drawn_page(
    document: pymupdf.Document, width: float = 200, height: float = 120
) -> pymupdf.Page:
    page = document.new_page(width=width, height=height)
    page.draw_rect(pymupdf.Rect(10, 10, 90, 60), color=(0.8, 0, 0), fill=(0.8, 0, 0))
    page.draw_circle((150, 80), 25, color=(0, 0, 0.7), fill=(0, 0, 0.7))
    page.insert_text((20, 100), "Çizim ğüşıö", fontsize=14, fontname="dv", fontfile=FONT)
    return page


@pytest.fixture
def drawn_pdf(tmp_path: Path) -> Path:
    document = pymupdf.open()
    _drawn_page(document)
    _drawn_page(document).set_rotation(90)
    cropped = _drawn_page(document)
    cropped.set_cropbox(pymupdf.Rect(40, 20, 190, 110))
    target = tmp_path / "çizimler.pdf"
    document.save(target)
    return target


def _pixels(page: pymupdf.Page, size: tuple[int, int]) -> bytes:
    zoom = size[0] / page.rect.width
    return page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False).samples


def _difference(first: bytes, second: bytes) -> float:
    return sum(abs(a - b) for a, b in zip(first, second, strict=True)) / len(first)


def test_each_page_becomes_an_svg_that_looks_like_the_page(drawn_pdf: Path, tmp_path: Path) -> None:
    result = to_svg(
        SvgParams(path=str(drawn_pdf), output_dir=str(tmp_path / "svg")), silent_progress()
    )

    assert [Path(output).name for output in result.outputs] == [
        "çizimler-1.svg",
        "çizimler-2.svg",
        "çizimler-3.svg",
    ]
    assert result.page_count == 3
    assert result.bytes == sum(Path(output).stat().st_size for output in result.outputs)
    with pymupdf.open(drawn_pdf) as source:
        for index, output in enumerate(result.outputs):
            page = source[index]
            with pymupdf.open(output) as drawing:
                shown = drawing[0]
                assert shown.rect.width == pytest.approx(page.rect.width, abs=0.5)
                assert shown.rect.height == pytest.approx(page.rect.height, abs=0.5)
                size = (round(page.rect.width), round(page.rect.height))
                assert _difference(_pixels(page, size), _pixels(shown, size)) < 4


def test_text_is_drawn_as_outlines_unless_kept_as_text(drawn_pdf: Path, tmp_path: Path) -> None:
    outlined = to_svg(
        SvgParams(path=str(drawn_pdf), output_dir=str(tmp_path / "a"), pages="1"),
        silent_progress(),
    )
    kept = to_svg(
        SvgParams(
            path=str(drawn_pdf), output_dir=str(tmp_path / "b"), pages="1", text_as_text=True
        ),
        silent_progress(),
    )

    assert "<text" not in Path(outlined.outputs[0]).read_text(encoding="utf-8")
    kept_svg = Path(kept.outputs[0]).read_text(encoding="utf-8")
    assert "<text" in kept_svg
    assert "Çizim ğüşıö" in html.unescape(kept_svg)


def test_only_the_chosen_pages_are_written(drawn_pdf: Path, tmp_path: Path) -> None:
    result = to_svg(
        SvgParams(
            path=str(drawn_pdf), output_dir=str(tmp_path / "svg"), pages="3", base_name="kesit"
        ),
        silent_progress(),
    )

    assert [Path(output).name for output in result.outputs] == ["kesit-3.svg"]
    assert sorted(path.name for path in (tmp_path / "svg").iterdir()) == ["kesit-3.svg"]


def test_existing_files_are_kept_unless_overwrite_is_asked(drawn_pdf: Path, tmp_path: Path) -> None:
    folder = tmp_path / "svg"
    folder.mkdir()
    (folder / "çizimler-2.svg").write_text("eski", encoding="utf-8")

    with pytest.raises(OpError) as caught:
        to_svg(SvgParams(path=str(drawn_pdf), output_dir=str(folder)), silent_progress())

    assert caught.value.code == ErrorCode.INVALID_PARAMS
    assert caught.value.data["exists"] is True
    assert sorted(path.name for path in folder.iterdir()) == ["çizimler-2.svg"]
    assert (folder / "çizimler-2.svg").read_text(encoding="utf-8") == "eski"
    to_svg(
        SvgParams(path=str(drawn_pdf), output_dir=str(folder), overwrite=True), silent_progress()
    )
    assert (folder / "çizimler-2.svg").read_text(encoding="utf-8").startswith("<svg")


def test_cancelling_leaves_the_folder_as_it_was(drawn_pdf: Path, tmp_path: Path) -> None:
    folder = tmp_path / "svg"
    folder.mkdir()
    (folder / "çizimler-3.svg").write_text("eski", encoding="utf-8")
    cancel = threading.Event()

    def sink(_value, message, detail):
        if message == "progress.rendering" and detail["current"] == 3:
            cancel.set()

    with pytest.raises(OpError) as caught:
        to_svg(
            SvgParams(path=str(drawn_pdf), output_dir=str(folder), overwrite=True),
            Progress(sink, cancel),
        )

    assert caught.value.code == ErrorCode.CANCELLED
    assert sorted(path.name for path in folder.iterdir()) == ["çizimler-3.svg"]
    assert (folder / "çizimler-3.svg").read_text(encoding="utf-8") == "eski"


def test_a_page_range_past_the_end_is_refused(drawn_pdf: Path, tmp_path: Path) -> None:
    with pytest.raises(OpError) as caught:
        to_svg(
            SvgParams(path=str(drawn_pdf), output_dir=str(tmp_path / "svg"), pages="7"),
            silent_progress(),
        )

    assert caught.value.code == ErrorCode.INVALID_PARAMS
