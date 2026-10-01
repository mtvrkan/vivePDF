import sys
from pathlib import Path

import pymupdf
import pytest
from docx import Document as WordDocument

from vivepdf.ops import _ocr_parallel
from vivepdf.ops.ocr import OcrParams, run_ocr
from vivepdf.rpc.errors import OpError
from vivepdf.rpc.progress import silent_progress

FONT = str(
    Path(__file__).resolve().parent.parent / "vivepdf" / "assets" / "fonts" / "DejaVuSans.ttf"
)
WORDS = ["Invoice", "Payment", "Receipt", "Contract", "Delivery", "Warranty", "Summary"]


def _picture_of(text: str) -> pymupdf.Pixmap:
    source = pymupdf.open()
    page = source.new_page()
    page.insert_text((60, 140), text, fontsize=34, fontfile=FONT, fontname="dv")
    pixmap = page.get_pixmap(dpi=150, colorspace=pymupdf.csGRAY)
    source.close()
    return pixmap


def _scanned(path: Path, texts: list[str]) -> Path:
    document = pymupdf.open()
    for text in texts:
        page = document.new_page()
        page.insert_image(page.rect, pixmap=_picture_of(text))
    document.save(path)
    document.close()
    return path


def _page_texts(path: str) -> list[str]:
    with pymupdf.open(path) as document:
        return [page.get_text() for page in document]


def test_parallel_recognition_keeps_page_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_ocr_parallel, "PARALLEL_MIN_PAGES", 2)
    source = _scanned(tmp_path / "many.pdf", [f"{word} number {i}" for i, word in enumerate(WORDS)])
    result = run_ocr(
        OcrParams(path=str(source), output=str(tmp_path / "out.pdf"), languages=["eng"], dpi=150),
        silent_progress(),
    )
    assert result.ocr_pages == len(WORDS)
    texts = _page_texts(result.output)
    for word, text in zip(WORDS, texts, strict=True):
        assert word in text


def test_recognition_carries_on_in_process_when_workers_die(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_ocr_parallel, "PARALLEL_MIN_PAGES", 2)
    monkeypatch.setattr(_ocr_parallel, "exit_with_parent", sys.exit)
    words = WORDS[:3]
    texts = [f"{word} number {i}" for i, word in enumerate(words)]
    source = _scanned(tmp_path / "yedek.pdf", texts)
    result = run_ocr(
        OcrParams(path=str(source), output=str(tmp_path / "out.pdf"), languages=["eng"], dpi=150),
        silent_progress(),
    )
    assert result.ocr_pages == len(words)
    for word, text in zip(words, _page_texts(result.output), strict=True):
        assert word in text


def test_worker_count_stays_serial_for_short_documents() -> None:
    assert _ocr_parallel.worker_count(2, cpus=16) == 1
    assert _ocr_parallel.worker_count(40, cpus=16) == _ocr_parallel.MAX_WORKERS
    assert _ocr_parallel.worker_count(40, cpus=1) == 1


def test_redo_replaces_old_hidden_text_and_keeps_links(tmp_path: Path) -> None:
    document = pymupdf.open()
    scanned = document.new_page()
    scanned.insert_image(scanned.rect, pixmap=_picture_of("Warranty certificate"))
    scanned.insert_text((60, 300), "garbled zzqx old layer text", fontsize=12, render_mode=3)
    scanned.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(0, 0, 50, 50), "uri": "https://example.org"}
    )
    typed = document.new_page()
    typed.insert_text((60, 140), "Typed page with plenty of visible text", fontsize=14)
    source = tmp_path / "old.pdf"
    document.save(source)
    document.close()

    result = run_ocr(
        OcrParams(
            path=str(source),
            output=str(tmp_path / "redo.pdf"),
            languages=["eng"],
            dpi=150,
            mode="redo",
        ),
        silent_progress(),
    )
    assert result.redone_pages == 1
    assert result.skipped_pages == 1
    texts = _page_texts(result.output)
    assert "zzqx" not in texts[0]
    assert "Warranty" in texts[0]
    assert "Typed page" in texts[1]
    with pymupdf.open(result.output) as output:
        assert [link["uri"] for link in output[0].get_links()] == ["https://example.org"]
        assert output[0].get_images()


def test_clean_option_still_recognises_text(tmp_path: Path) -> None:
    source = _scanned(tmp_path / "noisy.pdf", ["Delivery note"])
    result = run_ocr(
        OcrParams(
            path=str(source),
            output=str(tmp_path / "clean.pdf"),
            languages=["eng"],
            dpi=150,
            clean=True,
        ),
        silent_progress(),
    )
    assert "Delivery" in _page_texts(result.output)[0]


@pytest.mark.parametrize("extension", ["txt", "docx"])
def test_text_is_exported_next_to_the_pdf(tmp_path: Path, extension: str) -> None:
    source = _scanned(tmp_path / "two.pdf", ["Invoice total", "Payment received"])
    result = run_ocr(
        OcrParams(
            path=str(source),
            output=str(tmp_path / "out.pdf"),
            languages=["eng"],
            dpi=150,
            text_output=str(tmp_path / f"out.{extension}"),
        ),
        silent_progress(),
    )
    exported = Path(result.text_output or "")
    assert exported.suffix == f".{extension}"
    if extension == "txt":
        content = exported.read_text(encoding="utf-8")
        assert "\f" in content
    else:
        content = "\n".join(paragraph.text for paragraph in WordDocument(str(exported)).paragraphs)
    assert "Invoice" in content
    assert "Payment" in content
    assert not list(tmp_path.glob("*.part"))


def test_existing_text_export_is_not_overwritten(tmp_path: Path) -> None:
    source = _scanned(tmp_path / "one.pdf", ["Summary"])
    taken = tmp_path / "taken.txt"
    taken.write_text("keep", encoding="utf-8")
    with pytest.raises(OpError):
        run_ocr(
            OcrParams(
                path=str(source),
                output=str(tmp_path / "out.pdf"),
                languages=["eng"],
                text_output=str(taken),
            ),
            silent_progress(),
        )
    assert taken.read_text(encoding="utf-8") == "keep"
    assert not (tmp_path / "out.pdf").exists()
